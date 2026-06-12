import type { StreamChunk } from '@cabinet/gateway';
import type { ContextSnapshot } from './context-monitor.js';
import type { ContextHandoff } from './context-handoff.js';

/** Unified event type yielded by the AgentLoop execution generator. */
export type AgentEvent =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'thinking_done' }
  | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name: string; result: unknown }
  | { type: 'usage'; usage: { promptTokens: number; completionTokens: number } }
  | { type: 'step_budget_warning'; remaining: number; max: number }
  | { type: 'error'; message: string }
  | {
      type: 'done';
      content: string;
      steps: number;
      toolCalls: { name: string; args: Record<string, unknown>; result: unknown }[];
    };

/** Mutable execution context shared across all observers and the main loop. */
export interface AgentExecutionContext {
  // Session identity
  sessionId: string;
  projectId: string;
  captainId: string;
  model: string;

  // Messages (handoff may replace; otherwise append)
  messages: { role: 'user' | 'assistant'; content: string }[];
  systemPrompt: string;

  // Counters (preserved across handoffs)
  stepCount: number;
  consecutiveErrors: number;
  zoneCounts: { smart: number; warning: number; critical: number; dumb: number };
  handoffCount: number;
  errorCounts: { transient: number; recoverable: number; fatal: number };
  toolCounts: { total: number; succeeded: number; failed: number; blocked: number };
  totalPromptTokens: number;
  totalCompletionTokens: number;

  // State (preserved across handoffs)
  zone: 'smart' | 'warning' | 'critical' | 'dumb';
  toolCallHistory: { name: string; args: Record<string, unknown>; result: unknown }[];

  // Latest snapshot computed by ContextMonitorObserver (for HandoffObserver)
  lastSnapshot?: ContextSnapshot;

  // Zone crossing history (populated by ContextMonitorObserver for StepEventObserver / PIS)
  zoneCrossings?: { from: string; to: string }[];

  // PIS history (populated by ProcessIdentityObserver)
  pisHistory?: { step: number; score: number }[];
  lastPIS?: { total: number; trend: string; recommendedAction: string };

  // Blackboard mid-session updates (populated by BlackboardObserver)
  pendingBlackboardUpdates?: Array<{ topic: string; payload: unknown }>;

  // Subconscious insight injections (populated by SubconsciousInsightObserver)
  pendingSubconsciousInsights?: Array<{
    relevance: number;
    text: string;
    sourceMemoryId: string;
    relatedEntities: string[];
  }>;

  // Current step accumulators
  currentStepText: string;
  currentStepToolCalls: { id: string; name: string; args: Record<string, unknown> }[];

  // Handoff state (object reference preserved across handoffs)
  handoff: ContextHandoff | null;

  // Final output
  finalContent: string;

  // Session timing
  startTime: number;
}

/** Observer interface — each observer hooks into specific lifecycle events. */
export interface AgentObserver {
  name: string;
  onStreamStart?(ctx: AgentExecutionContext): Promise<void> | void;
  onChunk?(chunk: StreamChunk, ctx: AgentExecutionContext): Promise<void> | void;
  onToolCall?(
    call: { id: string; name: string; args: Record<string, unknown> },
    ctx: AgentExecutionContext,
  ): Promise<{ blocked: boolean; reason?: string } | void>;
  onToolResult?(
    call: { id: string; name: string; args: Record<string, unknown> },
    result: unknown,
    ctx: AgentExecutionContext,
  ): Promise<void> | void;
  onStepEnd?(ctx: AgentExecutionContext): Promise<{ handoff?: boolean } | void>;
  onSessionComplete?(summary: unknown): Promise<void> | void;
  onStreamEnd?(ctx: AgentExecutionContext): Promise<void> | void;
  /** 在 LLM 调用前检查用户输入（安全过滤） */
  onUserInput?(
    ctx: AgentExecutionContext,
    userMessage: string,
  ): Promise<{ blocked?: boolean; reason?: string } | void>;
}

/** Orchestrates a chain of observers. Errors in one observer do not halt the pipeline. */
export class ObserverPipeline {
  constructor(private observers: AgentObserver[]) {}

  async notify(event: keyof AgentObserver, ...args: unknown[]): Promise<unknown[]> {
    const results: unknown[] = [];
    for (const observer of this.observers) {
      const fn = observer[event] as unknown as (...a: unknown[]) => Promise<unknown> | unknown;
      if (fn) {
        try {
          results.push(await fn.apply(observer, args));
        } catch (e) {
          console.error(`Observer ${observer.name}.${String(event)} failed:`, e);
        }
      }
    }
    return results;
  }
}
