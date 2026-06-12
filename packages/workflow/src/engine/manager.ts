//
// Manager node execution — inlined from the former ManagerExecutor.
// Orchestrates the Plan → Dispatch → Review → Iterate → Synthesize cycle.
//

import type { WorkflowNodeDef, StructuredInput, WorkflowRunStep } from '@cabinet/types';
import type {
  ManagerContext,
  ManagerContextDeps,
  ManagerPlan,
  ManagerReview,
} from '../manager-context.js';
import { createManagerContext } from '../manager-context.js';

export type ManagerRunDeps = ManagerContextDeps;

export async function runManagerNode(
  node: WorkflowNodeDef,
  initialInput: StructuredInput,
  deps: ManagerRunDeps,
): Promise<string> {
  const ctx = createManagerContext(deps) as ManagerContext & {
    _incrementRound(): void;
    _resetRounds(): void;
  };
  const maxRounds = node.managerConfig?.maxRounds ?? deps.maxRounds ?? 5;
  const planningPrompt = node.managerConfig?.planningPrompt;
  const reviewPrompt = node.managerConfig?.reviewPrompt;

  const allResults = new Map<string, WorkflowRunStep>();
  ctx._resetRounds();

  // Main loop
  while (ctx.shouldContinue()) {
    ctx._incrementRound();

    const plan = await planRound(
      ctx,
      deps,
      initialInput,
      allResults,
      planningPrompt,
      ctx.currentRound,
      maxRounds,
    );

    if (plan.isComplete) {
      break;
    }

    for (const assignment of plan.assignments) {
      const step = await ctx.dispatchToChild(assignment.nodeId, assignment.input);
      allResults.set(assignment.nodeId, step);
    }

    const review = await reviewRound(ctx, deps, allResults, plan, reviewPrompt);

    if (!review.shouldContinue) {
      break;
    }

    const needsRework = review.evaluations.filter((e) => e.needsRework);
    if (needsRework.length === 0 && plan.assignments.length > 0) {
      break;
    }
  }

  return ctx.synthesize(allResults);
}

// ── Plan phase ─────────────────────────────────────────────────

async function planRound(
  ctx: ManagerContext,
  deps: ManagerContextDeps,
  initialInput: StructuredInput,
  allResults: Map<string, WorkflowRunStep>,
  customPrompt: string | undefined,
  round: number,
  maxRounds: number,
): Promise<ManagerPlan> {
  const children = ctx.getAvailableChildren();
  const childList = children
    .map((c) => {
      let info = `- ${c.id}: ${c.title ?? c.type}`;
      if (c.description) info += ` — ${c.description}`;
      if (c.squadId) info += ` [Squad: ${c.squadId}]`;
      if (c.type === 'agentGroup') info += ` [Team: ${c.role ?? c.agentId ?? 'auto'}]`;
      return info;
    })
    .join('\n');

  const previousResults =
    allResults.size > 0
      ? Array.from(allResults.entries())
          .map(([id, step]) => `[${id}] ${step.output.slice(0, 300)}`)
          .join('\n')
      : '(none yet)';

  const prompt =
    customPrompt ??
    [
      `You are a workflow Manager coordinating ${children.length} child nodes.`,
      '',
      '## Available Children',
      childList,
      '',
      '## Task Input',
      initialInput.previousOutputs.slice(0, 1000),
      '',
      '## Previous Round Results',
      previousResults,
      '',
      `## Round ${round} of ${maxRounds}`,
      '',
      'Decide what to do this round. Respond with JSON:',
      '{',
      '  "reasoning": "<your plan for this round>",',
      '  "assignments": [',
      '    {"nodeId": "<child id>", "goal": "<what this child should achieve>", "input": {"previousOutputs": "<concise task for child>"}}',
      '  ],',
      '  "isComplete": false',
      '}',
      '',
      'Set isComplete=true ONLY if all work is done. Assign at most 3 children per round.',
    ].join('\n');

  const raw = await deps.planWithLLM(prompt);

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        round,
        reasoning: parsed.reasoning ?? raw,
        assignments: (parsed.assignments ?? []).map((a: any) => ({
          nodeId: a.nodeId,
          goal: a.goal ?? '',
          input: {
            previousOutputs:
              typeof a.input === 'string'
                ? a.input
                : JSON.stringify(a.input?.previousOutputs ?? a.input),
            upstreamItems: [],
          },
        })),
        isComplete: parsed.isComplete === true,
      };
    }
  } catch {
    /* fall through to default */
  }

  const firstChild = children[0];
  return {
    round,
    reasoning: raw,
    assignments: firstChild
      ? [{ nodeId: firstChild.id, goal: 'Process the task', input: initialInput }]
      : [],
    isComplete: !firstChild,
  };
}

// ── Review phase ───────────────────────────────────────────────

async function reviewRound(
  ctx: ManagerContext,
  deps: ManagerContextDeps,
  allResults: Map<string, WorkflowRunStep>,
  plan: ManagerPlan,
  customPrompt: string | undefined,
): Promise<ManagerReview> {
  const resultsText = Array.from(allResults.entries())
    .map(([id, step]) => `[${id}] ${step.output.slice(0, 500)}`)
    .join('\n\n');

  const prompt =
    customPrompt ??
    [
      'Review the following child node outputs against the plan:',
      '',
      '## Plan Assignments',
      plan.assignments.map((a) => `- ${a.nodeId}: ${a.goal}`).join('\n'),
      '',
      '## Results',
      resultsText || '(no results yet)',
      '',
      'Respond with JSON:',
      '{',
      '  "evaluations": [',
      '    {"nodeId": "<id>", "score": <0-100>, "feedback": "<assessment>", "needsRework": false}',
      '  ],',
      '  "summary": "<overall assessment>",',
      '  "shouldContinue": false',
      '}',
    ].join('\n');

  const raw = await deps.reviewWithLLM(prompt);

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        evaluations: parsed.evaluations ?? [],
        summary: parsed.summary ?? raw,
        shouldContinue: parsed.shouldContinue === true,
      };
    }
  } catch {
    /* use default */
  }

  const evaluations = await Promise.all(
    plan.assignments.map(async (a) => {
      const step = allResults.get(a.nodeId);
      const result = step
        ? await ctx.evaluate(step.output, a.goal)
        : { score: 0, feedback: 'no result' };
      return {
        nodeId: a.nodeId,
        score: result.score,
        feedback: result.feedback,
        needsRework: result.score < 60,
      };
    }),
  );

  return {
    evaluations,
    summary: raw,
    shouldContinue: false,
  };
}
