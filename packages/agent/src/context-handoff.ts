//
// Context Handoff — structured state transfer when context resets.
//
// Solves "context anxiety" (Sonnet 4.5 wrapping up early near context limits).
// When the ContextMonitor signals critical/dumb zone, create a handoff document
// that captures all essential state, reset the conversation, and inject the
// handoff as the first message in the fresh context.
//
// Inspired by Anthropic's three-Agent architecture (Planner → Generator ⇄ Evaluator)
// where structured handoff documents bridge context resets.
//

import type { ContextSnapshot } from './context-monitor.js';

/** Minimal progress info — callers can pass any object with toCompact(). */
export interface ProgressInfo {
  toCompact(): string;
}

// ── Types ──────────────────────────────────────────────────────

export interface HandoffState {
  /** Unique handoff ID (increments each reset). */
  handoffId: number;
  /** When the handoff was created. */
  timestamp: string;
  /** The original user request that started this session. */
  originalRequest: string;
  /** What has been accomplished so far. */
  completedSteps: string[];
  /** What still needs to be done. */
  remainingSteps: string[];
  /** Key decisions made during the session (with rationale). */
  decisions: { decision: string; rationale: string }[];
  /** Critical facts the agent learned during the session. */
  learnedFacts: string[];
  /** Open questions that need answers. */
  openQuestions: string[];
  /** Current progress snapshot. */
  progressCompact: string;
  /** The last tool call results (compressed). */
  lastToolResults: string[];
  /** Context utilization at time of handoff. */
  contextUtilization: number;
}

export interface HandoffResult {
  /** The handoff message to inject as the first message in the new context. */
  handoffMessage: string;
  /** Whether a handoff was actually needed. */
  performed: boolean;
  /** The handoff state (for debugging). */
  state: HandoffState;
}

// ── Handoff Manager ───────────────────────────────────────────

export class ContextHandoff {
  private handoffCount = 0;
  private completedSteps: string[] = [];
  private remainingSteps: string[] = [];
  private decisions: { decision: string; rationale: string }[] = [];
  private learnedFacts: string[] = [];
  private openQuestions: string[] = [];
  private lastToolResults: string[] = [];
  private originalRequest: string;

  constructor(originalRequest: string) {
    this.originalRequest = originalRequest;
  }

  /** Record a completed step. */
  recordStep(description: string): void {
    this.completedSteps.push(description);
    // Remove from remaining if present
    const idx = this.remainingSteps.indexOf(description);
    if (idx !== -1) this.remainingSteps.splice(idx, 1);
  }

  /** Set the remaining steps. */
  setRemaining(steps: string[]): void {
    this.remainingSteps = steps;
  }

  /** Record a decision. */
  recordDecision(decision: string, rationale: string): void {
    this.decisions.push({ decision, rationale });
  }

  /** Record a fact the agent learned. */
  recordFact(fact: string): void {
    if (!this.learnedFacts.includes(fact)) {
      this.learnedFacts.push(fact);
    }
  }

  /** Record an open question. */
  recordQuestion(question: string): void {
    this.openQuestions.push(question);
  }

  /** Record a tool result (compressed — store only the last 5). */
  recordToolResult(result: string): void {
    this.lastToolResults.push(result);
    if (this.lastToolResults.length > 5) {
      this.lastToolResults.shift();
    }
  }

  /**
   * Check if a handoff is needed based on the context snapshot.
   * Returns true when in critical or dumb zone.
   */
  shouldHandoff(snapshot: ContextSnapshot): boolean {
    return snapshot.zone === 'critical' || snapshot.zone === 'dumb';
  }

  /**
   * Perform the handoff — generate the handoff document and reset state.
   * Call this when shouldHandoff() returns true.
   */
  performHandoff(snapshot: ContextSnapshot, progress?: ProgressInfo): HandoffResult {
    this.handoffCount++;

    const progressCompact = progress?.toCompact() ?? '{}';

    const state: HandoffState = {
      handoffId: this.handoffCount,
      timestamp: new Date().toISOString(),
      originalRequest: this.originalRequest,
      completedSteps: [...this.completedSteps],
      remainingSteps: [...this.remainingSteps],
      decisions: [...this.decisions],
      learnedFacts: [...this.learnedFacts],
      openQuestions: [...this.openQuestions],
      progressCompact,
      lastToolResults: [...this.lastToolResults],
      contextUtilization: snapshot.utilization,
    };

    return {
      handoffMessage: this.formatHandoff(state),
      performed: true,
      state,
    };
  }

  /** Reset tracking state (call after a successful handoff). */
  reset(): void {
    this.lastToolResults = [];
    this.openQuestions = [];
  }

  // ── Private ────────────────────────────────────────────────

  private formatHandoff(state: HandoffState): string {
    const parts: string[] = [
      `[HANDOFF #${state.handoffId}] Context at ${(state.contextUtilization * 100).toFixed(0)}%.`,
      `Request: ${state.originalRequest.slice(0, 120)}`,
    ];

    if (state.completedSteps.length > 0) {
      parts.push(`Done: ${state.completedSteps.slice(-3).join('; ')}`);
    }
    if (state.remainingSteps.length > 0) {
      parts.push(`Todo: ${state.remainingSteps.slice(0, 3).join('; ')}`);
    }
    if (state.decisions.length > 0) {
      parts.push(`Decisions: ${state.decisions.slice(-2).map((d) => `${d.decision}→${d.rationale.slice(0, 40)}`).join('; ')}`);
    }
    if (state.learnedFacts.length > 0) {
      parts.push(`Facts: ${state.learnedFacts.slice(-3).join('; ')}`);
    }
    if (state.openQuestions.length > 0) {
      parts.push(`Open: ${state.openQuestions.slice(0, 2).join('; ')}`);
    }

    parts.push('Resume — do NOT redo completed steps.');

    let text = parts.join(' | ');
    if (text.length > 1000) text = text.slice(0, 997) + '...';
    return text;
  }
}
