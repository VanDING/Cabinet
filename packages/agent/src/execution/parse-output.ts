import type { AgentOutput } from '@cabinet/types';

/** Try to extract a structured AgentOutput from LLM text. Multi-level fallback:
 *  1. ```json fence block
 *  2. Bare JSON (balanced bracket extraction)
 *  3. Any code fence block (``` without json tag)
 */
export function parseStructuredOutput(content: string): AgentOutput | undefined {
  // Level 1: Try ```json fence (most reliable)
  const fenceMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    const result = tryParseAgentOutput(fenceMatch[1]!);
    if (result) return result;
  }

  // Level 2: Try bare JSON — extract first balanced { or [ block
  const bracketMatch = extractBalancedJSON(content);
  if (bracketMatch) {
    const result = tryParseAgentOutput(bracketMatch);
    if (result) return result;
  }

  // Level 3: Try any code fence (``` without json tag, ```javascript, etc.)
  const anyFenceMatch = content.match(/```\w*\s*([\s\S]*?)\s*```/);
  if (anyFenceMatch) {
    const result = tryParseAgentOutput(anyFenceMatch[1]!);
    if (result) return result;
  }

  return undefined;
}

/** Parse a JSON string into AgentOutput with relaxed shape validation. */
export function tryParseAgentOutput(json: string): AgentOutput | undefined {
  try {
    const parsed = JSON.parse(json.trim());
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const hasKnownField = !!(
      parsed.summary ||
      parsed.findings ||
      parsed.decisions ||
      parsed.openQuestions ||
      parsed.confidence !== undefined
    );
    const hasMultipleFields = Object.keys(parsed).length >= 2;
    if (hasKnownField || hasMultipleFields) {
      return {
        summary: String(parsed.summary ?? ''),
        findings: Array.isArray(parsed.findings) ? parsed.findings : [],
        decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
        openQuestions: Array.isArray(parsed.openQuestions) ? parsed.openQuestions : [],
        confidence:
          typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
        suggestedNextSteps: Array.isArray(parsed.suggestedNextSteps)
          ? parsed.suggestedNextSteps
          : [],
      };
    }
  } catch {
    /* not valid JSON */
  }
  return undefined;
}

/** Extract the first balanced JSON object or array from text using bracket matching. */
export function extractBalancedJSON(text: string): string | null {
  const startBrace = text.indexOf('{');
  const startBracket = text.indexOf('[');
  let start = -1;
  let openChar = '';
  let closeChar = '';
  if (startBrace !== -1 && (startBracket === -1 || startBrace < startBracket)) {
    start = startBrace;
    openChar = '{';
    closeChar = '}';
  } else if (startBracket !== -1) {
    start = startBracket;
    openChar = '[';
    closeChar = ']';
  }
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
