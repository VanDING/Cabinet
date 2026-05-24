import type { AgentLoop, StreamingCallback } from '@cabinet/agent';
import type { AgentRoleType } from '@cabinet/agent';
import type { LLMGateway } from '@cabinet/gateway';
import type { DelegationTier } from '@cabinet/types';
import { IntentParser, type ParsedIntent, type AgentRouteResult } from './intent-parser.js';
import { SessionManager } from './session-manager.js';

export class SecretaryAgent {
  private readonly intentParser: IntentParser;
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
    /** Callback to store routing feedback into long-term memory. */
    private readonly storeFeedback?: (feedback: {
      message: string;
      routedAgent: string;
      correct: boolean;
      timestamp: Date;
    }) => Promise<void>,
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

    // Detect user feedback signals
    const feedback = this.detectFeedback(message);

    // Load routing state from session
    const routingState = this.sessionManager.getRoutingState(sessionId);

    // Build conversation context for routing
    const conversationContext = {
      lastIntent: routingState?.lastIntent,
      lastRoute: routingState?.lastRoute,
      topicEmbedding: routingState?.topicEmbedding,
    };

    // Route with conversation context for follow-up detection
    const routeResult = await this.intentParser.routeToAgent(message, conversationContext);

    // Update routing state
    await this.updateRoutingState(sessionId, routeResult, message);

    // Handle explicit negative feedback: re-route if user says "不对"/"换个人"
    if (feedback === 'negative' && routingState?.lastRoute) {
      routeResult.targetAgent = this.suggestAlternativeAgent(routingState.lastRoute) as AgentRoleType;
      routeResult.confidence = 0.5;
      routeResult.reasoning = 'Re-routed due to user negative feedback.';
    }

    // Track state for next message
    let targetAgent = routeResult.targetAgent;
    if (routeResult.intent.kind === 'follow_up' && routingState?.lastRoute) {
      targetAgent = routingState.lastRoute as AgentRoleType;
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

      // Post-route verification: check if specialist output matches the request
      const verified = await this.verifyRoute(message, response, targetAgent);
      if (!verified.matches && verified.correctAgent && verified.correctAgent !== targetAgent) {
        // Store negative feedback for learning
        await this.storeRouteFeedback(message, targetAgent, false);
        // Re-route to the correct agent
        const retryResponse = await this.retryWithAgent(sessionId, message, verified.correctAgent);
        response = `[Auto-corrected route] ${retryResponse}`;
        routeResult.targetAgent = verified.correctAgent as AgentRoleType;
      } else if (feedback === 'positive') {
        await this.storeRouteFeedback(message, targetAgent, true);
      }
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

    const feedback = this.detectFeedback(message);
    const routingState = this.sessionManager.getRoutingState(sessionId);

    const conversationContext = {
      lastIntent: routingState?.lastIntent,
      lastRoute: routingState?.lastRoute,
      topicEmbedding: routingState?.topicEmbedding,
    };

    const routeResult = await this.intentParser.routeToAgent(message, conversationContext);
    await this.updateRoutingState(sessionId, routeResult, message);

    if (feedback === 'negative' && routingState?.lastRoute) {
      routeResult.targetAgent = this.suggestAlternativeAgent(routingState.lastRoute) as AgentRoleType;
      routeResult.confidence = 0.5;
      routeResult.reasoning = 'Re-routed due to user negative feedback.';
    }

    let targetAgent = routeResult.targetAgent;
    if (routeResult.intent.kind === 'follow_up' && routingState?.lastRoute) {
      targetAgent = routingState.lastRoute as AgentRoleType;
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

      if (feedback === 'positive') {
        await this.storeRouteFeedback(message, targetAgent, true);
      }
    }

    this.sessionManager.addMessage(sessionId, 'assistant', response);
    return { intent: routeResult.intent, response, routeResult };
  }

  // ── Routing State Management ────────────────────────────────

  private async updateRoutingState(
    sessionId: string,
    routeResult: AgentRouteResult,
    message: string,
  ): Promise<void> {
    let topicEmbedding: number[] | undefined;
    if (this.gateway) {
      try {
        const er = await this.gateway.generateEmbeddings({ texts: [message] });
        topicEmbedding = er.embeddings[0];
      } catch {
        // Best-effort embedding
      }
    }

    this.sessionManager.setRoutingState(sessionId, {
      lastIntent: routeResult.intent.kind,
      lastRoute: routeResult.targetAgent,
      topicEmbedding: topicEmbedding ?? [],
      routedAt: new Date(),
    });
  }

  // ── Route Verification ─────────────────────────────────────

  private async verifyRoute(
    message: string,
    response: string,
    targetAgent: string,
  ): Promise<{ matches: boolean; correctAgent?: string }> {
    if (!this.gateway) return { matches: true };
    try {
      const prompt = `Original user request: "${message.slice(0, 300)}"
Agent (${targetAgent}) responded: "${response.slice(0, 500)}"
Does this response directly and appropriately address the user's original request?
If not, which single agent type would be more appropriate: secretary, decision_analyst, meeting_chair, workflow_designer, curator, reviewer, or organize?

Respond with ONLY a JSON object (no markdown, no backticks):
{"matches": true or false, "correctAgent": "agentType or null"}`;

      const result = await this.gateway.generateText({
        model: 'claude-haiku-4-5',
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 150,
        temperature: 0.1,
      });

      const match = result.content.match(/\{[\s\S]*\}/);
      if (!match) return { matches: true };
      const parsed = JSON.parse(match[0]);
      return {
        matches: !!parsed.matches,
        correctAgent: parsed.correctAgent ?? undefined,
      };
    } catch {
      return { matches: true };
    }
  }

  private async retryWithAgent(
    sessionId: string,
    message: string,
    agent: string,
  ): Promise<string> {
    if (!this.dispatchToRole) return 'No dispatch handler available.';
    let collected = '';
    await this.dispatchToRole(agent as AgentRoleType, message, sessionId, {
      onChunk(content) { collected += content; },
      onDone() {},
      onError(err) { collected = err; },
    });
    return collected || `Dispatched to ${agent}.`;
  }

  // ── Feedback Detection ─────────────────────────────────────

  private detectFeedback(message: string): 'positive' | 'negative' | 'none' {
    const lower = message.toLowerCase().trim();
    const negativeSignals = [
      '不对', '不是这个', '换个人', '错了', '不匹配', '不合适', '不好',
      'no', 'wrong', 'not this', 'not right', 'switch', 'different',
    ];
    const positiveSignals = [
      '很好', '不错', '对的', '正确', '继续', 'perfect', 'good', 'great',
      'yes', 'correct', 'exactly', 'thanks',
    ];
    if (negativeSignals.some((s) => lower.includes(s))) return 'negative';
    if (positiveSignals.some((s) => lower.includes(s))) return 'positive';
    return 'none';
  }

  private async storeRouteFeedback(
    message: string,
    routedAgent: string,
    correct: boolean,
  ): Promise<void> {
    if (this.storeFeedback) {
      await this.storeFeedback({
        message: message.slice(0, 500),
        routedAgent,
        correct,
        timestamp: new Date(),
      });
    }
  }

  private suggestAlternativeAgent(lastRoute: string): string {
    const alternatives: Record<string, string> = {
      secretary: 'curator',
      decision_analyst: 'meeting_chair',
      meeting_chair: 'decision_analyst',
      workflow_designer: 'organize',
      curator: 'secretary',
      reviewer: 'secretary',
      organize: 'workflow_designer',
    };
    return alternatives[lastRoute] ?? 'secretary';
  }
}
