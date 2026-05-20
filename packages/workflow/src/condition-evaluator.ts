/**
 * Condition expression evaluator for workflow condition nodes.
 *
 * Supports:
 *   Template references: {{steps.<nodeId>.output}} or {{steps.<nodeId>.output.path.to.field}}
 *   Comparisons: > < >= <= == != contains
 *   Logic: AND OR NOT
 *   Parentheses: ( ... )
 *
 * Example:
 *   {{steps.analyze.output.score}} > 0.7 AND {{steps.review.output.pass}} == true
 */

export interface ConditionContext {
  /** Resolve a dot-path reference like "steps.analyze.output.score" to a string value. */
  resolve: (path: string) => string;
}

// ── Public API ──

export function evaluateCondition(expr: string, context: ConditionContext): boolean {
  if (!expr || expr === 'true') return true;
  if (expr === 'false') return false;

  const resolved = resolveTemplates(expr, context);
  return evaluateExpression(resolved);
}

// ── Template resolution ──

function resolveTemplates(expr: string, context: ConditionContext): string {
  // Match {{...}} — the content inside can contain nested braces for JSON
  return expr.replace(/\{\{(.+?)\}\}/g, (_match, path: string) => {
    const trimmed = path.trim();
    try {
      const value = context.resolve(trimmed);
      // Quote strings so the expression evaluator can handle them
      if (isNumeric(value) || isBool(value)) return value;
      return JSON.stringify(value);
    } catch {
      return 'undefined';
    }
  });
}

// ── Expression evaluator (recursive descent) ──

interface Token {
  type: 'value' | 'op' | 'paren_open' | 'paren_close' | 'not';
  value: string;
}

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i]!;

    // Whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      i++;
      continue;
    }

    // Parentheses
    if (ch === '(') { tokens.push({ type: 'paren_open', value: '(' }); i++; continue; }
    if (ch === ')') { tokens.push({ type: 'paren_close', value: ')' }); i++; continue; }

    // Quoted string
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      while (j < expr.length && expr[j] !== quote) {
        if (expr[j] === '\\') j++;
        j++;
      }
      const str = expr.slice(i + 1, j);
      tokens.push({ type: 'value', value: str });
      i = j + 1;
      continue;
    }

    // Multi-char operators
    if (expr.slice(i, i + 8).toUpperCase() === 'CONTAINS') {
      tokens.push({ type: 'op', value: 'contains' }); i += 8; continue;
    }
    if (expr.slice(i, i + 2) === '>=') {
      tokens.push({ type: 'op', value: '>=' }); i += 2; continue;
    }
    if (expr.slice(i, i + 2) === '<=') {
      tokens.push({ type: 'op', value: '<=' }); i += 2; continue;
    }
    if (expr.slice(i, i + 2) === '==') {
      tokens.push({ type: 'op', value: '==' }); i += 2; continue;
    }
    if (expr.slice(i, i + 2) === '!=') {
      tokens.push({ type: 'op', value: '!=' }); i += 2; continue;
    }

    // Single-char operators
    if (ch === '>' || ch === '<') {
      tokens.push({ type: 'op', value: ch }); i++; continue;
    }

    // Words: AND, OR, NOT, true, false, undefined, numbers
    if (/[a-zA-Z0-9.\-]/.test(ch)) {
      let j = i;
      while (j < expr.length && /[a-zA-Z0-9.\-]/.test(expr[j]!)) j++;
      const word = expr.slice(i, j);
      const upper = word.toUpperCase();
      if (upper === 'AND' || upper === 'OR') {
        tokens.push({ type: 'op', value: upper });
      } else if (upper === 'NOT') {
        tokens.push({ type: 'not', value: 'NOT' });
      } else {
        tokens.push({ type: 'value', value: word });
      }
      i = j;
      continue;
    }

    throw new Error(`Unexpected character in condition expression: "${ch}" at position ${i}`);
  }

  return tokens;
}

function evaluateExpression(expr: string): boolean {
  const tokens = tokenize(expr.trim());
  if (tokens.length === 0) return true;

  let pos = 0;

  function peek(): Token | undefined { return tokens[pos]; }
  function consume(): Token { return tokens[pos++]!; }

  function parseOr(): boolean {
    let left = parseAnd();
    while (peek()?.value === 'OR') {
      consume(); // OR
      const right = parseAnd();
      left = left || right;
    }
    return left;
  }

  function parseAnd(): boolean {
    let left = parseNot();
    while (peek()?.value === 'AND') {
      consume(); // AND
      const right = parseNot();
      left = left && right;
    }
    return left;
  }

  function parseNot(): boolean {
    if (peek()?.type === 'not') {
      consume(); // NOT
      return !parsePrimary();
    }
    return parsePrimary();
  }

  function parsePrimary(): boolean {
    const token = peek();
    if (!token) throw new Error('Unexpected end of condition expression');

    // Parenthesized expression
    if (token.type === 'paren_open') {
      consume(); // (
      const result = parseOr();
      const close = peek();
      if (!close || close.type !== 'paren_close') {
        throw new Error('Missing closing parenthesis');
      }
      consume(); // )
      return result;
    }

    // Value
    const leftToken = consume();
    const leftVal = coerceValue(leftToken.value);

    // Check if there's a comparison operator next
    const opToken = peek();
    if (opToken?.type === 'op' && opToken.value !== 'AND' && opToken.value !== 'OR') {
      consume(); // operator
      const rightToken = consume();
      if (!rightToken) throw new Error(`Expected value after operator "${opToken.value}"`);
      const rightVal = coerceValue(rightToken.value);
      return compare(leftVal, rightVal, opToken.value);
    }

    // Standalone value — truthy check
    return isTruthy(leftVal);
  }

  const result = parseOr();
  if (pos < tokens.length) {
    const remaining = tokens.slice(pos).map((t) => t.value).join(' ');
    throw new Error(`Unexpected tokens after expression: "${remaining}"`);
  }
  return result;
}

// ── Value coercion ──

type EvalValue = string | number | boolean | null | undefined;

function isNumeric(s: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(s);
}

function isBool(s: string): boolean {
  const lower = s.toLowerCase();
  return lower === 'true' || lower === 'false';
}

function coerceValue(s: string): EvalValue {
  const lower = s.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  if (lower === 'null' || lower === 'undefined') return null;
  if (isNumeric(s)) return parseFloat(s);
  return s; // string
}

function isTruthy(v: EvalValue): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  return (v as string).length > 0; // non-empty string
}

function compare(left: EvalValue, right: EvalValue, op: string): boolean {
  if (op === 'contains') {
    const ls = String(left ?? '');
    const rs = String(right ?? '');
    return ls.includes(rs);
  }

  // Numeric comparison when both sides are numbers
  if (typeof left === 'number' && typeof right === 'number') {
    switch (op) {
      case '==': return left === right;
      case '!=': return left !== right;
      case '>': return left > right;
      case '<': return left < right;
      case '>=': return left >= right;
      case '<=': return left <= right;
      default: throw new Error(`Unknown operator: ${op}`);
    }
  }

  // Boolean comparison
  if (typeof left === 'boolean' && typeof right === 'boolean') {
    switch (op) {
      case '==': return left === right;
      case '!=': return left !== right;
      default: throw new Error(`Operator "${op}" not supported for boolean values`);
    }
  }

  // String comparison (fallback — coerce both to string)
  const ls = String(left ?? '');
  const rs = String(right ?? '');
  // Try numeric coercion for comparison ops
  const ln = Number(ls);
  const rn = Number(rs);
  if (!isNaN(ln) && !isNaN(rn) && op !== '==' && op !== '!=') {
    switch (op) {
      case '>': return ln > rn;
      case '<': return ln < rn;
      case '>=': return ln >= rn;
      case '<=': return ln <= rn;
    }
  }
  switch (op) {
    case '==': return ls === rs;
    case '!=': return ls !== rs;
    case '>': return ls > rs;
    case '<': return ls < rs;
    case '>=': return ls >= rs;
    case '<=': return ls <= rs;
    default: throw new Error(`Unknown operator: ${op}`);
  }
}
