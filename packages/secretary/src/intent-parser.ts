/**
 * IntentParser — thin orchestrator for intent classification and agent routing.
 *
 * 4-layer cascade:
 *   1. Keyword matching     (intent-pattern-matcher.ts)
 *   2. Regex matching       (intent-pattern-matcher.ts)
 *   3. Embedding similarity (intent-embedding-matcher.ts)
 *   4. LLM fallback          (intent-llm-router.ts)
 */
import type { LLMGateway } from '@cabinet/gateway';
import type { AgentRoleType } from '@cabinet/agent';
import { cosineSimilarity } from '@cabinet/types';
import { computeTopicHash, matchIntentByPattern } from './intent-pattern-matcher.js';
import type { EmbeddingMatch } from './intent-pattern-matcher.js';
import {
  warmupEmbeddings,
  isEmbeddingsWarmed,
  matchIntentByEmbedding,
  buildIntentFromMatch,
} from './intent-embedding-matcher.js';
import { parseWithLLM, routeWithLLM as llmRouteWithLLM } from './intent-llm-router.js';

// ── Re-export types for backward compatibility ──

export type { EmbeddingMatch } from './intent-pattern-matcher.js';

export interface ConversationContext {
  lastIntent?: string;
  lastRoute?: string;
  topicEmbedding?: number[];
}

export type ParsedIntent =
  | { kind: 'decision_request'; topic: string; context: string; suggestedDimensions: string[] }
  | { kind: 'meeting_request'; topic: string; requiredPerspectives: string[] }
  | {
      kind: 'status_query';
      target: 'project' | 'decision' | 'workflow';
      filters: Record<string, string>;
    }
  | { kind: 'knowledge_query'; question: string; scope: 'short_term' | 'long_term' | 'both' }
  | { kind: 'review_request'; target: string; context: string }
  | { kind: 'organize_request'; topic: string; context: string }
  | { kind: 'skill_request'; topic: string; context: string }
  | { kind: 'invoke_skill'; skillName: string; args: string; raw: string }
  | { kind: 'mcp_request'; topic: string; context: string }
  | { kind: 'schedule_request'; topic: string; context: string }
  | { kind: 'follow_up'; previousKind: string; raw: string }
  | { kind: 'unknown'; raw: string };

export interface AgentRouteResult {
  targetAgent: AgentRoleType;
  confidence: number;
  reasoning: string;
  suggestion?: string;
  intent: ParsedIntent;
  topicContinuity?: boolean;
}

// ── Utility ──

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── IntentParser Class ──

export class IntentParser {
  private availableAgentsDesc = '';
  private validAgentTypes: Set<string> = new Set(['secretary', 'organize']);
  private customAgents: Map<
    string,
    { description: string; keywords?: string[]; aliases?: string[] }
  > = new Map();
  private sessionRoutingCache = new Map<
    string,
    { lastAgent: string; lastTimestamp: number; topicHash: string }
  >();
  private model: string;
  private captainPrefsContext = '';

  constructor(
    private readonly gateway?: LLMGateway,
    model?: string,
  ) {
    this.model = model ?? 'claude-sonnet-4-6';
  }

  // ── Configuration Setters ──

  setAgentDescriptions(desc: string): void {
    this.availableAgentsDesc = desc;
  }

  setValidAgentTypes(types: Set<string>): void {
    this.validAgentTypes = types;
  }

  setCustomAgents(
    agents: Map<string, string | { description: string; keywords?: string[]; aliases?: string[] }>,
  ): void {
    const normalized = new Map<
      string,
      { description: string; keywords?: string[]; aliases?: string[] }
    >();
    for (const [name, info] of agents) {
      if (typeof info === 'string') {
        const defaultKeywords = name
          .toLowerCase()
          .split(/[\s\-_]+/)
          .filter((k) => k.length > 1);
        normalized.set(name, { description: info, keywords: defaultKeywords, aliases: [] });
      } else {
        normalized.set(name, info);
      }
    }
    this.customAgents = normalized;
  }

  setCaptainPreferences(prefsContext: string): void {
    this.captainPrefsContext = prefsContext;
  }

  // ── Public API ──

  /** Fast keyword/regex-based intent matching (no LLM). */
  parse(message: string, conversationContext?: ConversationContext): ParsedIntent {
    return matchIntentByPattern(message, conversationContext);
  }

  /** Warm up example embeddings (call once at startup). Idempotent. */
  async warmupEmbeddings(): Promise<void> {
    return warmupEmbeddings(this.gateway);
  }

  /** LLM-powered intent classification fallback. */
  async parseWithLLM(
    message: string,
    conversationContext?: ConversationContext,
  ): Promise<ParsedIntent> {
    return parseWithLLM(message, this.gateway, this.model, conversationContext);
  }

  // ── Main Routing Method ──

  async routeToAgent(
    message: string,
    conversationContext?: ConversationContext,
    sessionId?: string,
  ): Promise<AgentRouteResult> {
    // Short-circuit: continuing with secretary
    if (sessionId) {
      const cached = this.sessionRoutingCache.get(sessionId);
      if (cached && cached.lastAgent === 'secretary') {
        const noAgentMention = !message.includes('@');
        const noSkillPrefix = !message.startsWith('/');
        const withinWindow = Date.now() - cached.lastTimestamp < 5 * 60 * 1000;
        const topicStable = computeTopicHash(message) === cached.topicHash;
        if (noAgentMention && noSkillPrefix && withinWindow && topicStable) {
          return {
            targetAgent: 'secretary',
            confidence: 0.95,
            reasoning:
              'Short-circuit: continuing with Secretary (no agent mention, no skill prefix, topic stable).',
            intent: {
              kind: 'follow_up',
              previousKind: conversationContext?.lastIntent ?? 'unknown',
              raw: message,
            },
            topicContinuity: true,
          };
        }
      }
    }

    // Ensure embeddings are warmed up
    await warmupEmbeddings(this.gateway);

    // Fast path: keyword-based parsing (no LLM call)
    const fastIntent = matchIntentByPattern(message, conversationContext);

    if (!this.gateway) {
      return this.fallbackRoute(fastIntent, message);
    }

    // Topic continuity check via semantic similarity
    if (conversationContext?.topicEmbedding && conversationContext.lastRoute) {
      try {
        const userResult = await this.gateway.generateEmbeddings({ texts: [message] });
        const userEmbedding = userResult.embeddings[0];
        if (userEmbedding) {
          const topicSim = cosineSimilarity(userEmbedding, conversationContext.topicEmbedding);
          if (topicSim > 0.7) {
            return {
              targetAgent: conversationContext.lastRoute as AgentRoleType,
              confidence: 0.85,
              reasoning: 'Topic continuation detected via semantic similarity.',
              intent: {
                kind: 'follow_up',
                previousKind: conversationContext.lastIntent ?? 'unknown',
                raw: message,
              },
              topicContinuity: true,
            };
          }
        }
      } catch {
        // Best-effort topic continuity check
      }
    }

    // Fast path: high-confidence explicit action intents
    const highConfidenceIntents = new Set([
      'decision_request',
      'meeting_request',
      'organize_request',
      'review_request',
    ]);
    if (highConfidenceIntents.has(fastIntent.kind)) {
      return this.fallbackRoute(fastIntent, message);
    }

    // ── Unified scoring phase ──
    interface RouteCandidate {
      agent: AgentRoleType;
      score: number;
      sources: { keyword?: number; embedding?: number; llm?: number };
      reasoning: string;
      intent: ParsedIntent;
    }

    const candidates: RouteCandidate[] = [];

    // Keyword layer
    if (fastIntent.kind !== 'unknown') {
      const keywordRoute = this.fallbackRoute(fastIntent, message);
      candidates.push({
        agent: keywordRoute.targetAgent,
        score: 0.5,
        sources: { keyword: 0.5 },
        reasoning: keywordRoute.reasoning,
        intent: fastIntent,
      });
    }

    // Embedding layer
    const embeddingMatch = isEmbeddingsWarmed()
      ? await matchIntentByEmbedding(message, this.gateway)
      : null;
    if (embeddingMatch) {
      const embIntent = buildIntentFromMatch(embeddingMatch, message);
      const embRoute = this.fallbackRoute(embIntent, message);
      candidates.push({
        agent: embRoute.targetAgent,
        score: embeddingMatch.confidence,
        sources: { embedding: embeddingMatch.confidence },
        reasoning: `Embedding semantic match: "${embeddingMatch.topExample}" (confidence: ${(embeddingMatch.confidence * 100).toFixed(0)}%)`,
        intent: embIntent,
      });
      if (embeddingMatch.confidence > 0.65) {
        return {
          targetAgent: embRoute.targetAgent,
          confidence: embeddingMatch.confidence,
          reasoning: `Embedding semantic match: "${embeddingMatch.topExample}" (confidence: ${(embeddingMatch.confidence * 100).toFixed(0)}%)`,
          intent: embIntent,
        };
      }
    }

    // If best non-LLM score is already decent, skip LLM
    const bestNonLLM =
      candidates.length > 0
        ? candidates.reduce((best, c) => (c.score > best.score ? c : best))
        : null;
    if (bestNonLLM && bestNonLLM.score >= 0.6) {
      return {
        targetAgent: bestNonLLM.agent,
        confidence: bestNonLLM.score,
        reasoning: `${bestNonLLM.reasoning} [sources: ${Object.keys(bestNonLLM.sources).join(', ')}]`,
        intent: bestNonLLM.intent,
      };
    }

    // LLM layer
    try {
      const llmIntent = await parseWithLLM(message, this.gateway, this.model, conversationContext);
      const llmRoute = await llmRouteWithLLM(
        message,
        llmIntent,
        this.gateway!,
        this.model,
        this.availableAgentsDesc,
        this.validAgentTypes,
        this.captainPrefsContext,
        conversationContext,
        embeddingMatch,
        (intent, msg) => this.fallbackRoute(intent, msg),
      );
      candidates.push({
        agent: llmRoute.targetAgent,
        score: llmRoute.confidence,
        sources: {
          llm: llmRoute.confidence,
          ...(llmRoute.topicContinuity ? { embedding: embeddingMatch?.confidence } : {}),
        },
        reasoning: llmRoute.reasoning,
        intent: llmIntent,
      });
    } catch {
      // LLM failure is non-fatal
    }

    // ── Decision phase ──
    if (candidates.length === 0) {
      return this.fallbackRoute(fastIntent, message);
    }

    const best = candidates.reduce((a, b) => (a.score >= b.score ? a : b));

    const result: AgentRouteResult = {
      targetAgent: best.agent,
      confidence: best.score,
      reasoning: `${best.reasoning} [scored: keyword=${best.sources.keyword ?? 'N/A'}, embedding=${best.sources.embedding ?? 'N/A'}, llm=${best.sources.llm ?? 'N/A'}]`,
      intent: best.intent,
    };

    if (best.score < 0.5) {
      result.suggestion =
        'The request is unclear. Try rephrasing with more specific keywords (e.g., "decide", "workflow", "review").';
    }

    // Update routing cache
    if (sessionId) {
      this.sessionRoutingCache.set(sessionId, {
        lastAgent: result.targetAgent,
        lastTimestamp: Date.now(),
        topicHash: computeTopicHash(message),
      });
    }

    return result;
  }

  // ── Fallback Route ──

  private fallbackRoute(intent: ParsedIntent, message?: string): AgentRouteResult {
    let targetAgent: AgentRoleType = 'secretary';
    let reasoning = 'Default routing (no LLM available).';

    // Custom agent detection
    if (message) {
      const lowerMsg = message.toLowerCase();
      const words = lowerMsg.split(/[\s,，。！？、；：""''（）()[\]{}]+/).filter(Boolean);

      for (const [name, info] of this.customAgents) {
        const lowerName = name.toLowerCase();
        const nameRegex = new RegExp(`\\b${escapeRegex(lowerName)}\\b`, 'i');
        if (nameRegex.test(lowerMsg)) {
          return {
            targetAgent: name as AgentRoleType,
            confidence: 0.8,
            reasoning: `Custom agent "${name}" matched in user message.`,
            intent,
          };
        }

        for (const alias of info.aliases ?? []) {
          const aliasRegex = new RegExp(`\\b${escapeRegex(alias.toLowerCase())}\\b`, 'i');
          if (aliasRegex.test(lowerMsg)) {
            return {
              targetAgent: name as AgentRoleType,
              confidence: 0.75,
              reasoning: `Custom agent "${name}" matched via alias "${alias}".`,
              intent,
            };
          }
        }

        for (const kw of info.keywords ?? []) {
          if (words.includes(kw.toLowerCase())) {
            return {
              targetAgent: name as AgentRoleType,
              confidence: 0.7,
              reasoning: `Custom agent "${name}" matched via keyword "${kw}".`,
              intent,
            };
          }
        }
      }
    }

    switch (intent.kind) {
      case 'decision_request':
      case 'meeting_request':
      case 'status_query':
      case 'knowledge_query':
      case 'invoke_skill':
      case 'schedule_request':
      case 'review_request':
      case 'follow_up':
        targetAgent = 'secretary';
        reasoning =
          intent.kind === 'meeting_request'
            ? 'Meeting/discussion request routed to Secretary (Meeting Chair removed — Secretary handles multi-agent coordination).'
            : intent.kind === 'review_request'
              ? 'Review requests handled by Secretary (Reviewer is meeting-only quality gate).'
              : `${intent.kind} handled by Secretary.`;
        break;
      case 'organize_request':
      case 'skill_request':
      case 'mcp_request':
        targetAgent = 'organize';
        reasoning = 'Creation/design request routed to Organize Agent.';
        break;
    }

    return { targetAgent, confidence: 0.6, reasoning, intent };
  }
}
