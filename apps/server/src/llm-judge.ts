/**
 * LLM-powered contradiction judge.
 *
 * Uses a lightweight LLM (claude-haiku-4-5 by default) to determine whether
 * two memory statements contradict each other.
 */

import type { LLMGateway } from '@cabinet/gateway';
import type { LlmJudge, LlmJudgeResult } from '@cabinet/memory';

const SYSTEM_PROMPT = `You are a contradiction detection specialist.

Your task: determine whether Statement B contradicts Statement A.

Rules:
- "Contradiction" means the two statements cannot both be true at the same time.
- Minor differences in detail, additional information, or rephrasing do NOT count as contradiction.
- A contradiction requires direct logical opposition (e.g. "X is true" vs "X is false").
- If Statement B updates or supersedes Statement A (e.g. "deadline moved to X"), that is a contradiction.

Respond ONLY with a JSON object in this exact format:
{"isContradiction": true|false, "confidence": 0.0-1.0, "resolutionSuggestion": "brief explanation"}`;

export interface LlmJudgeOptions {
  gateway: LLMGateway;
  /** Model to use for contradiction detection. Default: claude-haiku-4-5 */
  model?: string;
  /** Max tokens for the judge response. Default: 200 */
  maxTokens?: number;
  /** Whether the judge is enabled. Default: true */
  enabled?: boolean;
}

/**
 * Create an LLM-based contradiction judge.
 *
 * The judge compares two statements and returns a structured verdict.
 * It is designed to be cheap (uses Haiku) and fast (simple few-shot prompt).
 */
export function createLlmJudge(options: LlmJudgeOptions): LlmJudge {
  const { gateway, model = 'claude-haiku-4-5', maxTokens = 200 } = options;

  return async (oldStatement: string, newStatement: string): Promise<LlmJudgeResult> => {
    const userPrompt = [
      `Statement A: ${oldStatement.slice(0, 800)}`,
      ``,
      `Statement B: ${newStatement.slice(0, 800)}`,
      ``,
      `Does Statement B contradict Statement A? Respond with JSON only.`,
    ].join('\n');

    const response = await gateway.generateText({
      model,
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens,
      temperature: 0.1,
    });

    return parseJudgeResponse(response.content);
  };
}

/**
 * Parse the LLM response into a structured LlmJudgeResult.
 *
 * Tolerates markdown fences, extra whitespace, and minor JSON deviations.
 */
function parseJudgeResponse(raw: string): LlmJudgeResult {
  const trimmed = raw.trim();

  // Try fenced JSON
  const fenceMatch = trimmed.match(/```json\s*([\s\S]*?)```/);
  const jsonText = fenceMatch ? fenceMatch[1]!.trim() : trimmed;

  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    return {
      isContradiction: Boolean(parsed.isContradiction),
      confidence: clampNumber(parsed.confidence, 0, 1),
      resolutionSuggestion: String(parsed.resolutionSuggestion ?? 'No suggestion provided.'),
    };
  } catch {
    // Fallback: heuristic parse from raw text
    const lower = trimmed.toLowerCase();
    const isContradiction = lower.includes('contradiction": true') || lower.includes('iscontradiction": true');
    const confidenceMatch = trimmed.match(/confidence["\s:]+([0-9.]+)/);
    const confidence = confidenceMatch ? clampNumber(Number(confidenceMatch[1]), 0, 1) : isContradiction ? 0.6 : 0.3;
    return {
      isContradiction,
      confidence,
      resolutionSuggestion: isContradiction
        ? 'Detected contradiction (parsed from non-JSON response).'
        : 'No contradiction detected (parsed from non-JSON response).',
    };
  }
}

function clampNumber(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}
