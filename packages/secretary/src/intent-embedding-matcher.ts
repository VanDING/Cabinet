/**
 * Embedding Matcher — semantic intent matching via embedding similarity.
 * Uses cosineSimilarity from @cabinet/types. Extracted from IntentParser class.
 */
import type { LLMGateway } from '@cabinet/gateway';
import { cosineSimilarity } from '@cabinet/types';
import { INTENT_EXAMPLES } from './intent-pattern-matcher.js';
import type { EmbeddingMatch } from './intent-pattern-matcher.js';
import type { ParsedIntent } from './intent-parser.js';

// ── Embedding Warmup ──

let exampleEmbeddingsWarmed = false;

/** Warm up example embeddings (call once at startup). Idempotent. */
export async function warmupEmbeddings(gateway?: LLMGateway): Promise<void> {
  if (!gateway || exampleEmbeddingsWarmed) return;
  try {
    const allExamples: string[] = [];
    for (const ie of INTENT_EXAMPLES) {
      allExamples.push(...ie.examples);
    }
    if (allExamples.length === 0) return;
    const result = await gateway.generateEmbeddings({ texts: allExamples });
    let idx = 0;
    for (const ie of INTENT_EXAMPLES) {
      ie.embeddings = result.embeddings.slice(idx, idx + ie.examples.length);
      idx += ie.examples.length;
    }
    exampleEmbeddingsWarmed = true;
  } catch {
    // Embedding warmup is best-effort; fall back to keyword routing
  }
}

/** Check if embeddings have been warmed up. */
export function isEmbeddingsWarmed(): boolean {
  return exampleEmbeddingsWarmed;
}

// ── Embedding Matching ──

/** Match user message to intent examples using embedding similarity. */
export async function matchIntentByEmbedding(
  message: string,
  gateway?: LLMGateway,
): Promise<EmbeddingMatch | null> {
  if (!gateway || !exampleEmbeddingsWarmed) return null;
  try {
    const userResult = await gateway.generateEmbeddings({ texts: [message] });
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

// ── Build Intent from Match ──

/** Build a ParsedIntent from an EmbeddingMatch. */
export function buildIntentFromMatch(match: EmbeddingMatch, message: string): ParsedIntent {
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
