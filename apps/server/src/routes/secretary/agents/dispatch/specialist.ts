import { MessageType } from '@cabinet/types';
import type { AgentRoleType } from '@cabinet/agent';
import { getServerContext } from '../../../../context.js';
import { broadcast } from '../../../../ws/handler.js';
import {
  createReviewerLoop,
  persistReviewResult,
  resolveModel,
  getAgentLoopForRole,
} from '../agent-factory.js';
import { dispatchToExternalAgent } from './external.js';

/** Dispatch a message to a specialist role's AgentLoop, with optional Reviewer quality gate. */
export async function dispatchToSpecialist(
  roleType: AgentRoleType,
  message: string,
  sessionId: string,
  projectId: string,
  captainId: string,
  thinkingBudget?: number,
  model?: string,
): Promise<string> {
  const ctx = getServerContext();

  // ── External Agent Dispatch ──────────────────────────────────
  if (roleType.startsWith('external_')) {
    return dispatchToExternalAgent(roleType, message, sessionId, projectId, captainId);
  }

  // Dynamic model up/downgrade based on task complexity
  let effectiveModel = model;
  if (!effectiveModel) {
    const registry = ctx.agentRegistry;
    const roleDef = registry.get(roleType);

    // Upgrade: complex tasks need better models
    if (roleDef?.upgradeModelTier) {
      const needsUpgrade =
        message.includes('L3') || message.includes('安全关键') || message.length > 2000;
      if (needsUpgrade) {
        effectiveModel = resolveModel({ modelTier: roleDef.upgradeModelTier });
      }
    }

    // Downgrade: simple modifications don't need reasoning models
    if (!effectiveModel && roleDef?.downgradeModelTier) {
      // No built-in roles currently use downgrade; custom agents may opt in.
      const needsDowngrade = false;
      if (needsDowngrade) {
        effectiveModel = resolveModel({ modelTier: roleDef.downgradeModelTier });
      }
    }
  }

  const loop = getAgentLoopForRole(
    roleType,
    sessionId,
    projectId,
    captainId,
    thinkingBudget,
    effectiveModel,
  );
  if (!loop) return `[No LLM] Cannot dispatch to ${roleType}.`;

  const result = await loop.run(message);
  let output = result.content;

  // Quality gate: external and custom agent outputs get reviewed
  if (roleType !== 'secretary' && roleType !== 'curator') {
    const reviewerLoop = createReviewerLoop(ctx);
    if (reviewerLoop) {
      // Segmented review for long outputs: show first 4000 + last 4000 chars with truncation note
      const reviewContent =
        output.length > 8000
          ? output.slice(0, 4000) +
            '\n\n[...output truncated, total length: ' +
            output.length +
            ' chars...]\n\n' +
            output.slice(-4000)
          : output;

      const toolCallSummary =
        result.toolCalls.length > 0
          ? `\nTool calls made by ${roleType} during execution:\n${result.toolCalls.map((t: any) => `- ${t.name}(${JSON.stringify(t.args).slice(0, 100)}): ${JSON.stringify(t.result).slice(0, 100)}`).join('\n')}`
          : '';

      const reviewTask = [
        `## Quality Review Task`,
        '',
        `Review the following output produced by the "${roleType}" agent.`,
        `The original user message was: "${message.slice(0, 500)}"`,
        '',
        `Agent output to review:`,
        reviewContent,
        toolCallSummary,
        '',
        `Review for: logical completeness, evidence quality, risk assessment, factual errors.`,
        `Use available tools (search_memory, search_documents, read_file) to verify claims if possible.`,
        '',
        `After review, output ONLY a JSON object:`,
        `{"pass": true/false, "score": 0.0-1.0, "issues": [...], "suggestion": {...}}`,
      ].join('\n');

      try {
        const reviewResult = await reviewerLoop.run(reviewTask);
        const reviewMatch = reviewResult.content.match(/\{[\s\S]*\}/);
        const review = reviewMatch
          ? JSON.parse(reviewMatch[0])
          : { pass: true, score: 1.0, issues: [] };

        // Persist review result
        persistReviewResult(ctx, roleType, sessionId, review);

        if (review.pass !== true && review.issues?.length > 0) {
          // Publish quality alert for Harness
          if (ctx.eventBus) {
            ctx.eventBus
              .publish({
                messageId: `quality_alert_${Date.now()}`,
                correlationId: sessionId,
                causationId: null,
                timestamp: new Date(),
                messageType: MessageType.QualityAlert,
                payload: {
                  type: 'review_quality',
                  message: `Quality review for ${roleType}: score ${review.score}, ${review.issues?.length ?? 0} issues`,
                  severity: review.score < 0.5 ? 'high' : review.score < 0.7 ? 'medium' : 'low',
                },
              })
              .catch((err: any) => {
                console.warn('Operation failed', err);
              });

            broadcast('quality_alert', {
              source: roleType,
              sessionId,
              score: review.score,
              issueCount: review.issues?.length ?? 0,
              topIssue: review.issues?.[0]?.detail?.slice(0, 200) ?? null,
            });
          }

          // Append reviewer notes to output
          const issueNotes = (review.issues as any[])
            .map((i: any) => `- [${i.severity}] ${i.detail}`)
            .join('\n');
          output = `${output}\n\n---\n### Reviewer Notes\n${issueNotes}\n\n⚠️ Review score: ${review.score ?? 'N/A'}`;
        }
      } catch {
        // Review failure is non-fatal — return original output
      }
    }
  }

  return output;
}
