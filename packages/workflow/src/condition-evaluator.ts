export interface ConditionContext {
  resolve: (path: string) => string;
}

export function compareValues(val: string, op: string, expected: string): boolean {
  switch (op) {
    case '==':
      return val === expected;
    case '!=':
      return val !== expected;
    case '>':
      return parseFloat(val) > parseFloat(expected);
    case '<':
      return parseFloat(val) < parseFloat(expected);
    case '>=':
      return parseFloat(val) >= parseFloat(expected);
    case '<=':
      return parseFloat(val) <= parseFloat(expected);
    case 'contains':
      return val.includes(expected);
    case 'startsWith':
      return val.startsWith(expected);
    case 'endsWith':
      return val.endsWith(expected);
    case 'matches': {
      try {
        return new RegExp(expected).test(val);
      } catch {
        return false;
      }
    }
    default:
      return val === expected;
  }
}

export function evaluateCondition(expr: string, context: ConditionContext): boolean {
  if (!expr || expr === 'true') return true;
  if (expr === 'false') return false;

  const resolved = resolveTemplates(expr, context);
  return simpleEvaluate(resolved);
}

function resolveTemplates(expr: string, context: ConditionContext): string {
  return expr.replace(/\{\{(.+?)\}\}/g, (_match, path: string) => {
    const trimmed = path.trim();
    try {
      const value = context.resolve(trimmed);
      if (isNumeric(value) || isBool(value)) return value;
      return JSON.stringify(value);
    } catch {
      return 'undefined';
    }
  });
}

function simpleEvaluate(expr: string): boolean {
  expr = expr.trim();

  if (expr === 'true') return true;
  if (expr === 'false') return false;
  if (expr === 'undefined' || expr === 'null') return false;

  const match = expr.match(
    /^("?)(.+?)\1\s+(==|!=|>|<|>=|<=|contains|startsWith|endsWith|matches)\s+("?)(.+?)\4$/,
  );
  if (match) {
    const [, , left, op, , right] = match;
    return compareValues(left!, op!, right!);
  }

  if (expr.includes('undefined') || expr.includes('null')) return false;
  if (expr.includes('true')) return true;

  return expr !== '' && expr !== '0';
}

function isNumeric(v: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(v);
}

function isBool(v: string): boolean {
  return v === 'true' || v === 'false';
}
