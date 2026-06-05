/**
 * LLM Router — LLM-powered intent classification and agent routing.
 * Extracted from IntentParser class methods: parseWithLLM, routeWithLLM,
 * parseJSONIntent, parseRouteResult.
 */
import type { LLMGateway } from '@cabinet/gateway';
import type { AgentRoleType } from '@cabinet/agent';
import { matchIntentByPattern } from './intent-pattern-matcher.js';
import type { EmbeddingMatch } from './intent-pattern-matcher.js';
import type {
  ParsedIntent,
  ConversationContext,
  AgentRouteResult,
} from './intent-parser.js';

// ── LLM-powered Intent Classification ──

export async function parseWithLLM(
  message: string,
  gateway: LLMGateway | undefined,
  model: string,
  conversationContext?: ConversationContext,
): Promise<ParsedIntent> {
  if (!gateway) return matchIntentByPattern(message, conversationContext);

  try {
    const fewShotExamples = `
Examples:
1. Message: "帮我分析一下该不该投资这个项目"
   → {"kind": "decision_request", "topic": "投资这个项目", "context": "...", "suggestedDimensions": ["成本", "风险", "时间", "收益"]}
2. Message: "组织一个会议讨论下季度计划"
   → {"kind": "meeting_request", "topic": "下季度计划", "requiredPerspectives": ["general"]}
3. Message: "查询一下项目当前进度"
   → {"kind": "status_query", "target": "project", "filters": {"query": "项目当前进度"}}
4. Message: "什么是我们的核心竞争优势"
   → {"kind": "knowledge_query", "question": "什么是我们的核心竞争优势", "scope": "both"}
5. Message: "帮我设计一个自动化的数据处理工作流"
   → {"kind": "organize_request", "topic": "数据处理工作流", "context": "..."}
6. Message: "review一下这个方案的质量"
   → {"kind": "review_request", "target": "方案", "context": "review一下这个方案的质量"}
7. Message: "搭建一个市场营销体系"
   → {"kind": "organize_request", "topic": "市场营销体系", "context": "..."}
8. Message: "帮我设置一个每天执行的任务"
   → {"kind": "schedule_request", "topic": "每天执行的任务", "context": "..."}
9. Message: "帮我写一个skill"
   → {"kind": "skill_request", "topic": "写一个skill", "context": "..."}
10. Message: "搭一个mcp server"
    → {"kind": "mcp_request", "topic": "搭一个mcp server", "context": "..."}
11. Message: "/workflow-designer"
    → {"kind": "invoke_skill", "skillName": "workflow-designer", "args": "", "raw": "/workflow-designer"}
12. Message: "继续"
    → {"kind": "follow_up", "previousKind": "(from conversation context)", "raw": "继续"}`;

    const historyConstraint = conversationContext?.lastIntent
      ? `\nHistory context: The previous message was classified as "${conversationContext.lastIntent}". If this message is a continuation of the same topic (same entities, task, or files), prefer the same intent unless the user explicitly switches topics.`
      : '';

    const prompt = `Classify this user message into one of these intents:

- decision_request: user wants to analyze/decide something
- meeting_request: user wants to organize advisors to discuss something
- status_query: user asks about project/decision/workflow status
- knowledge_query: user asks a general question
- review_request: user wants to review/audit/check quality of something
- organize_request: user wants to design/build/architect an organization, system, workflow, or agent
- skill_request: user wants to create/edit/optimize a skill or SKILL.md
- invoke_skill: user wants to invoke/run an existing skill (message starts with /skillName)
- mcp_request: user wants to build an MCP server
- schedule_request: user wants to create a scheduled/recurring task
- follow_up: user is continuing or elaborating on a previous topic
- unknown: none of the above
${fewShotExamples}${historyConstraint}

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

    const response = await gateway.generateText({
      model,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 400,
      temperature: 0.1,
    });

    return parseJSONIntent(response.content);
  } catch {
    return matchIntentByPattern(message, conversationContext);
  }
}

// ── Parse JSON Intent ──

export function parseJSONIntent(json: string): ParsedIntent {
  try {
    const match = json.match(/\{[\s\S]*\}/);
    if (!match) return { kind: 'unknown', raw: json };
    const parsed = JSON.parse(match[0]);
    const base = {
      kind: parsed.kind ?? 'unknown',
      topic: parsed.topic ?? '',
      context: parsed.context ?? '',
      suggestedDimensions: parsed.suggestedDimensions ?? [],
      requiredPerspectives: parsed.requiredPerspectives ?? [],
      target: parsed.target,
      question: parsed.question,
      filters: parsed.filters ?? {},
      raw: json,
    };
    if (base.kind === 'invoke_skill') {
      return { ...base, skillName: parsed.skillName ?? '', args: parsed.args ?? '' } as ParsedIntent;
    }
    return base as ParsedIntent;
  } catch {
    return { kind: 'unknown', raw: json };
  }
}

// ── LLM-powered Agent Routing ──

export async function routeWithLLM(
  message: string,
  intent: ParsedIntent,
  gateway: LLMGateway,
  model: string,
  availableAgentsDesc: string,
  validAgentTypes: Set<string>,
  captainPrefsContext: string,
  conversationContext?: ConversationContext,
  embeddingMatch?: EmbeddingMatch | null,
  fallbackFn?: (intent: ParsedIntent, message?: string) => AgentRouteResult,
): Promise<AgentRouteResult> {
  const agentList =
    availableAgentsDesc ||
    [
      '- secretary: General conversation, decision analysis, and intent routing',
      '- secretary: General conversation, multi-agent coordination, decision analysis',
      '- organize: Workflow design, agent creation, system architecture',
      '- organize: Organization design — translates business goals into agent+workflow blueprints, and handles skill/MCP creation',
    ].join('\n');

  const prefsLine = captainPrefsContext
    ? `\nCaptain preferences (use to personalize routing):\n${captainPrefsContext}\n`
    : '';

  const historyLine = conversationContext?.lastRoute
    ? `\nRouting history: The previous turn was routed to "${conversationContext.lastRoute}". ` +
      `If the user message is a continuation of the same topic (involving the same entities, task, or files), ` +
      `please prefer the SAME targetAgent, unless the user explicitly asks to switch topics.`
    : '';

  const embeddingHint =
    embeddingMatch && embeddingMatch.confidence >= 0.50
      ? `\nEmbedding hint: The message is semantically similar to "${embeddingMatch.topExample}" (confidence ${(embeddingMatch.confidence * 100).toFixed(0)}%). Consider this when routing.`
      : '';

  const prompt = `You are a router in the Cabinet AI framework. Choose the best cabinet member to handle this request.

Available agents:
${agentList}
${prefsLine}
Routing guidelines:
- secretary: General questions, casual conversation, simple information retrieval, or decision analysis
- secretary: The topic needs general discussion, coordination, or multi-agent routing
- organize: The user wants to design workflows, create agents, or architect systems
- organize: The user wants to design/build/architect an organization, system, or capability
${historyLine}${embeddingHint}

Respond with ONLY a JSON object (no markdown, no backticks):
{
  "targetAgent": "one of the agent types above",
  "confidence": 0.0 to 1.0,
  "reasoning": "one sentence explaining why",
  "suggestion": "if confidence < 0.5, suggest what kind of specialist might help, otherwise null",
  "topicContinuity": true or false
}

Message: "${message}"`;

  try {
    const response = await gateway.generateText({
      model,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 300,
      temperature: 0.1,
    });

    return parseRouteResult(response.content, intent, validAgentTypes, fallbackFn);
  } catch {
    return fallbackFn ? fallbackFn(intent, message) : {
      targetAgent: 'secretary',
      confidence: 0.5,
      reasoning: 'LLM routing failed; defaulting to Secretary.',
      intent,
    };
  }
}

// ── Parse Route Result ──

export function parseRouteResult(
  json: string,
  intent: ParsedIntent,
  validAgentTypes: Set<string>,
  fallbackFn?: (intent: ParsedIntent, message?: string) => AgentRouteResult,
): AgentRouteResult {
  const fallback = fallbackFn
    ? fallbackFn(intent)
    : { targetAgent: 'secretary' as AgentRoleType, confidence: 0.5, reasoning: 'Default.', intent };

  try {
    const match = json.match(/\{[\s\S]*\}/);
    if (!match) return fallback;

    const parsed = JSON.parse(match[0]);
    return {
      targetAgent: validAgentTypes.has(parsed.targetAgent) ? parsed.targetAgent : 'secretary',
      confidence:
        typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.7,
      reasoning: parsed.reasoning ?? 'No reasoning provided.',
      suggestion: parsed.suggestion ?? undefined,
      intent,
      topicContinuity: !!parsed.topicContinuity,
    };
  } catch {
    return fallback;
  }
}
