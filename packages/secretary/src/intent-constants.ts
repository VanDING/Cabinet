// Magic number constants extracted from intent-parser.ts (Phase 1.3b).

// ── Similarity thresholds ──
export const TOPIC_CONTINUITY_THRESHOLD = 0.7;
export const EMBEDDING_SHORT_CIRCUIT_THRESHOLD = 0.65;
export const NON_LLM_FALLBACK_THRESHOLD = 0.6;
export const MIN_ROUTE_SCORE_THRESHOLD = 0.5;

// ── Confidence values ──
export const CONFIDENCE_CACHE_HIT = 0.95;
export const CONFIDENCE_TOPIC_CONTINUITY = 0.85;
export const CONFIDENCE_AGENT_NAME_MATCH = 0.8;
export const CONFIDENCE_AGENT_ALIAS_MATCH = 0.75;
export const CONFIDENCE_KEYWORD_MATCH = 0.7;
export const CONFIDENCE_FALLBACK = 0.6;
export const CONFIDENCE_UNCERTAIN = 0.5;

// ── LLM parameters ──
export const LLM_TEMPERATURE = 0.1;
export const LLM_CLASSIFY_MAX_TOKENS = 400;
export const LLM_ROUTE_MAX_TOKENS = 300;

// ── Topic / context limits ──
export const TOPIC_HASH_MAX_LENGTH = 80;
export const TOPIC_EXCERPT_MAX_LENGTH = 100;
export const FOLLOW_UP_SHORT_MSG_THRESHOLD = 40;

// ── Caching ──
export const ROUTE_CACHE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// ── Defaults ──
export const DEFAULT_MODEL_NAME = 'claude-sonnet-4-6';
export const DEFAULT_SUGGESTED_DIMENSIONS = ['成本', '风险', '时间', '收益'] as const;
