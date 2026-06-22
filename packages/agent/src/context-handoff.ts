import type { ContextSnapshot } from './context-monitor.js';

export interface HandoffState {
  handoffId: number;
  timestamp: string;
  originalRequest: string;
  completedSteps: string[];
  remainingSteps: string[];
  decisions: { decision: string; rationale: string }[];
  learnedFacts: string[];
  openQuestions: string[];
  contextUtilization: number;
}

export interface HandoffResult {
  handoffMessage: string;
  performed: boolean;
  state: HandoffState;
}

export class ContextHandoff {
  private handoffCount = 0;
  private completedSteps: string[] = [];
  private remainingSteps: string[] = [];
  private decisions: { decision: string; rationale: string }[] = [];
  private learnedFacts: string[] = [];
  private openQuestions: string[] = [];
  private originalRequest: string;

  constructor(originalRequest: string) {
    this.originalRequest = originalRequest;
  }

  recordStep(description: string): void {
    this.completedSteps.push(description);
    const idx = this.remainingSteps.indexOf(description);
    if (idx !== -1) this.remainingSteps.splice(idx, 1);
  }

  setRemaining(steps: string[]): void {
    this.remainingSteps = steps;
  }

  recordDecision(decision: string, rationale: string): void {
    this.decisions.push({ decision, rationale });
  }

  shouldHandoff(snapshot: ContextSnapshot): boolean {
    return snapshot.zone === 'dumb';
  }

  performHandoff(snapshot: ContextSnapshot): HandoffResult {
    this.handoffCount++;

    const state: HandoffState = {
      handoffId: this.handoffCount,
      timestamp: new Date().toISOString(),
      originalRequest: this.originalRequest,
      completedSteps: [...this.completedSteps],
      remainingSteps: [...this.remainingSteps],
      decisions: [...this.decisions],
      learnedFacts: [...this.learnedFacts],
      openQuestions: [...this.openQuestions],
      contextUtilization: snapshot.utilization,
    };

    return {
      handoffMessage: this.formatHandoff(state),
      performed: true,
      state,
    };
  }

  reset(): void {
    this.openQuestions = [];
  }

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
      parts.push(
        `Decisions: ${state.decisions
          .slice(-2)
          .map((d) => `${d.decision}→${d.rationale.slice(0, 40)}`)
          .join('; ')}`,
      );
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
