import type { LLMGateway } from '@cabinet/gateway';
import type { AgentRoleType } from '@cabinet/agent';

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
  | { kind: 'mcp_request'; topic: string; context: string }
  | { kind: 'schedule_request'; topic: string; context: string }
  | { kind: 'follow_up'; previousKind: string; raw: string }
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
  /** Whether this message is a topic continuation from the previous turn. */
  topicContinuity?: boolean;
}

// ── Embedding-based Semantic Routing ──────────────────────────

interface IntentExample {
  intent: string;
  examples: string[];
  embeddings?: number[][];
  excludeWords?: string[];
}

const INTENT_EXAMPLES: IntentExample[] = [
  {
    intent: 'decision_request',
    examples: [
      '帮我决策',
      '该不该',
      'A和B哪个好',
      '怎么选择',
      '权衡利弊',
      '是否值得',
      '哪个方案更好',
      '给我建议',
      '优缺点对比',
      '风险评估',
    ],
    excludeWords: ['不要决策', '不用决策', '别决策', '不需要决策', '不用分析'],
  },
  {
    intent: 'meeting_request',
    examples: [
      '组织会议',
      '开会讨论',
      '召集顾问',
      '启动会议',
      '安排讨论',
      '需要多方意见',
      '开个会',
      '组织讨论',
    ],
    excludeWords: ['不要开会', '不用开会', '别组织会议', '不需要会议', '不用召集'],
  },
  {
    intent: 'status_query',
    examples: [
      '查询状态',
      '项目进度',
      '工作流状态',
      '任务执行情况',
      '现在怎么样了',
      '完成了吗',
      '进展如何',
      '到哪里了',
    ],
    excludeWords: ['不要查询'],
  },
  {
    intent: 'knowledge_query',
    examples: ['什么是', '如何', '怎么', '为什么', '解释一下', '告诉我关于', '什么是', '介绍一下'],
    excludeWords: [],
  },
  {
    intent: 'skill_request',
    examples: ['创建skill', '写skill', 'skill', 'SKILL.md', '优化skill', 'skill文件'],
    excludeWords: ['不要创建skill'],
  },
  {
    intent: 'mcp_request',
    examples: ['MCP', 'mcp server', 'model context protocol', '搭建mcp'],
    excludeWords: [],
  },
  {
    intent: 'review_request',
    examples: ['审查代码', '检查质量', 'review一下', '复核结果', '审核方案', '评估一下', '把关'],
    excludeWords: ['不要审查', '不用review', '别检查'],
  },
  {
    intent: 'schedule_request',
    examples: [
      '定时任务',
      '每天执行',
      '周期性运行',
      '定时触发',
      'cron',
      '每小时',
      '每周',
      '自动执行',
      'schedule',
      'reminder',
    ],
    excludeWords: ['不要定时', '不用定时', '别定时'],
  },
  {
    intent: 'organize_request',
    examples: [
      '组织架构',
      '系统设计',
      '搭建体系',
      '设计能力',
      '组织方案',
      '构建系统',
      '规划架构',
      '创建系统',
      '设计流程',
      '构建架构',
      '组织自动化',
    ],
    excludeWords: ['不要组织', '不用组织', '别搭建'],
  },
];

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

interface EmbeddingMatch {
  intent: string;
  confidence: number;
  topExample: string;
}

// ── Intent Parser ─────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class IntentParser {
  private availableAgentsDesc = '';
  private validAgentTypes: Set<string> = new Set([
    'secretary',
    'meeting_chair',
    'reviewer',
    'organize',
  ]);
  private customAgents: Map<string, { description: string; keywords?: string[]; aliases?: string[] }> =
    new Map();
  private exampleEmbeddingsWarmed = false;

  constructor(private readonly gateway?: LLMGateway) {}

  /** Set agent descriptions for routing (called by server layer). */
  setAgentDescriptions(desc: string): void {
    this.availableAgentsDesc = desc;
  }

  /** Update valid agent types from registry (includes custom agents). */
  setValidAgentTypes(types: Set<string>): void {
    this.validAgentTypes = types;
  }

  /** Register custom agent names and descriptions for fallback routing. */
  setCustomAgents(agents: Map<string, string | { description: string; keywords?: string[]; aliases?: string[] }>): void {
    const normalized = new Map<string, { description: string; keywords?: string[]; aliases?: string[] }>();
    for (const [name, info] of agents) {
      if (typeof info === 'string') {
        // Derive default keywords from the agent name (split on whitespace/hyphens/underscores)
        const defaultKeywords = name.toLowerCase().split(/[\s\-_]+/).filter((k) => k.length > 1);
        normalized.set(name, { description: info, keywords: defaultKeywords, aliases: [] });
      } else {
        normalized.set(name, info);
      }
    }
    this.customAgents = normalized;
  }

  /** Inject captain preferences for personalized routing. */
  setCaptainPreferences(prefsContext: string): void {
    this.captainPrefsContext = prefsContext;
  }

  private captainPrefsContext = '';

  // ── Keyword Parsing (fast path, no LLM) ───────────────────

  parse(message: string, conversationContext?: ConversationContext): ParsedIntent {
    const lower = message.toLowerCase();
    const trimmed = lower.trim();

    // Follow-up detection: only continuation/elaboration requests (not generic affirmations)
    const followUpPatterns = [
      '继续',
      '然后',
      '接下来',
      '接着',
      '下一步',
      'go on',
      'continue',
      'next',
      '详细',
      '具体',
      '展开',
      '多说',
      '仔细',
      'elaborate',
      'explain',
      'detail',
      // Common follow-up phrases
      '上面',
      '刚才',
      '之前',
      '那',
      '那么',
      '所以',
      '还有吗',
      '然后呢',
      'more',
      'and',
      'also',
    ];
    // startsWith gives stronger signal, even on longer messages
    const startsWithFollowUp = followUpPatterns.some((p) => trimmed.startsWith(p));
    const isFollowUp =
      startsWithFollowUp ||
      (trimmed.length < 40 && followUpPatterns.some((p) => lower.includes(p)));

    // Require both a follow-up pattern AND a known previous route to avoid false positives
    if (isFollowUp && conversationContext?.lastIntent && conversationContext?.lastRoute) {
      return {
        kind: 'follow_up',
        previousKind: conversationContext.lastIntent,
        raw: message,
      };
    }

    if (
      lower.includes('什么') ||
      lower.includes('如何') ||
      lower.includes('怎么') ||
      lower.includes('为什么')
    ) {
      return {
        kind: 'knowledge_query',
        question: message,
        scope: 'both',
      };
    }

    // Decision analysis: requires decision-oriented keywords.
    // "分析" alone is too broad (e.g. "分析代码") — require pairing with option/comparison words.
    const hasDecisionKeyword =
      lower.includes('是否') || lower.includes('该不该') || lower.includes('决策');
    const hasAnalyticalContext =
      lower.includes('分析') &&
      (lower.includes('选项') ||
        lower.includes('方案') ||
        lower.includes('选择') ||
        lower.includes('对比') ||
        lower.includes('比较') ||
        lower.includes('优劣') ||
        lower.includes('哪个') ||
        lower.includes('怎么选') ||
        lower.includes('权衡'));
    if (
      (hasDecisionKeyword || hasAnalyticalContext) &&
      !this.hasNegation(lower, 'decision_request')
    ) {
      return {
        kind: 'decision_request',
        topic: message.slice(0, 100),
        context: message,
        suggestedDimensions: ['成本', '风险', '时间', '收益'],
      };
    }

    // Meeting request: must explicitly ask to organize/schedule a meeting, not just mention one.
    const hasOrganizeMeeting =
      (lower.includes('组织') && lower.includes('讨论')) ||
      lower.includes('组织会议') ||
      lower.includes('组织个会') ||
      lower.includes('开会') ||
      lower.includes('开个会') ||
      lower.includes('召集') ||
      lower.includes('启动会议');
    const hasAdvisorIntent =
      lower.includes('顾问') &&
      (lower.includes('讨论') ||
        lower.includes('分析') ||
        lower.includes('会议') ||
        lower.includes('咨询'));
    if ((hasOrganizeMeeting || hasAdvisorIntent) && !this.hasNegation(lower, 'meeting_request')) {
      return {
        kind: 'meeting_request',
        topic: message,
        requiredPerspectives: ['general'],
      };
    }

    // Status query: "查询" alone is too broad. Require pairing with status/project/workflow context.
    const hasStatusKeyword = lower.includes('状态') || lower.includes('进度');
    const hasQueryWithContext =
      lower.includes('查询') &&
      (lower.includes('项目') ||
        lower.includes('工作流') ||
        lower.includes('workflow') ||
        lower.includes('决策') ||
        lower.includes('状态') ||
        lower.includes('进度') ||
        lower.includes('任务') ||
        lower.includes('执行'));
    if ((hasStatusKeyword || hasQueryWithContext) && !this.hasNegation(lower, 'status_query')) {
      return {
        kind: 'status_query',
        target: 'project',
        filters: { query: message },
      };
    }

    // Schedule request: before workflow_request to avoid being swallowed
    const hasScheduleKeyword =
      lower.includes('定时') ||
      lower.includes('周期') ||
      lower.includes('cron') ||
      lower.includes('schedule') ||
      lower.includes('reminder');
    const hasRecurringIntent =
      lower.includes('每天') ||
      lower.includes('每小时') ||
      lower.includes('每周') ||
      lower.includes('每月') ||
      lower.includes('自动');
    if (
      (hasScheduleKeyword || hasRecurringIntent) &&
      !this.hasNegation(lower, 'schedule_request')
    ) {
      return { kind: 'schedule_request', topic: message.slice(0, 100), context: message };
    }

    // Conflict resolution: "设计审查" pattern means review, not organize.
    // But "审查" must be the main ACTION, not a modifier.
    // "创建一个代码审查agent" = organizing, not reviewing; "审查这个设计" = reviewing.
    const hasReviewSignal =
      lower.includes('审查') || lower.includes('review') ||
      lower.includes('审核') || lower.includes('复核');
    const hasDesignOrCreateSignal =
      lower.includes('设计') || lower.includes('创建') || lower.includes('搭建');
    const hasSystemOrganizeSignal =
      lower.includes('agent') || lower.includes('系统') || lower.includes('流程') ||
      lower.includes('工作流') || lower.includes('自动化') || lower.includes('架构') ||
      lower.includes('方案');
    if (
      hasReviewSignal &&
      hasDesignOrCreateSignal &&
      !hasSystemOrganizeSignal &&
      !this.hasNegation(lower, 'review_request')
    ) {
      return { kind: 'review_request', target: message.slice(0, 100), context: message };
    }

    // Organize: higher-level design intent — must be checked before workflow_request
    const hasCreateOrDesign =
      lower.includes('创建') ||
      lower.includes('设计') ||
      lower.includes('搭建') ||
      lower.includes('组织') ||
      lower.includes('构建') ||
      lower.includes('规划');
    const hasSystemOrWorkflowOrAgent =
      lower.includes('系统') ||
      lower.includes('流程') ||
      lower.includes('agent') ||
      lower.includes('工作流') ||
      lower.includes('自动化') ||
      lower.includes('架构') ||
      lower.includes('方案');
    if (
      hasCreateOrDesign &&
      hasSystemOrWorkflowOrAgent &&
      !this.hasNegation(lower, 'organize_request')
    ) {
      return { kind: 'organize_request', topic: message.slice(0, 100), context: message };
    }

    // Skill request
    const hasSkillKeyword = lower.includes('skill') || lower.includes('skil');
    const hasCreateSkill = lower.includes('创建') && hasSkillKeyword;
    const hasWriteSkill = (lower.includes('写') || lower.includes('编写')) && hasSkillKeyword;
    const hasSkillMd = lower.includes('skill.md') || lower.includes('skil.md');
    if (
      (hasCreateSkill || hasWriteSkill || hasSkillMd) &&
      !this.hasNegation(lower, 'skill_request')
    ) {
      return { kind: 'skill_request', topic: message.slice(0, 100), context: message };
    }

    // MCP request
    const hasMcpKeyword = lower.includes('mcp') || lower.includes('model context protocol');
    const hasMcpServer = lower.includes('mcp server') || lower.includes('mcpserver');
    if ((hasMcpKeyword || hasMcpServer) && !this.hasNegation(lower, 'mcp_request')) {
      return { kind: 'mcp_request', topic: message.slice(0, 100), context: message };
    }

    if (
      (lower.includes('审查') ||
        lower.includes('检查') ||
        lower.includes('review') ||
        lower.includes('复核') ||
        lower.includes('审核')) &&
      !this.hasNegation(lower, 'review_request')
    ) {
      return {
        kind: 'review_request',
        target: message.slice(0, 100),
        context: message,
      };
    }

    return { kind: 'unknown', raw: message };
  }

  /** Check if the message contains negation patterns for a specific intent. */
  private hasNegation(lower: string, intent: string): boolean {
    const example = INTENT_EXAMPLES.find((e) => e.intent === intent);
    if (!example?.excludeWords) return false;
    return example.excludeWords.some((ew) => lower.includes(ew.toLowerCase()));
  }

  // ── Embedding-based Intent Matching ────────────────────────

  /** Warm up example embeddings (call once at startup). Idempotent. */
  async warmupEmbeddings(): Promise<void> {
    if (!this.gateway || this.exampleEmbeddingsWarmed) return;
    try {
      const allExamples: string[] = [];
      const offsets: number[] = [];
      for (const ie of INTENT_EXAMPLES) {
        offsets.push(allExamples.length);
        allExamples.push(...ie.examples);
      }
      if (allExamples.length === 0) return;
      const result = await this.gateway.generateEmbeddings({ texts: allExamples });
      let idx = 0;
      for (let i = 0; i < INTENT_EXAMPLES.length; i++) {
        const ie = INTENT_EXAMPLES[i]!;
        ie.embeddings = result.embeddings.slice(idx, idx + ie.examples.length);
        idx += ie.examples.length;
      }
      this.exampleEmbeddingsWarmed = true;
    } catch {
      // Embedding warmup is best-effort; fall back to keyword routing
    }
  }

  /** Match user message to intent examples using embedding similarity. */
  private async matchIntentByEmbedding(message: string): Promise<EmbeddingMatch | null> {
    if (!this.gateway || !this.exampleEmbeddingsWarmed) return null;
    try {
      const userResult = await this.gateway.generateEmbeddings({ texts: [message] });
      const userEmbedding = userResult.embeddings[0];
      if (!userEmbedding) return null;

      let bestIntent = '';
      let bestScore = -1;
      let bestExample = '';

      for (const ie of INTENT_EXAMPLES) {
        if (!ie.embeddings || ie.embeddings.length === 0) continue;
        for (let i = 0; i < ie.embeddings.length; i++) {
          const score = cosineSimilarity(userEmbedding, ie.embeddings[i]!);
          if (score > bestScore) {
            bestScore = score;
            bestIntent = ie.intent;
            bestExample = ie.examples[i]!;
          }
        }
      }

      if (bestScore < 0) return null;
      return { intent: bestIntent, confidence: bestScore, topExample: bestExample };
    } catch {
      return null;
    }
  }

  // ── LLM-powered Intent Classification ─────────────────────

  async parseWithLLM(
    message: string,
    conversationContext?: ConversationContext,
  ): Promise<ParsedIntent> {
    if (!this.gateway) return this.parse(message, conversationContext);

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
11. Message: "继续"
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

      const response = await this.gateway.generateText({
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 400,
        temperature: 0.1,
      });

      return this.parseJSONIntent(response.content);
    } catch {
      return this.parse(message, conversationContext);
    }
  }

  // ── LLM-powered Agent Routing ─────────────────────────────

  async routeToAgent(
    message: string,
    conversationContext?: ConversationContext,
  ): Promise<AgentRouteResult> {
    // Ensure embeddings are warmed up
    await this.warmupEmbeddings();

    // Fast path: keyword-based parsing (no LLM call)
    const fastIntent = this.parse(message, conversationContext);

    if (!this.gateway) {
      return this.fallbackRoute(fastIntent, message);
    }

    // Topic continuity check: if semantic similarity to previous topic > 0.7, force follow-up
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

    // Fast path: high-confidence explicit action intents from keyword parsing
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
    const embeddingMatch = await this.matchIntentByEmbedding(message);
    if (embeddingMatch) {
      const embIntent = this.buildIntentFromMatch(embeddingMatch, message);
      const embRoute = this.fallbackRoute(embIntent, message);
      candidates.push({
        agent: embRoute.targetAgent,
        score: embeddingMatch.confidence,
        sources: { embedding: embeddingMatch.confidence },
        reasoning: `Embedding semantic match: "${embeddingMatch.topExample}" (confidence: ${(embeddingMatch.confidence * 100).toFixed(0)}%)`,
        intent: embIntent,
      });
      // High-confidence embedding match can short-circuit
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
      const llmIntent = await this.parseWithLLM(message, conversationContext);
      const llmRoute = await this.routeWithLLM(
        message,
        llmIntent,
        conversationContext,
        embeddingMatch,
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
      // LLM failure is non-fatal — fall through to best available candidate
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

    return result;
  }

  /** LLM-powered agent routing (separated from routeToAgent for clarity). */
  private async routeWithLLM(
    message: string,
    intent: ParsedIntent,
    conversationContext?: ConversationContext,
    embeddingMatch?: EmbeddingMatch | null,
  ): Promise<AgentRouteResult> {
    const agentList =
      this.availableAgentsDesc ||
      [
        '- secretary: General conversation, decision analysis, and intent routing',
        '- meeting_chair: Multi-perspective deliberation and consensus synthesis',
        '- reviewer: Quality review — checks outputs for logic, evidence, and completeness',
        '- organize: Organization design — translates business goals into agent+workflow blueprints, and handles skill/MCP creation',
      ].join('\n');

    const prefsLine = this.captainPrefsContext
      ? `\nCaptain preferences (use to personalize routing):\n${this.captainPrefsContext}\n`
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
- meeting_chair: The topic needs multiple perspectives, expert opinions, or debate
- reviewer: The user wants to review/audit/check the quality or correctness of something
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
      const response = await this.gateway!.generateText({
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 300,
        temperature: 0.1,
      });

      return this.parseRouteResult(response.content, intent);
    } catch {
      return this.fallbackRoute(intent, message);
    }
  }

  // ── Private ───────────────────────────────────────────────

  private buildIntentFromMatch(match: EmbeddingMatch, message: string): ParsedIntent {
    const base = { topic: message.slice(0, 100), context: message };
    switch (match.intent) {
      case 'decision_request':
        return {
          kind: 'decision_request',
          ...base,
          suggestedDimensions: ['成本', '风险', '时间', '收益'],
        };
      case 'meeting_request':
        return { kind: 'meeting_request', topic: message, requiredPerspectives: ['general'] };
      case 'status_query':
        return { kind: 'status_query', target: 'project', filters: { query: message } };
      case 'knowledge_query':
        return { kind: 'knowledge_query', question: message, scope: 'both' };
      case 'skill_request':
        return { kind: 'skill_request', ...base };
      case 'mcp_request':
        return { kind: 'mcp_request', ...base };
      case 'review_request':
        return { kind: 'review_request', target: message.slice(0, 100), context: message };
      case 'organize_request':
        return { kind: 'organize_request', ...base };
      case 'schedule_request':
        return { kind: 'schedule_request', ...base };
      default:
        return { kind: 'unknown', raw: message };
    }
  }

  private parseRouteResult(json: string, intent: ParsedIntent): AgentRouteResult {
    try {
      const match = json.match(/\{[\s\S]*\}/);
      if (!match) return this.fallbackRoute(intent);

      const parsed = JSON.parse(match[0]);
      return {
        targetAgent: this.validAgentTypes.has(parsed.targetAgent)
          ? parsed.targetAgent
          : 'secretary',
        confidence:
          typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.7,
        reasoning: parsed.reasoning ?? 'No reasoning provided.',
        suggestion: parsed.suggestion ?? undefined,
        intent,
        topicContinuity: !!parsed.topicContinuity,
      };
    } catch {
      return this.fallbackRoute(intent);
    }
  }

  private fallbackRoute(intent: ParsedIntent, message?: string): AgentRouteResult {
    let targetAgent: AgentRoleType = 'secretary';
    let reasoning = 'Default routing (no LLM available).';

    // Custom agent detection: word-boundary match on name/aliases, word-level match on keywords
    if (message) {
      const lowerMsg = message.toLowerCase();
      const words = lowerMsg.split(/[\s,，。！？、；：""''（）\(\)\[\]\{\}]+/).filter(Boolean);

      for (const [name, info] of this.customAgents) {
        const lowerName = name.toLowerCase();
        // Word-boundary match on agent name: "Code" shouldn't match "decode"
        const nameRegex = new RegExp(`\\b${escapeRegex(lowerName)}\\b`, 'i');
        if (nameRegex.test(lowerMsg)) {
          return {
            targetAgent: name as AgentRoleType,
            confidence: 0.8,
            reasoning: `Custom agent "${name}" matched in user message.`,
            intent,
          };
        }

        // Match against aliases with word boundary
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

        // Match against keywords (word-level, not substring)
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
        targetAgent = 'secretary';
        reasoning = 'Decision-related request handled by Secretary.';
        break;
      case 'meeting_request':
        targetAgent = 'meeting_chair';
        reasoning = 'Meeting/discussion request routed to Meeting Chair.';
        break;
      case 'status_query':
        targetAgent = 'secretary';
        reasoning = 'Status query handled by Secretary.';
        break;
      case 'knowledge_query':
        targetAgent = 'secretary';
        reasoning = 'Knowledge query handled by Secretary.';
        break;
      case 'organize_request':
      case 'skill_request':
      case 'mcp_request':
        targetAgent = 'organize';
        reasoning = 'Creation/design request routed to Organize Agent.';
        break;
      case 'schedule_request':
        targetAgent = 'secretary';
        reasoning = 'Scheduling request — Secretary has schedule_task tools.';
        break;
      case 'review_request':
        targetAgent = 'reviewer';
        reasoning = 'Review/audit request routed to Reviewer.';
        break;
      case 'follow_up':
        targetAgent = 'secretary';
        reasoning = 'Follow-up message — continuing with Secretary.';
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
