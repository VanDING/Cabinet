//
// ManagerContext — the contract between a Manager node and the workflow engine.
//
// Inspired by HiveWard's Manager node pattern, the ManagerContext provides
// the Manager AI agent with controlled access to child nodes for a
// Plan → Dispatch → Review → Iterate → Synthesize cycle.
//
// Squad integration: when squadDelegation is enabled, dispatchToChild can
// route through SquadRouter for team-based agent selection.
//

import type {
  WorkflowNodeDef,
  WorkflowRunStep,
  StructuredInput,
  NodeOutputContract,
} from '@cabinet/types';

// ── ManagerContext interface ──────────────────────────────────────

export interface ManagerContext {
  /** List all child nodes available for delegation. */
  getAvailableChildren(): WorkflowNodeDef[];

  /** Dispatch a task to a child node and wait for its result. */
  dispatchToChild(nodeId: string, input: StructuredInput): Promise<WorkflowRunStep>;

  /** Evaluate a child's output against the task goal. Returns score (0-100) and feedback. */
  evaluate(output: string, goal: string): Promise<{ score: number; feedback: string }>;

  /** Synthesize all child results into a final combined output. */
  synthesize(allResults: Map<string, WorkflowRunStep>): Promise<string>;

  /** Current planning round (1-indexed). */
  currentRound: number;

  /** Maximum planning rounds before auto-synthesize. */
  maxRounds: number;

  /** Whether the manager should continue iterating. */
  shouldContinue(): boolean;

  /** Optional Squad router reference for team-based delegation. */
  squadRouter?: SquadRouterLike;
}

// ── SquadRouter minimal interface ─────────────────────────────────

export interface SquadRouterLike {
  route(
    squadId: string,
    taskDescription: string,
    loadMap: Map<string, number>,
  ): { targetAgentId: string; strategy: string } | null;
}

// ── ManagerPlan ──────────────────────────────────────────────────

export interface ManagerPlan {
  /** Round number. */
  round: number;
  /** What the manager plans to do this round. */
  reasoning: string;
  /** Which child nodes to dispatch to and why. */
  assignments: Array<{
    nodeId: string;
    goal: string;
    input: StructuredInput;
  }>;
  /** Whether the manager considers the work complete. */
  isComplete: boolean;
}

// ── ManagerReview ────────────────────────────────────────────────

export interface ManagerReview {
  /** Per-assignment evaluation. */
  evaluations: Array<{
    nodeId: string;
    score: number; // 0-100
    feedback: string;
    needsRework: boolean;
  }>;
  /** Overall assessment. */
  summary: string;
  /** Should continue iterating? */
  shouldContinue: boolean;
}

// ── Engine-side ManagerContext builder ───────────────────────────

export interface ManagerContextDeps {
  /** All child nodes of the manager. */
  children: WorkflowNodeDef[];
  /** Execute a single child node and return its step. */
  executeChild: (nodeId: string, input: StructuredInput) => Promise<WorkflowRunStep>;
  /** LLM call for planning (decides what to do each round). */
  planWithLLM: (prompt: string) => Promise<string>;
  /** LLM call for review (evaluates child outputs). */
  reviewWithLLM: (prompt: string) => Promise<string>;
  /** LLM call for synthesis (combines all results). */
  synthesizeWithLLM: (prompt: string) => Promise<string>;
  /** Max rounds (default: 5). */
  maxRounds?: number;
  /** Squad router for team-based delegation. */
  squadRouter?: SquadRouterLike;
}

/**
 * Create a ManagerContext backed by the engine's execution infrastructure.
 *
 * The resulting context is used by the manager node runner in engine/manager.ts
 * which orchestrates the Plan→Dispatch→Review→Iterate→Synthesize cycle.
 */
export function createManagerContext(deps: ManagerContextDeps): ManagerContext {
  let round = 0;
  const maxRounds = deps.maxRounds ?? 5;

  return {
    getAvailableChildren: () => deps.children,

    dispatchToChild: async (nodeId, input) => {
      return deps.executeChild(nodeId, input);
    },

    evaluate: async (output, goal) => {
      const prompt = [
        'Evaluate the following output against this goal:',
        `Goal: ${goal}`,
        '',
        `Output:`,
        output,
        '',
        'Respond with JSON: {"score": <0-100>, "feedback": "<brief assessment>"}',
      ].join('\n');

      const raw = await deps.reviewWithLLM(prompt);
      try {
        const parsed = JSON.parse(raw);
        return {
          score: Math.max(0, Math.min(100, Number(parsed.score) || 0)),
          feedback: parsed.feedback ?? raw,
        };
      } catch {
        return { score: 50, feedback: raw };
      }
    },

    synthesize: async (allResults) => {
      const parts: string[] = [];
      for (const [nodeId, step] of allResults) {
        parts.push(`## ${nodeId}\n${step.output}`);
      }
      const prompt = [
        'Synthesize the following results into a single cohesive output:',
        '',
        parts.join('\n\n'),
        '',
        'Provide a clear, well-structured synthesis.',
      ].join('\n');

      return deps.synthesizeWithLLM(prompt);
    },

    get currentRound() {
      return round;
    },
    maxRounds,
    shouldContinue: () => round < maxRounds,
    squadRouter: deps.squadRouter,

    // Internal mutable round counter (incremented by ManagerExecutor)
    _incrementRound: () => {
      round++;
    },
    _resetRounds: () => {
      round = 0;
    },
  } as ManagerContext & { _incrementRound(): void; _resetRounds(): void };
}
