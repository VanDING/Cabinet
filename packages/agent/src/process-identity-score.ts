import type { AgentExecutionContext } from './observer-pipeline.js';

export interface PISFactor {
  name: string;
  weight: number;
  score: number; // 0–1
}

export interface ProcessIdentityScore {
  total: number; // weighted total
  factors: PISFactor[];
  trend: 'improving' | 'stable' | 'drifting' | 'lost';
  recommendedAction: 'continue' | 'compact' | 'handoff' | 'abort';
}

// ── Intent Alignment (Phase 1: Keyword Jaccard) ──

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'to',
  'of',
  'in',
  'and',
  'for',
  'is',
  'it',
  'this',
  'that',
  'on',
  'at',
  'by',
  'with',
  'from',
  'as',
  'or',
  'be',
  'are',
  'was',
  'were',
]);

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function frequencyMap(words: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const w of words) {
    map.set(w, (map.get(w) ?? 0) + 1);
  }
  return map;
}

function calculateDeviationPenalty(taskWords: string[], toolWords: string[]): number {
  const toolFreq = frequencyMap(toolWords);
  let penalty = 0;
  for (const [word, freq] of toolFreq) {
    if (!taskWords.includes(word) && freq >= 2) {
      penalty += 0.05;
    }
  }
  return Math.min(penalty, 0.5);
}

import { EmbeddingService } from './embedding-service.js';

async function calculateIntentAlignment(
  originalTask: string,
  recentToolCalls: { name: string; args: Record<string, unknown>; result: unknown }[],
  embeddingService?: EmbeddingService,
): Promise<number> {
  // Phase 2: embedding cosine (if available)
  if (embeddingService) {
    const toolText = recentToolCalls.map((tc) => tc.name + ' ' + JSON.stringify(tc.args)).join(' ');
    if (!toolText) return 0.5;
    return embeddingService.cosineSimilarity(originalTask, toolText);
  }

  // Phase 1 fallback: keyword Jaccard
  const taskWords = extractKeywords(originalTask);
  if (taskWords.length === 0) return 0.5;

  const toolWords = recentToolCalls.flatMap((tc) =>
    extractKeywords(tc.name + ' ' + JSON.stringify(tc.args)),
  );
  if (toolWords.length === 0) return 0.5;

  const intersection = new Set(taskWords.filter((w) => toolWords.includes(w)));
  const union = new Set([...taskWords, ...toolWords]);
  const jaccard = intersection.size / Math.max(union.size, 1);
  const deviationPenalty = calculateDeviationPenalty(taskWords, toolWords);

  return Math.max(0, Math.min(1, jaccard * (1 - deviationPenalty)));
}

// ── Tool Coherence ──

function calculateToolCoherence(
  toolCalls: { name: string; args: Record<string, unknown>; result: unknown }[],
): number {
  if (toolCalls.length === 0) return 1;
  const uniqueTools = new Set(toolCalls.map((tc) => tc.name)).size;
  const total = toolCalls.length;
  return Math.max(0, 1 - uniqueTools / Math.max(total, 1));
}

// ── Goal Progress ──

/**
 * Scans tool results for milestone-completion markers.
 *
 * NOTE: If tool outputs do not contain markers like "milestone_complete",
 * "subtask_done", or "goal_achieved", this factor will always return 0.5
 * (neutral) and PIS degrades to a three-factor model. Update tool
 * descriptions / system prompts to encourage LLMs to emit these markers
 * when completing sub-tasks.
 */
function calculateGoalProgress(ctx: AgentExecutionContext): number {
  const completedMilestones = ctx.toolCallHistory.filter((tc) => {
    const resultStr = typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result);
    return /\b(milestone_complete|subtask_done|goal_achieved)\b/i.test(resultStr);
  }).length;

  // No markers found → neutral (0.5) to avoid degrading PIS to a 3-factor model
  if (completedMilestones === 0) return 0.5;

  const estimatedTotalGoals = Math.max(1, Math.floor(ctx.systemPrompt.split(/[.!?]/).length / 3));

  return Math.min(1, completedMilestones / estimatedTotalGoals);
}

// ── Context Stability ──

function calculateContextStability(ctx: AgentExecutionContext): number {
  if (ctx.stepCount === 0) return 1;
  const crossings = ((ctx as any).zoneCrossings?.length ?? 0) as number;
  return Math.max(0, 1 - crossings / ctx.stepCount);
}

// ── Trend Classification ──

function classifyTrend(
  pisHistory: { step: number; score: number }[],
): ProcessIdentityScore['trend'] {
  if (pisHistory.length < 4) return 'stable';
  const recent = pisHistory.slice(-4);
  const first = recent[0]!.score;
  const last = recent[recent.length - 1]!.score;
  const delta = last - first;

  if (delta > 0.15) return 'improving';
  if (delta < -0.25) return 'lost';
  if (delta < -0.1) return 'drifting';
  return 'stable';
}

// ── Recommendation ──

function recommendAction(
  score: number,
  stepCount: number,
): ProcessIdentityScore['recommendedAction'] {
  if (stepCount < 5) return 'continue';
  if (score > 0.7) return 'continue';
  if (score > 0.5) return 'compact';
  if (score > 0.3) return 'handoff';
  return 'abort';
}

// ── Main Entry ──

export async function calculatePIS(
  ctx: AgentExecutionContext,
  originalTask: string,
  embeddingService?: EmbeddingService,
): Promise<ProcessIdentityScore> {
  const factors: PISFactor[] = [
    {
      name: 'intentAlignment',
      weight: 0.35,
      score: await calculateIntentAlignment(
        originalTask,
        ctx.toolCallHistory.slice(-3),
        embeddingService,
      ),
    },
    {
      name: 'toolCoherence',
      weight: 0.25,
      score: calculateToolCoherence(ctx.toolCallHistory.slice(-10)),
    },
    {
      name: 'goalProgress',
      weight: 0.25,
      score: calculateGoalProgress(ctx),
    },
    {
      name: 'contextStability',
      weight: 0.15,
      score: calculateContextStability(ctx),
    },
  ];

  const total = factors.reduce((sum, f) => sum + f.score * f.weight, 0);
  const pisHistory = (ctx as any).pisHistory as { step: number; score: number }[] | undefined;

  return {
    total: Math.round(total * 1000) / 1000,
    factors,
    trend: classifyTrend(pisHistory ?? []),
    recommendedAction: recommendAction(total, ctx.stepCount),
  };
}
