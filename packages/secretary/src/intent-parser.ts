import type { AgentRoleType } from '@cabinet/agent';
import { computeTopicHash, matchIntentByPattern } from './intent-pattern-matcher.js';
import type { EmbeddingMatch } from './intent-pattern-matcher.js';

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
  | { kind: 'interrupt'; raw: string }
  | { kind: 'unknown'; raw: string };

export interface AgentRouteResult {
  targetAgent: AgentRoleType;
  confidence: number;
  reasoning: string;
  suggestion?: string;
  intent: ParsedIntent;
  topicContinuity?: boolean;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class IntentParser {
  private validAgentTypes: Set<string> = new Set(['secretary', 'organize']);
  private customAgents: Map<
    string,
    { description: string; keywords?: string[]; aliases?: string[] }
  > = new Map();
  private sessionRoutingCache = new Map<
    string,
    { lastAgent: string; lastTimestamp: number; topicHash: string }
  >();

  setAgentDescriptions(_desc: string): void {
    /* no-op in Mastra mode */
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

  setCaptainPreferences(_prefsContext: string): void {
    /* no-op in Mastra mode */
  }

  parse(message: string, conversationContext?: ConversationContext): ParsedIntent {
    return matchIntentByPattern(message, conversationContext);
  }

  async warmupEmbeddings(): Promise<void> {
    /* no-op in Mastra mode — embeddings handled by Mastra observability */
  }

  async parseWithLLM(
    message: string,
    conversationContext?: ConversationContext,
  ): Promise<ParsedIntent> {
    return matchIntentByPattern(message, conversationContext);
  }

  async routeToAgent(
    message: string,
    conversationContext?: ConversationContext,
    sessionId?: string,
  ): Promise<AgentRouteResult> {
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
            reasoning: 'Short-circuit: continuing with Secretary.',
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

    const fastIntent = matchIntentByPattern(message, conversationContext);

    if (sessionId) {
      this.sessionRoutingCache.set(sessionId, {
        lastAgent: 'secretary',
        lastTimestamp: Date.now(),
        topicHash: computeTopicHash(message),
      });
    }

    return this.fallbackRoute(fastIntent, message);
  }

  private fallbackRoute(intent: ParsedIntent, message?: string): AgentRouteResult {
    let targetAgent: AgentRoleType = 'secretary';
    let reasoning = 'Pattern-based routing.';

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
            reasoning: `Custom agent "${name}" matched.`,
            intent,
          };
        }
        for (const alias of info.aliases ?? []) {
          const aliasRegex = new RegExp(`\\b${escapeRegex(alias.toLowerCase())}\\b`, 'i');
          if (aliasRegex.test(lowerMsg)) {
            return {
              targetAgent: name as AgentRoleType,
              confidence: 0.75,
              reasoning: `Custom agent "${name}" matched via alias.`,
              intent,
            };
          }
        }
        for (const kw of info.keywords ?? []) {
          if (words.includes(kw.toLowerCase())) {
            return {
              targetAgent: name as AgentRoleType,
              confidence: 0.7,
              reasoning: `Custom agent "${name}" matched via keyword.`,
              intent,
            };
          }
        }
      }
    }

    switch (intent.kind) {
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
