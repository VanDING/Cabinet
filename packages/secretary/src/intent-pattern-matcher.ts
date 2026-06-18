/**
 * Pattern Matcher — keyword/regex-based intent matching.
 * Fast path: no LLM or embedding calls.
 * Extracted from intent-parser.ts IntentParser.parse() method.
 */
import type { ParsedIntent, ConversationContext } from './intent-parser.js';

// ── Types ──

export interface EmbeddingMatch {
  intent: string;
  confidence: number;
  topExample: string;
}

export interface IntentExample {
  intent: string;
  examples: string[];
  embeddings?: number[][];
  excludeWords?: string[];
}

// ── Intent Example Data ──

export const INTENT_EXAMPLES: IntentExample[] = [
  {
    intent: 'decision_request',
    examples: [
      '帮我决策',
      '该不该',
      'A和B哪个好',
      '是否应该',
      '权衡利弊',
      '选择哪个方案',
      '分析选项',
      '做决定',
      '对比分析',
      '要不要',
      '值得吗',
      '优缺点',
    ],
    excludeWords: ['不用决策', '不需要分析', '别分析了'],
  },
  {
    intent: 'meeting_request',
    examples: [
      '组织会议讨论',
      '召集顾问',
      '开会',
      '组织个会',
      '开个会',
      '启动会议',
      '讨论一下',
      '组织讨论',
      '一起讨论',
      '召集大家',
    ],
    excludeWords: ['不要开会', '别组织会议', '不用讨论'],
  },
  {
    intent: 'status_query',
    examples: [
      '查询状态',
      '进度如何',
      '项目状态',
      '工作流执行情况',
      '任务进度',
      '进行得怎样',
      '进度汇报',
      '当前状态',
    ],
    excludeWords: ['不用查', '不需要状态'],
  },
  {
    intent: 'knowledge_query',
    examples: ['什么是', '如何', '怎么', '为什么', '解释一下', '介绍一下', '说明一下', '是什么'],
  },
  {
    intent: 'review_request',
    examples: ['审查一下', '审核这个', 'review一下', '检查质量', '评估一下', '审计', '核查'],
    excludeWords: ['不用审查', '别审核'],
  },
  {
    intent: 'organize_request',
    examples: [
      '设计工作流',
      '创建agent',
      '搭建系统',
      '组织架构',
      '构建自动化',
      '架构设计',
      '系统设计',
      '设计流程',
      '规划架构',
      '创建流程',
      '组织自动化',
    ],
    excludeWords: ['不要组织', '不用组织', '别搭建'],
  },
  {
    intent: 'skill_request',
    examples: ['创建skill', '写一个skill', '编写SKILL.md', '创建技能', '编写技能'],
  },
  {
    intent: 'mcp_request',
    examples: ['搭建MCP', '创建MCP server', '写个mcp', '构建mcp服务', 'MCP服务器'],
  },
  {
    intent: 'schedule_request',
    examples: ['定时执行', '周期性任务', '设置定时', '每天自动', '定时任务', 'cron任务'],
    excludeWords: ['不要定时', '不需要定时'],
  },
  {
    intent: 'invoke_skill',
    examples: ['/workflow', '/review', '/organize', '/skill-name'],
  },
  {
    intent: 'follow_up',
    examples: ['继续', '然后呢', '接下来', '还有吗'],
  },
];

// ── Utilities ──

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function computeTopicHash(message: string): string {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
  }
  return String(hash);
}

// ── Negation Detection ──

export function hasNegation(lower: string, intent: string): boolean {
  const example = INTENT_EXAMPLES.find((e) => e.intent === intent);
  if (!example?.excludeWords) return false;
  return example.excludeWords.some((ew) => lower.includes(ew.toLowerCase()));
}

// ── Keyword-based Intent Matching ──

export function matchIntentByPattern(
  message: string,
  conversationContext?: ConversationContext,
): ParsedIntent {
  const lower = message.toLowerCase();
  const trimmed = lower.trim();

  // Follow-up detection
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
    '上面',
    '刚才',
    '之前',
    '那',
    '那么',
    '所以',
    '还有吗',
    '然后呢',
  ];
  const startsWithFollowUp = followUpPatterns.some((p) => trimmed.startsWith(p));
  const isFollowUp =
    startsWithFollowUp || (trimmed.length < 40 && followUpPatterns.some((p) => lower.includes(p)));

  if (isFollowUp && conversationContext?.lastIntent && conversationContext?.lastRoute) {
    return {
      kind: 'follow_up',
      previousKind: conversationContext.lastIntent,
      raw: message,
    };
  }

  // Direct skill invocation via /skillName prefix
  const skillInvokeMatch = message.trim().match(/^\/(\S+)/);
  if (skillInvokeMatch) {
    return {
      kind: 'invoke_skill',
      skillName: skillInvokeMatch[1]!,
      args: message.trim().slice(skillInvokeMatch[0].length).trim(),
      raw: message,
    };
  }

  // Knowledge query
  if (
    lower.includes('什么') ||
    lower.includes('如何') ||
    lower.includes('怎么') ||
    lower.includes('为什么')
  ) {
    return { kind: 'knowledge_query', question: message, scope: 'both' };
  }

  // Decision request
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
  if ((hasDecisionKeyword || hasAnalyticalContext) && !hasNegation(lower, 'decision_request')) {
    return {
      kind: 'decision_request',
      topic: message.slice(0, 100),
      context: message,
      suggestedDimensions: ['成本', '风险', '时间', '收益'],
    };
  }

  // Meeting request
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
  const hasDesignContext =
    lower.includes('系统') ||
    lower.includes('流程') ||
    lower.includes('agent') ||
    lower.includes('工作流') ||
    lower.includes('自动化') ||
    lower.includes('架构') ||
    lower.includes('方案');
  if (
    (hasOrganizeMeeting || hasAdvisorIntent) &&
    !hasDesignContext &&
    !hasNegation(lower, 'meeting_request')
  ) {
    return {
      kind: 'meeting_request',
      topic: message,
      requiredPerspectives: ['general'],
    };
  }

  // Status query
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
  if ((hasStatusKeyword || hasQueryWithContext) && !hasNegation(lower, 'status_query')) {
    return { kind: 'status_query', target: 'project', filters: { query: message } };
  }

  // Schedule request
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
  if ((hasScheduleKeyword || hasRecurringIntent) && !hasNegation(lower, 'schedule_request')) {
    return { kind: 'schedule_request', topic: message.slice(0, 100), context: message };
  }

  // Organize request
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
  if (hasCreateOrDesign && hasSystemOrWorkflowOrAgent && !hasNegation(lower, 'organize_request')) {
    return { kind: 'organize_request', topic: message.slice(0, 100), context: message };
  }

  // Skill request
  const hasSkillKeyword = lower.includes('skill') || lower.includes('skil');
  const hasCreateSkill = lower.includes('创建') && hasSkillKeyword;
  const hasWriteSkill = (lower.includes('写') || lower.includes('编写')) && hasSkillKeyword;
  const hasSkillMd = lower.includes('skill.md') || lower.includes('skil.md');
  if ((hasCreateSkill || hasWriteSkill || hasSkillMd) && !hasNegation(lower, 'skill_request')) {
    return { kind: 'skill_request', topic: message.slice(0, 100), context: message };
  }

  // MCP request
  const hasMcpKeyword = lower.includes('mcp') || lower.includes('model context protocol');
  const hasMcpServer = lower.includes('mcp server') || lower.includes('mcpserver');
  if ((hasMcpKeyword || hasMcpServer) && !hasNegation(lower, 'mcp_request')) {
    return { kind: 'mcp_request', topic: message.slice(0, 100), context: message };
  }

  return { kind: 'unknown', raw: message };
}
