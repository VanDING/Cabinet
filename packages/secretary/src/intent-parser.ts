import type { LLMGateway } from '@cabinet/gateway';
import type { AgentRoleType } from '@cabinet/agent';

export type ParsedIntent =
  | { kind: 'decision_request'; topic: string; context: string; suggestedDimensions: string[] }
  | { kind: 'meeting_request'; topic: string; requiredPerspectives: string[] }
  | { kind: 'status_query'; target: 'project' | 'decision' | 'workflow'; filters: Record<string, string> }
  | { kind: 'knowledge_query'; question: string; scope: 'short_term' | 'long_term' | 'both' }
  | { kind: 'unknown'; raw: string };

// ── Agent Routing ─────────────────────────────────────────────

export interface AgentRouteResult {
  /** The recommended agent type. */
  targetAgent: AgentRoleType;
  /** Confidence 0.0–1.0. Below 0.5 means the router is uncertain. */
  confidence: number;
  /** Why this agent was chosen. */
  reasoning: string;
  /** When confidence is low, a suggestion for the Captain. */
  suggestion?: string;
  /** The original parsed intent (for backward compatibility). */
  intent: ParsedIntent;
}

export class IntentParser {
  private availableAgentsDesc = '';

  constructor(private readonly gateway?: LLMGateway) {}

  /** Set agent descriptions for routing (called by server layer). */
  setAgentDescriptions(desc: string): void {
    this.availableAgentsDesc = desc;
  }

  // ── Keyword Parsing (fast path, no LLM) ───────────────────

  parse(message: string): ParsedIntent {
    const lower = message.toLowerCase();

    if (lower.includes('什么') || lower.includes('如何') || lower.includes('怎么') || lower.includes('为什么')) {
      return {
        kind: 'knowledge_query',
        question: message,
        scope: 'both',
      };
    }

    if (lower.includes('分析') || lower.includes('是否') || lower.includes('该不该') || lower.includes('决策')) {
      return {
        kind: 'decision_request',
        topic: message.slice(0, 100),
        context: message,
        suggestedDimensions: ['成本', '风险', '时间', '收益'],
      };
    }

    if (lower.includes('组织') || lower.includes('讨论') || lower.includes('会议') || lower.includes('顾问')) {
      return {
        kind: 'meeting_request',
        topic: message,
        requiredPerspectives: ['general'],
      };
    }

    if (lower.includes('状态') || lower.includes('进度') || lower.includes('查询')) {
      return {
        kind: 'status_query',
        target: 'project',
        filters: { query: message },
      };
    }

    return { kind: 'unknown', raw: message };
  }

  // ── LLM-powered Intent Classification ─────────────────────

  async parseWithLLM(message: string): Promise<ParsedIntent> {
    if (!this.gateway) return this.parse(message);

    try {
      const prompt = `Classify this user message into one of these intents:

- decision_request: user wants to analyze/decide something
- meeting_request: user wants to organize advisors to discuss something
- status_query: user asks about project/decision/workflow status
- knowledge_query: user asks a general question

Respond with ONLY a JSON object:
{
  "kind": "one of the above",
  "topic": "brief topic",
  "context": "full context",
  "suggestedDimensions": ["dim1", "dim2"],
  "requiredPerspectives": ["finance", "legal"],
  "target": "project|decision|workflow",
  "question": "the question"
}

Message: "${message}"`;

      const response = await this.gateway.generateText({
        model: 'claude-haiku-4-5',
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 300,
        temperature: 0.1,
      });

      return this.parseJSONIntent(response.content);
    } catch {
      return this.parse(message);
    }
  }

  // ── LLM-powered Agent Routing ─────────────────────────────

  async routeToAgent(message: string): Promise<AgentRouteResult> {
    const intent = this.gateway
      ? await this.parseWithLLM(message)
      : this.parse(message);

    if (!this.gateway) {
      // No LLM: route based on keyword intent
      return this.fallbackRoute(intent);
    }

    const agentList = this.availableAgentsDesc || [
      '- secretary: General conversation and intent routing',
      '- decision_analyst: Structured decision analysis and option evaluation',
      '- meeting_chair: Multi-perspective deliberation and consensus synthesis',
      '- workflow_designer: Workflow creation, modification, and execution',
      '- curator: Memory consolidation, progress summaries, pattern extraction',
    ].join('\n');

    try {
      const prompt = `You are a router in the Cabinet AI framework. Choose the best cabinet member to handle this request.

Available agents:
${agentList}

Routing guidelines:
- secretary: General questions, casual conversation, simple information retrieval
- decision_analyst: The user is facing a choice, evaluating options, or making a decision
- meeting_chair: The topic needs multiple perspectives, expert opinions, or debate
- workflow_designer: The user wants to create/design/run a multi-step process
- curator: The user asks about past events, project status, progress, or patterns

Respond with ONLY a JSON object (no markdown, no backticks):
{
  "targetAgent": "one of the agent types above",
  "confidence": 0.0 to 1.0,
  "reasoning": "one sentence explaining why",
  "suggestion": "if confidence < 0.5, suggest what kind of specialist might help, otherwise null"
}

Message: "${message}"`;

      const response = await this.gateway.generateText({
        model: 'claude-haiku-4-5',
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 250,
        temperature: 0.1,
      });

      return this.parseRouteResult(response.content, intent);
    } catch {
      return this.fallbackRoute(intent);
    }
  }

  // ── Private ───────────────────────────────────────────────

  private parseRouteResult(json: string, intent: ParsedIntent): AgentRouteResult {
    try {
      const match = json.match(/\{[\s\S]*\}/);
      if (!match) return this.fallbackRoute(intent);

      const parsed = JSON.parse(match[0]);
      const validAgents = new Set([
        'secretary', 'decision_analyst', 'meeting_chair',
        'workflow_designer', 'curator', 'agent_creator',
      ]);

      return {
        targetAgent: validAgents.has(parsed.targetAgent)
          ? parsed.targetAgent
          : 'secretary',
        confidence: typeof parsed.confidence === 'number'
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0.7,
        reasoning: parsed.reasoning ?? 'No reasoning provided.',
        suggestion: parsed.suggestion ?? undefined,
        intent,
      };
    } catch {
      return this.fallbackRoute(intent);
    }
  }

  private fallbackRoute(intent: ParsedIntent): AgentRouteResult {
    // Keyword-based routing fallback
    let targetAgent: AgentRoleType = 'secretary';
    let reasoning = 'Default routing (no LLM available).';

    switch (intent.kind) {
      case 'decision_request':
        targetAgent = 'decision_analyst';
        reasoning = 'Decision-related request routed to Decision Analyst.';
        break;
      case 'meeting_request':
        targetAgent = 'meeting_chair';
        reasoning = 'Meeting/discussion request routed to Meeting Chair.';
        break;
      case 'status_query':
        targetAgent = 'curator';
        reasoning = 'Status query routed to Curator.';
        break;
      case 'knowledge_query':
        targetAgent = 'secretary';
        reasoning = 'Knowledge query handled by Secretary.';
        break;
    }

    return {
      targetAgent,
      confidence: 0.6,
      reasoning,
      intent,
    };
  }

  private parseJSONIntent(json: string): ParsedIntent {
    try {
      const match = json.match(/\{[\s\S]*\}/);
      if (!match) return { kind: 'unknown', raw: json };
      const parsed = JSON.parse(match[0]);
      return {
        kind: parsed.kind ?? 'unknown',
        topic: parsed.topic ?? '',
        context: parsed.context ?? '',
        suggestedDimensions: parsed.suggestedDimensions ?? [],
        requiredPerspectives: parsed.requiredPerspectives ?? [],
        target: parsed.target,
        question: parsed.question,
        filters: parsed.filters ?? {},
        raw: json,
      } as ParsedIntent;
    } catch {
      return { kind: 'unknown', raw: json };
    }
  }
}
