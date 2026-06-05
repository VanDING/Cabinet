//
// InteractiveExternalAgent — multi-turn chat with external agents + Squad integration.
//
// Bridges the gap between Cabinet's interactive chat UI and external agents.
// Supports:
//   - Multi-turn conversation with external agents (chat history preserved)
//   - @SquadName routing: route chat messages to a Squad's members via SquadRouter
//   - A2A WebSocket real-time chat
//   - Harness-aware prompt formatting
//
// This addresses Plan C Part 1 — Fault 3: Squad routing and External Agent Chat
// were previously disconnected.
//

import { EventEmitter } from 'node:events';
import type { AgentEvent } from '@cabinet/events';
import type { ContextSlot } from '@cabinet/types';
import type { InteractiveSubAgent, InitContext, Deliverable } from '../interactive-sub-agent.js';
import type { HarnessRuntime, HarnessContext } from '../adapters/harness-runtime.js';
import type { ExternalTask, ExternalTaskResult } from '../adapters/types.js';

// ── Types ─────────────────────────────────────────────────────────

export interface ChatTurn {
  role: 'user' | 'agent';
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface SquadRouteMatch {
  squadName: string;
  targetAgentId: string;
  strategy: string;
}

export interface InteractiveExternalAgentOptions {
  /** The external agent ID to chat with. */
  agentId: string;
  /** Harness runtime for prompt conversion and dispatch. */
  harnessRuntime: HarnessRuntime;
  /** Optional Squad router for @TeamName resolution. */
  squadRouter?: SquadRouterLike;
  /** Maximum conversation turns before auto-finalize. */
  maxTurns?: number;
  /** Timeout per turn in milliseconds. */
  turnTimeoutMs?: number;
}

/** Minimal SquadRouter interface — avoids importing the full SquadRouter class. */
export interface SquadRouterLike {
  route(
    squadId: string,
    taskDescription: string,
    loadMap: Map<string, number>,
  ): { targetAgentId: string; strategy: string } | null;
  getSquadStatus?(squadId: string): { members: Array<{ agentId: string; active: boolean; load: number }> };
}

// ── Constants ─────────────────────────────────────────────────────

const DEFAULT_MAX_TURNS = 20;
const DEFAULT_TURN_TIMEOUT_MS = 300_000;

// ── InteractiveExternalAgent ─────────────────────────────────────

export class InteractiveExternalAgent implements InteractiveSubAgent {
  readonly onEvent = new EventEmitter<{ event: [AgentEvent] }>();

  private agentId: string;
  private harnessRuntime: HarnessRuntime;
  private squadRouter: SquadRouterLike | null;
  private maxTurns: number;
  private turnTimeoutMs: number;

  // Session state
  private context: InitContext | null = null;
  private chatHistory: ChatTurn[] = [];
  private status: 'running' | 'waiting_for_user' | 'completed' | 'error' = 'waiting_for_user';
  private turnCount = 0;
  private currentTargetAgentId: string; // may change if Squad reroutes
  private logger: { info: (msg: string, ctx?: unknown) => void; warn: (msg: string, ctx?: unknown) => void };

  constructor(options: InteractiveExternalAgentOptions) {
    this.agentId = options.agentId;
    this.harnessRuntime = options.harnessRuntime;
    this.squadRouter = options.squadRouter ?? null;
    this.maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
    this.turnTimeoutMs = options.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
    this.currentTargetAgentId = options.agentId;
    this.logger = {
      info: (...args: unknown[]) => console.log('[InteractiveExternalAgent]', ...args),
      warn: (...args: unknown[]) => console.warn('[InteractiveExternalAgent]', ...args),
    };
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  async init(context: InitContext): Promise<void> {
    this.context = context;
    this.chatHistory = [];
    this.turnCount = 0;
    this.status = 'running';

    // Add the initial user message to history
    this.chatHistory.push({
      role: 'user',
      content: context.message,
      timestamp: new Date().toISOString(),
    });

    this.emitStatus('running');

    // Process the initial message
    try {
      await this.processTurn(context.message);
    } catch (err) {
      this.status = 'error';
      this.emitError(String(err));
    }
  }

  async onUserInput(input: string): Promise<void> {
    if (this.status === 'completed' || this.status === 'error') {
      this.logger.warn('Cannot accept input in current state', { status: this.status });
      return;
    }

    this.turnCount++;
    if (this.turnCount >= this.maxTurns) {
      this.logger.warn('Max turns reached, auto-finalizing');
      await this.finalize();
      return;
    }

    this.chatHistory.push({
      role: 'user',
      content: input,
      timestamp: new Date().toISOString(),
    });

    this.status = 'running';
    this.emitStatus('running');

    try {
      await this.processTurn(input);
    } catch (err) {
      this.status = 'error';
      this.emitError(String(err));
    }
  }

  async finalize(): Promise<Deliverable> {
    this.status = 'completed';
    this.emitStatus('completed');

    // Compile full conversation as deliverable
    const transcript = this.chatHistory
      .map((t) => `[${t.role}] ${t.content}`)
      .join('\n\n');

    const deliverable: Deliverable = {
      type: 'external_agent_chat',
      content: {
        agentId: this.agentId,
        turns: this.chatHistory.length,
        transcript,
        finalTargetAgentId: this.currentTargetAgentId,
      },
    };

    this.emitCompleted(deliverable);
    return deliverable;
  }

  getStatus(): 'running' | 'waiting_for_user' | 'completed' | 'error' {
    return this.status;
  }

  /** Get the current chat history. */
  getChatHistory(): ChatTurn[] {
    return [...this.chatHistory];
  }

  /** Get the currently targeted agent (may differ from original if Squad-routed). */
  getCurrentTarget(): string {
    return this.currentTargetAgentId;
  }

  // ── Squad Routing ──────────────────────────────────────────────

  /**
   * Detect @SquadName mentions in a message and route to the Squad.
   * Returns the routed agent ID or null if no Squad was matched.
   */
  private trySquadRoute(message: string): SquadRouteMatch | null {
    if (!this.squadRouter) return null;

    // Detect @TeamName patterns
    const squadMatch = message.match(/@(\w[\w-]*)/);
    if (!squadMatch?.[1]) return null;

    const squadName = squadMatch[1];

    try {
      const loadMap = new Map<string, number>();
      // Build load map from our own conversation state
      loadMap.set(this.currentTargetAgentId, 1);

      const route = this.squadRouter.route(squadName, message, loadMap);
      if (route) {
        this.logger.info('Squad routed chat message', {
          squad: squadName,
          to: route.targetAgentId,
          strategy: route.strategy,
        });

        return {
          squadName,
          targetAgentId: route.targetAgentId,
          strategy: route.strategy,
        };
      }
    } catch (err) {
      this.logger.warn('Squad routing failed', { squad: squadName, error: String(err) });
    }

    return null;
  }

  // ── Turn Processing ────────────────────────────────────────────

  private async processTurn(userInput: string): Promise<void> {
    // Step 1: Check for Squad routing
    const squadRoute = this.trySquadRoute(userInput);
    if (squadRoute && squadRoute.targetAgentId !== this.currentTargetAgentId) {
      this.currentTargetAgentId = squadRoute.targetAgentId;
      // Emit routing as a thinking event since AgentEvent has no 'routing' type
      this.emitThinking(`Routed to ${squadRoute.targetAgentId} via Squad ${squadRoute.squadName} (${squadRoute.strategy})`);
    }

    // Step 2: Build the task for this turn
    const task = this.buildTask(userInput);

    // Step 3: Dispatch via HarnessRuntime
    this.emitThinking(`Dispatching to ${this.currentTargetAgentId}...`);

    const result = await this.harnessRuntime.dispatchTask(task);

    // Step 4: Process the result
    if (result.status === 'completed') {
      const agentResponse = typeof result.output === 'string'
        ? result.output
        : JSON.stringify(result.output, null, 2);

      this.chatHistory.push({
        role: 'agent',
        content: agentResponse,
        timestamp: new Date().toISOString(),
        metadata: {
          agentId: this.currentTargetAgentId,
          tokensUsed: result.audit?.tokens_used,
          model: result.audit?.model,
        },
      });

      this.emitOutput(agentResponse);

      this.status = 'waiting_for_user';
    } else {
      this.emitError(result.error ?? `Task ${result.status}`);
      this.status = 'error';
    }
  }

  /** Build an ExternalTask from the current conversation state. */
  private buildTask(userInput: string): ExternalTask {
    const taskId = `ext_chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Build conversation context
    const conversationContext = this.chatHistory.length > 0
      ? `\n\n## Conversation History\n${this.chatHistory
          .slice(-6) // Last 6 turns for context
          .map((t) => `[${t.role}]: ${t.content.slice(0, 300)}`)
          .join('\n')}`
      : '';

    const fullInput = `${userInput}${conversationContext}`;

    // Build slot with harness context
    const projectId = this.context?.projectId ?? 'external-chat';
    const slot: ContextSlot = {
      project: {
        name: projectId,
        tech_stack: '',
        goals: [],
      },
      memories: [],
      files: [],
      discoveries: [],
      previous_outputs: [],
      security: { level: 'standard', maxRetries: 2 },
      preferences: {
        riskTolerance: 'medium',
        preferredDecisionStyle: 'directive',
      },
    };

    return {
      task_id: taskId,
      session_id: this.context?.sessionId ?? `ext_session_${Date.now()}`,
      capability: 'chat',
      input: fullInput,
      slot,
      configuration: {
        max_retries: 2,
        timeout_ms: this.turnTimeoutMs,
        slot_write_url: '',
      },
    };
  }

  // ── Event Emission ─────────────────────────────────────────────

  private emitThinking(content: string): void {
    this.emit({ type: 'thinking', content, timestamp: Date.now() });
  }

  private emitOutput(content: string): void {
    this.emit({ type: 'output', content, timestamp: Date.now() });
  }

  private emitStatus(status: 'running' | 'waiting_for_user' | 'completed' | 'error'): void {
    this.emit({ type: 'status', status, timestamp: Date.now() });
  }

  private emitError(message: string): void {
    this.emit({ type: 'error', message, timestamp: Date.now() });
  }

  private emitCompleted(deliverable: Deliverable): void {
    this.emit({ type: 'completed', deliverable, timestamp: Date.now() });
  }

  private emit(event: AgentEvent): void {
    try {
      this.onEvent.emit('event', event);
    } catch {
      // Listener error shouldn't crash us
    }
  }
}
