import type { AgentLoop, StreamingCallback } from '@cabinet/agent';
import type { AgentRoleType } from '@cabinet/agent';
import type { LLMGateway } from '@cabinet/gateway';
import type { DelegationTier } from '@cabinet/types';
import { IntentParser, type ParsedIntent, type AgentRouteResult } from './intent-parser.js';
import { SessionManager } from './session-manager.js';

export class SecretaryAgent {
  private readonly intentParser: IntentParser;
  private lastIntent: string | null = null;
  private lastRoute: string | null = null;
  private lastRoutedAgent: string | null = null;

  constructor(
    private readonly agentLoop: AgentLoop,
    intentParser: IntentParser,
    private readonly sessionManager: SessionManager,
    private readonly gateway?: LLMGateway,
    /** Callback to dispatch a message to a specialist agent with streaming. */
    private readonly dispatchToRole?: (
      roleType: AgentRoleType,
      message: string,
      sessionId: string,
      callback: StreamingCallback,
    ) => Promise<void>,
  ) {
    this.intentParser = intentParser;
  }

  /** Update delegation tier on the underlying AgentLoop (called when user changes tier in UI). */
  setDelegationTier(tier: DelegationTier): void {
    this.agentLoop.setDelegationTier(tier);
  }

  async handleMessage(
    sessionId: string,
    message: string,
  ): Promise<{
    intent: ParsedIntent;
    response: string;
    routeResult?: AgentRouteResult;
    usage?: { promptTokens: number; completionTokens: number };
  }> {
    this.sessionManager.addMessage(sessionId, 'user', message);

    // Route with conversation context for follow-up detection
    const routeResult = await this.intentParser.routeToAgent(message, {
      lastIntent: this.lastIntent ?? undefined,
      lastRoute: this.lastRoute ?? undefined,
    });

    // Track state for next message
    this.lastIntent = routeResult.intent.kind;
    this.lastRoute = routeResult.targetAgent;

    // Handle follow-up: stay on the same agent
    let targetAgent = routeResult.targetAgent;
    if (routeResult.intent.kind === 'follow_up' && this.lastRoute) {
      targetAgent = this.lastRoute as AgentRoleType;
    }

    let response: string;
    let usage: { promptTokens: number; completionTokens: number } | undefined;
    if (targetAgent === 'secretary' || !this.dispatchToRole) {
      if (this.agentLoop) {
        const result = await this.agentLoop.run(message);
        response = result.content;
        usage = result.usage;
      } else {
        response = [
          `[No LLM available]`,
          `Intent: ${routeResult.intent.kind}`,
          `Would route to: ${targetAgent}`,
          routeResult.confidence < 0.5
            ? `\nNote: low confidence (${(routeResult.confidence * 100).toFixed(0)}%). ${routeResult.suggestion ?? ''}`
            : '',
        ]
          .filter(Boolean)
          .join('\n');
      }
    } else {
      // Collect streaming output into a single response for non-streaming path
      let collected = '';
      await this.dispatchToRole(targetAgent, message, sessionId, {
        onChunk(content) { collected += content; },
        onDone() {},
        onError(err) { collected = err; },
      });
      response = collected || `Dispatched to ${targetAgent}.`;
    }

    this.sessionManager.addMessage(sessionId, 'assistant', response);
    return { intent: routeResult.intent, response, routeResult, usage };
  }

  /** Streaming variant — routes intent then streams LLM output token by token via callback. */
  async handleMessageStreaming(
    sessionId: string,
    message: string,
    callback: StreamingCallback,
  ): Promise<{
    intent: ParsedIntent;
    response: string;
    routeResult?: AgentRouteResult;
  }> {
    this.sessionManager.addMessage(sessionId, 'user', message);

    const routeResult = await this.intentParser.routeToAgent(message, {
      lastIntent: this.lastIntent ?? undefined,
      lastRoute: this.lastRoute ?? undefined,
    });

    this.lastIntent = routeResult.intent.kind;
    this.lastRoute = routeResult.targetAgent;

    let targetAgent = routeResult.targetAgent;
    if (routeResult.intent.kind === 'follow_up' && this.lastRoute) {
      targetAgent = this.lastRoute as AgentRoleType;
    }

    // Notify frontend of routing BEFORE streaming starts — only on actual agent switch
    if (targetAgent !== 'secretary' && targetAgent !== this.lastRoutedAgent) {
      this.lastRoutedAgent = targetAgent;
      callback.onRoutingStart?.(targetAgent);
    }

    let response: string;
    if (targetAgent === 'secretary' || !this.dispatchToRole) {
      if (this.agentLoop) {
        const result = await this.agentLoop.runStreaming(message, callback);
        response = result.content;
      } else {
        response = [
          `[No LLM available]`,
          `Intent: ${routeResult.intent.kind}`,
          `Would route to: ${targetAgent}`,
        ].filter(Boolean).join('\n');
        callback.onChunk(response);
        callback.onDone(response);
      }
    } else {
      // Specialist agents now support streaming via dispatchToRole callback
      let streamedContent = '';
      await this.dispatchToRole(targetAgent, message, sessionId, {
        onChunk(content) {
          streamedContent += content;
          callback.onChunk(content);
        },
        onThinking(content) { callback.onThinking?.(content); },
        onThinkingDone() { callback.onThinkingDone?.(); },
        onToolCall(name, args) { callback.onToolCall?.(name, args); },
        onToolResult(name, result) { callback.onToolResult?.(name, result); },
        onUsage(usage) { callback.onUsage?.(usage); },
        onDone() { callback.onDone(streamedContent); },
        onError(err) { callback.onError?.(err); },
      });
      response = streamedContent;
    }

    this.sessionManager.addMessage(sessionId, 'assistant', response);
    return { intent: routeResult.intent, response, routeResult };
  }
}
