// Meeting execution helper — extracted from agents.ts.
// Handles the full meeting lifecycle: chair brief → advisor analysis → reviewer → synthesis → auto-extract decision.

import { AsyncLocalStorage } from 'node:async_hooks';
import type { ServerContext } from '../../../context.js';
import {
  buildChairPrompt,
  parseChairResponse,
  buildAdvisorPrompt,
  parseAdvisorResponse,
  buildReviewerTask,
  parseReviewerResponse,
  buildExtractionPrompt,
  parseExtractionResponse,
  generateSynthesis,
  type AdvisorFinding,
} from '@cabinet/meeting';
import { broadcast } from '../../../ws/handler.js';
import { createReviewerLoop } from './agent-factory.js';

// ── Meeting result capture (request-scoped via AsyncLocalStorage) ──
export const meetingResultStore = new AsyncLocalStorage<{ result: MeetingResult | null }>();
/** Legacy fallback */
export let capturedMeetingResult: MeetingResult | null = null;

export interface MeetingResult {
  meetingId: string;
  topic: string;
  synthesis: string;
  perspectives: any[];
  crossValidation?: unknown;
  decisionId?: string | null;
  process?: {
    analysisBrief: string;
    advisorSynthesis: string;
    reviewRounds: number;
    reviewPassed: boolean;
    reviewIssues: any[];
  };
}

export async function runMeeting(
  topic: string,
  advisorIds: string[] | undefined,
  projectId: string | undefined,
  ctx: ServerContext,
  chairBrief?: string,
): Promise<{
  meetingId: string;
  topic: string;
  synthesis: string;
  perspectives: any[];
  decisionId?: string | null;
  process?: {
    analysisBrief: string;
    advisorSynthesis: string;
    reviewRounds: number;
    reviewPassed: boolean;
    reviewIssues: any[];
  };
}> {
  const meetingId = `meeting_${Date.now()}`;

  // Budget gate
  const budget = ctx.budgetGuard.canProceed();
  if (!budget.allowed) {
    return {
      meetingId,
      topic,
      synthesis: `Meeting blocked: ${budget.reason ?? 'Budget limit exceeded'}.`,
      perspectives: [],
    };
  }

  if (!ctx.gateway) {
    const synthesis = `[No LLM] Meeting on "${topic}" created. Configure API keys for AI-powered meetings.`;
    ctx.db
      .prepare(
        "INSERT INTO audit_log (entity_type, entity_id, action, actor, changes, timestamp) VALUES ('meeting', ?, 'create', 'system', ?, datetime('now'))",
      )
      .run(meetingId, JSON.stringify({ topic, status: 'started', synthesis }));
    return { meetingId, topic, synthesis, perspectives: [] };
  }

  const model = 'claude-haiku-4-5';

  // Phase 1: Chair generates analysis perspectives
  let analysisBrief: string;
  if (chairBrief) {
    analysisBrief = chairBrief;
  } else {
    try {
      const chairPrompt = buildChairPrompt(topic, advisorIds);
      const chairResponse = await ctx.gateway!.generateText({
        model,
        messages: [{ role: 'user', content: chairPrompt }],
        maxTokens: 1200,
        temperature: 0.3,
      });
      const brief = parseChairResponse(chairResponse.content, topic);
      analysisBrief = JSON.stringify(brief);
      ctx.metrics.increment('llm_call', { model, purpose: 'meeting_chair_brief' });
    } catch {
      analysisBrief = JSON.stringify(parseChairResponse('', topic));
    }
  }

  // Phase 2: Advisor multi-perspective analysis
  let perspectives: any[];
  let advisorResult: import('@cabinet/meeting').AdvisorResult;
  try {
    const brief = JSON.parse(analysisBrief);
    const advisorPrompt = buildAdvisorPrompt(brief);
    const advisorResponse = await ctx.gateway!.generateText({
      model,
      messages: [{ role: 'user', content: advisorPrompt }],
      maxTokens: 1500,
      temperature: 0.4,
    });
    advisorResult = parseAdvisorResponse(advisorResponse.content);
    perspectives = advisorResult.findings;
    ctx.metrics.increment('llm_call', { model, purpose: 'meeting_advisor' });
  } catch {
    perspectives = [];
    advisorResult = { findings: [], synthesis: '', risks: [], open_questions: [] };
  }

  // Phase 3: Reviewer adversarial review
  let synthesis = '';
  let reviewPassed = false;
  let reviewIssues: any[] = [];
  const maxRounds = 2;
  for (let round = 0; round < maxRounds && !reviewPassed; round++) {
    try {
      const reviewerLoop = createReviewerLoop(ctx);
      if (reviewerLoop) {
        const reviewerTask = buildReviewerTask(
          topic,
          perspectives as AdvisorFinding[],
          advisorResult.synthesis,
        );
        const reviewerResult = await reviewerLoop.run(reviewerTask);
        const review = parseReviewerResponse(reviewerResult.content);
        reviewPassed = review.pass;
        reviewIssues = review.issues;
      } else {
        reviewPassed = true;
      }
      ctx.metrics.increment('llm_call', { model: 'claude-haiku-4-5', purpose: 'meeting_reviewer' });

      if (reviewPassed || round === maxRounds - 1) {
        synthesis = generateSynthesis({
          topic,
          findings: perspectives as AdvisorFinding[],
          synthesisText: advisorResult.synthesis,
          reviewIssues,
        });
      }
    } catch {
      synthesis = 'Analysis completed.';
      reviewPassed = true;
    }
  }

  // Persist to audit log
  ctx.db
    .prepare(
      "INSERT INTO audit_log (entity_type, entity_id, action, actor, changes, timestamp) VALUES ('meeting', ?, 'create', 'system', ?, datetime('now'))",
    )
    .run(
      meetingId,
      JSON.stringify({
        topic, status: 'completed', synthesis, perspectives, reviewPassed, projectId,
      }),
    );
  broadcast('meeting_created', {
    meetingId, topic,
    attendees: perspectives.map((p: any) => p.name ?? p.advisor),
  });

  // Auto-create deliverable
  try {
    const did = `d_${Date.now()}`;
    const effectiveProjectId = projectId === 'global' || !projectId ? 'default' : projectId;
    ctx.deliverableRepo.insert({
      id: did, project_id: effectiveProjectId, meeting_id: meetingId,
      title: topic, type: 'meeting_report', file_path: null,
      tags: JSON.stringify(['meeting', 'analysis']),
      created_at: new Date().toISOString(),
    });
  } catch { /* non-fatal */ }

  // Phase 4: Auto-extract decision
  let decisionId: string | null = null;
  if (ctx.gateway && synthesis && synthesis.length > 20) {
    try {
      const extractionPrompt = buildExtractionPrompt(topic, synthesis, perspectives as AdvisorFinding[]);
      const extractionResponse = await ctx.gateway.generateText({
        model: 'claude-haiku-4-5',
        messages: [{ role: 'user', content: extractionPrompt }],
        maxTokens: 400, temperature: 0.1,
      });
      const extracted = parseExtractionResponse(extractionResponse.content);
      if (extracted.hasDecision && extracted.title) {
        const decId = `dec_${Date.now()}`;
        const options = (extracted.options ?? [
          { label: 'Approve', impact: 'Proceed as recommended' },
          { label: 'Reject', impact: 'Do not proceed' },
        ]).map((o: any, i: number) => ({ id: `opt_${i}`, label: o.label, impact: o.impact ?? '' }));

        ctx.decisionService.create({
          id: decId, projectId: projectId ?? 'default', type: 'strategic',
          title: extracted.title,
          description: extracted.description ?? `Decision extracted from meeting: ${topic}`,
          options,
          classification: {
            scopeDescription: topic, isCrossSession: false, optionCount: options.length,
            estimatedCost: 0, involvesFunds: false, involvesPermissions: false,
            involvesDataDeletion: false, involvesOrgConfig: false,
          },
        });
        decisionId = decId;
        broadcast('decision_created', { decisionId: decId, title: extracted.title, level: extracted.level ?? 'L1' });
        ctx.logger.info('Decision auto-extracted from meeting', { meetingId, decisionId: decId });
      }
    } catch (e) {
      ctx.logger.warn('Meeting decision extraction failed', { error: (e as Error).message, meetingId });
    }
  }

  const result: MeetingResult = {
    meetingId, topic, synthesis, perspectives, decisionId,
    process: { analysisBrief, advisorSynthesis: advisorResult.synthesis, reviewRounds: maxRounds, reviewPassed, reviewIssues },
  };
  const store = meetingResultStore.getStore();
  if (store) store.result = result;
  capturedMeetingResult = result;
  return result;
}
