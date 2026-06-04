import type { AgentLoop, StreamingCallback } from '@cabinet/agent';
import type { AgentRoleType } from '@cabinet/agent';
import type { LLMGateway } from '@cabinet/gateway';
import type { DelegationTier } from '@cabinet/types';
import { IntentParser, type ParsedIntent, type AgentRouteResult } from './intent-parser.js';
import { SessionManager } from './session-manager.js';

export interface RouteFeedback {
  message: string;
  routedAgent: string;
  correct: boolean;
  timestamp: Date;
  previousRoute?: string;
}

export interface FeedbackStore {
  store(feedback: RouteFeedback): Promise<void>;
  query(
    previousRoute: string,
    correct: boolean,
    limit?: number,
  ): Promise<{ targetAgent: string; count: number }[]>;
}

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
    /** Feedback store for route learning (store + query). */
    private readonly feedbackStore?: FeedbackStore,
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
    const routeResult = await this.intentParser.routeToAgent(message, conversationContext, sessionId);

    // Update routing state
    await this.updateRoutingState(sessionId, routeResult, message);

    // Handle explicit negative feedback: re-route if user says "不对"/"换个人"
    if (feedback === 'negative' && routingState?.lastRoute) {
      await this.storeRouteFeedback(message, routingState.lastRoute, false, routingState.lastRoute);
      routeResult.targetAgent = (await this.suggestAlternativeAgent(
        message,
        routingState.lastRoute,
      )) as AgentRoleType;
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
      // Orchestrator mode: run specialist first, then secretary synthesizes
      const specialistResult = await this.runSpecialist(targetAgent, message, sessionId);
      response = specialistResult.response;

      // Post-route verification: only for low-confidence routes, check if specialist output matches
      if (routeResult.confidence < 0.6) {
        const verified = await this.verifyRoute(message, response, targetAgent);
        if (!verified.matches && verified.correctAgent && verified.correctAgent !== targetAgent) {
          await this.storeRouteFeedback(message, targetAgent, false, routingState?.lastRoute);
          // Auto re-dispatch to the suggested agent instead of just appending a note
          try {
            const reRoutedResult = await this.runSpecialist(
              verified.correctAgent as AgentRoleType,
              message,
              sessionId,
            );
            response = reRoutedResult.response;
            targetAgent = verified.correctAgent as AgentRoleType;
          } catch {
            response = `${response}\n\n---\n[系统提示：${targetAgent} 的输出可能未完全匹配您的请求。${verified.correctAgent} 可能更适合。如需要，请告诉我切换。]`;
          }
        }
      }
      if (feedback === 'positive') {
        await this.storeRouteFeedback(message, targetAgent, true, routingState?.lastRoute);
      }

      // Synthesize through secretary
      if (this.agentLoop) {
        const synthesis = this.buildSynthesisPrompt(targetAgent, message, response);
        const result = await this.agentLoop.run(synthesis);
        response = result.content;
        usage = result.usage;
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

    const routeResult = await this.intentParser.routeToAgent(message, conversationContext, sessionId);
    await this.updateRoutingState(sessionId, routeResult, message);

    if (feedback === 'negative' && routingState?.lastRoute) {
      routeResult.targetAgent = (await this.suggestAlternativeAgent(
        message,
        routingState.lastRoute,
      )) as AgentRoleType;
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
        ]
          .filter(Boolean)
          .join('\n');
        callback.onChunk(response);
        callback.onDone(response);
      }
    } else {
      // Orchestrator mode: track specialist activity, then secretary synthesizes
      callback.onSubAgentStart?.(targetAgent, message);
      let streamedContent = '';
      const toolCalls: { name: string; args: Record<string, unknown> }[] = [];
      await this.dispatchToRole(targetAgent, message, sessionId, {
        onChunk(content) {
          streamedContent += content;
        },
        onThinking(content) {
          callback.onSubAgentThinking?.(targetAgent, content);
        },
        onThinkingDone() {
          callback.onThinkingDone?.();
        },
        onToolCall(name, args) {
          toolCalls.push({ name, args });
          callback.onSubAgentToolCall?.(targetAgent, name, args);
        },
        onToolResult(name, result) {
          callback.onSubAgentToolCall?.(targetAgent, `${name}_result`, { result });
        },
        onUsage(usage) {
          callback.onUsage?.(usage);
        },
        onQualityReview(result) {
          callback.onQualityReview?.(result);
        },
        onDone() {
          callback.onSubAgentDone?.(targetAgent, streamedContent);
        },
        onError(err) {
          callback.onSubAgentError?.(targetAgent, err);
        },
      });
      response = streamedContent;

      if (feedback === 'positive') {
        await this.storeRouteFeedback(message, targetAgent, true, routingState?.lastRoute);
      }

      // Secretary synthesizes specialist output for the Captain
      if (this.agentLoop) {
        const synthesisPrompt = this.buildSynthesisPrompt(targetAgent, message, response);
        const result = await this.agentLoop.runStreaming(synthesisPrompt, callback);
        response = result.content;
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
If not, which single agent type would be more appropriate: secretary, organize, or a custom/external agent?

Respond with ONLY a JSON object (no markdown, no backticks):
{"matches": true or false, "correctAgent": "agentType or null"}`;

      const result = await Promise.race([
        this.gateway.generateText({
          model: 'claude-haiku-4-5',
          messages: [{ role: 'user', content: prompt }],
          maxTokens: 150,
          temperature: 0.1,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Verification timeout')), 3000),
        ),
      ]);

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

  // ── Orchestrator helpers ────────────────────────────────────

  private async runSpecialist(
    targetAgent: string,
    message: string,
    sessionId: string,
  ): Promise<{ response: string }> {
    if (!this.dispatchToRole) return { response: `No dispatch handler for ${targetAgent}.` };
    let collected = '';
    await this.dispatchToRole(targetAgent as AgentRoleType, message, sessionId, {
      onChunk(content) {
        collected += content;
      },
      onDone() {},
      onError(err) {
        collected = err;
      },
    });
    return { response: collected || `Dispatched to ${targetAgent}.` };
  }

  private buildSynthesisPrompt(
    agentName: string,
    originalMessage: string,
    specialistOutput: string,
  ): string {
    const MAX_OUTPUT = 8000;
    let outputSnippet: string;
    if (specialistOutput.length <= MAX_OUTPUT) {
      outputSnippet = specialistOutput;
    } else {
      const head = specialistOutput.slice(0, 5000);
      const tail = specialistOutput.slice(-2500);
      const omitted = specialistOutput.length - 5000 - 2500;
      outputSnippet = `${head}\n\n[... ${omitted} chars omitted from middle ...]\n\n${tail}`;
    }
    return [
      `The ${agentName} specialist has completed the following task for the Captain.`,
      ``,
      `Original request: "${originalMessage.slice(0, 300)}"`,
      ``,
      `[${agentName} output]`,
      outputSnippet,
      ``,
      `Please synthesize a clear, concise response for the Captain. Highlight key findings, decisions needed, and next steps. Do not mention the specialist agent unless relevant.`,
    ].join('\n');
  }

  // ── Feedback Detection ─────────────────────────────────────

  private detectFeedback(message: string): 'positive' | 'negative' | 'none' {
    const lower = message.toLowerCase().trim();
    const negativeSignals = [
      '不对',
      '不是这个',
      '换个人',
      '错了',
      '不匹配',
      '不合适',
      '不好',
      'no',
      'wrong',
      'not this',
      'not right',
      'switch',
      'different',
    ];
    // '继续' intentionally excluded — it means "continue", not feedback
    const positiveSignals = [
      '很好',
      '不错',
      '对的',
      '正确',
      'perfect',
      'good',
      'great',
      'yes',
      'correct',
      'exactly',
      'thanks',
    ];
    const hasNegative = negativeSignals.some((s) => lower.includes(s));
    const hasPositive = positiveSignals.some((s) => lower.includes(s));

    // Both signals present = ambiguous, skip
    if (hasNegative && hasPositive) return 'none';

    if (!hasNegative && hasPositive) {
      // Short acknowledgment (<15 chars) is likely real feedback
      if (lower.length < 15) return 'positive';
      // Longer messages: only treat as positive if no substantive query words are present
      const substantiveWords = ['什么', '如何', '怎么', '为什么', '分析', '帮我', '方案', '项目', '代码'];
      if (!substantiveWords.some((w) => lower.includes(w))) return 'positive';
      return 'none';
    }

    if (hasNegative) return 'negative';
    return 'none';
  }

  private async storeRouteFeedback(
    message: string,
    routedAgent: string,
    correct: boolean,
    previousRoute?: string,
  ): Promise<void> {
    if (this.feedbackStore) {
      await this.feedbackStore.store({
        message: message.slice(0, 500),
        routedAgent,
        correct,
        timestamp: new Date(),
        previousRoute,
      });
    }
  }

  private async suggestAlternativeAgent(message: string, lastRoute: string): Promise<string> {
    // Query feedback history for successful re-routes from this previous route
    if (this.feedbackStore) {
      try {
        const history = await this.feedbackStore.query(lastRoute, true, 10);
        if (history && history.length > 0) {
          // Pick the most common successful alternative
          const alt = history[0];
          if (alt) return alt.targetAgent;
        }
      } catch {
        // Feedback query failure is non-fatal
      }
    }

    // Fallback: intent-based heuristic
    const lower = message.toLowerCase();
    let detectedIntent: string | null = null;
    if (
      lower.includes('决策') ||
      lower.includes('选择') ||
      lower.includes('对比') ||
      lower.includes('分析')
    ) {
      detectedIntent = 'decision_request';
    } else if (lower.includes('会议') || lower.includes('讨论') || lower.includes('顾问')) {
      detectedIntent = 'meeting_request';
    } else if (lower.includes('流程') || lower.includes('workflow') || lower.includes('步骤')) {
      detectedIntent = 'organize_request';
    } else if (lower.includes('组织') || lower.includes('设计') || lower.includes('架构')) {
      detectedIntent = 'organize_request';
    } else if (lower.includes('审查') || lower.includes('检查') || lower.includes('review')) {
      detectedIntent = 'review_request';
    }

    const intentBased: Record<string, string> = {
      decision_request: 'secretary',
      meeting_request: 'secretary',
      organize_request: 'organize',
      review_request: 'secretary',
      status_query: 'secretary',
      skill_request: 'organize',
      mcp_request: 'organize',
    };
    if (detectedIntent) {
      const alt = intentBased[detectedIntent];
      if (alt) return alt;
    }

    return 'secretary';
  }
}
