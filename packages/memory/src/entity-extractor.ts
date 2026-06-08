/**
 * Entity Extractor — hybrid heuristic + lightweight NER.
 *
 * Strategy:
 * 1. Regex fast-path for English capitalized phrases, CJK words, and quoted terms.
 * 2. Compromise.js enrichment for people, places, and organizations
 *    (regex misses these when they are not capitalized consistently).
 * 3. Stop-word filtering to reduce noise.
 *
 * Why not pure compromise.js? It fails on technical terms (React, TypeScript,
 * LangGraph) and product names — exactly the entities most common in
 * software-engineering memory content.
 */

import nlp from 'compromise';

/** Common English stop-words that produce false positives in all-caps regex. */
const STOP_WORDS = new Set([
  // Articles & determiners
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'my', 'your', 'his', 'her',
  'its', 'our', 'their', 'some', 'any', 'every', 'each', 'all', 'both', 'either',
  // Be verbs & auxiliaries
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'shall', 'should', 'can', 'could', 'may',
  'might', 'must', 'ought',
  // Prepositions
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under',
  // Conjunctions
  'and', 'or', 'but', 'so', 'yet', 'nor', 'because', 'since', 'although',
  // Pronouns
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
  'what', 'which', 'who', 'whom', 'whose', 'whatever', 'whoever', 'whomever',
  // Common noise in technical text
  'error', 'errors', 'warning', 'warnings', 'info', 'debug', 'fatal',
  'code', 'data', 'value', 'values', 'key', 'keys', 'id', 'ids', 'type', 'types',
  'name', 'names', 'text', 'number', 'numbers', 'string', 'strings', 'object',
  'objects', 'array', 'arrays', 'function', 'functions', 'class', 'classes',
  'method', 'methods', 'property', 'properties', 'field', 'fields', 'variable',
  'variables', 'parameter', 'parameters', 'argument', 'arguments', 'return',
  'returns', 'get', 'set', 'post', 'put', 'delete', 'create', 'update', 'remove',
  'add', 'new', 'old', 'first', 'second', 'third', 'last', 'next', 'previous',
  'current', 'default', 'null', 'undefined', 'true', 'false', 'yes', 'no',
  'ok',
]);

/**
 * Extract candidate entity names from text.
 *
 * Returns a deduplicated list of strings. Each string is a potential entity
 * that the KnowledgeGraph or LongTermMemory may want to track.
 */
export function extractCandidateEntities(text: string): string[] {
  const seen = new Set<string>();
  const results: string[] = [];

  // ── 1. Regex fast-path ──
  // English capitalized phrases (e.g. "LangGraph", "React Component")
  const capitalized = text.match(/\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*\b/g) ?? [];
  // CJK words (2+ characters)
  const cjk = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{2,}/gu) ?? [];
  // Quoted terms
  const quoted = text.match(/"([^"]{2,50})"/g) ?? [];

  for (const raw of [...capitalized, ...cjk, ...quoted]) {
    const name = raw.replace(/^"|"$/g, '').trim();
    const cleaned = isValidEntity(name);
    if (cleaned && !seen.has(cleaned.toLowerCase())) {
      seen.add(cleaned.toLowerCase());
      results.push(cleaned);
    }
  }

  // ── 2. Compromise.js enrichment ──
  // Compromise is good at people, places, and organizations that the regex
  // might miss (e.g. lowercase names in mid-sentence, multi-word orgs).
  try {
    const doc = nlp(text);
    const enrich = (
      list: Array<{ text: string }>,
    ) => {
      for (const item of list) {
        const name = item.text.replace(/[.,;:!?]$/, '').trim();
        const cleaned = isValidEntity(name);
        if (cleaned && !seen.has(cleaned.toLowerCase())) {
          seen.add(cleaned.toLowerCase());
          results.push(cleaned);
        }
      }
    };

    enrich(doc.topics().json());
    enrich(doc.people().json());
    enrich(doc.places().json());
    enrich(doc.organizations().json());
  } catch {
    // Compromise is optional enrichment — ignore failures
  }

  return results;
}

/**
 * Validate a candidate entity string.
 *
 * Rules:
 * - Minimum length 3 (filters "Is", "The", "A", "OK")
 * - Not a pure number
 * - Not entirely in the stop-word list
 * - At least one alphabetic character
 * - Strip leading/trailing stop words (e.g. "The System" → "System")
 * - Reject phrases where *every* word is a stop word (e.g. "The And Is")
 */
function isValidEntity(name: string): string | false {
  if (name.length < 3) return false;
  if (/^\d+$/.test(name)) return false;
  if (!/[a-zA-Z\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(name)) {
    return false;
  }

  // Heuristic: reject all-uppercase 2-3 letter words (likely acronyms that
  // are too generic — e.g. "GET", "PUT", "API" is borderline but we keep it
  // because it appears in meaningful entity contexts).
  if (/^[A-Z]{2,3}$/.test(name) && !['API', 'SDK', 'UI', 'UX', 'DB', 'SQL', 'AI', 'LLM', 'ID'].includes(name)) {
    return false;
  }

  // Strip leading stop words
  let cleaned = name;
  const words = cleaned.split(/\s+/);

  // If every word is a stop word, reject the entire phrase
  const allStopWords = words.every((w) => STOP_WORDS.has(w.toLowerCase()));
  if (allStopWords) return false;

  // Trim leading/trailing stop words
  while (words.length > 0 && STOP_WORDS.has(words[0].toLowerCase())) {
    words.shift();
  }
  while (words.length > 0 && STOP_WORDS.has(words[words.length - 1].toLowerCase())) {
    words.pop();
  }

  cleaned = words.join(' ');
  if (cleaned.length < 2) return false;

  return cleaned;
}
