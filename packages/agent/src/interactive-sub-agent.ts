import { EventEmitter } from 'node:events';
import type { AgentEvent } from '@cabinet/events';

export interface InitContext {
  sessionId: string;
  parentSessionId: string;
  projectId: string;
  captainId: string;
  message: string;
  model?: string;
}

export interface Deliverable {
  type: string;
  content: unknown;
}

/**
 * Contract for interactive sub-agents that support multi-turn
 * natural-language refinement by the user.
 */
export interface InteractiveSubAgent {
  /** Start the sub-agent with initial context. */
  init(context: InitContext): Promise<void>;

  /** Receive a mid-flight user input and continue processing. */
  onUserInput(input: string): Promise<void>;

  /** User explicitly confirms satisfaction. Returns final deliverable. */
  finalize(): Promise<Deliverable>;

  /** Event stream for frontend rendering (thinking, tool_call, output, etc.) */
  onEvent: EventEmitter<{ event: [AgentEvent] }>;

  /** Current status. */
  getStatus(): 'running' | 'waiting_for_user' | 'completed' | 'error';
}
