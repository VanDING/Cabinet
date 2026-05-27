import { describe, it, expect } from 'vitest';
import { evaluateCondition, type ConditionContext } from '../condition-evaluator.js';

function ctx(values: Record<string, string>): ConditionContext {
  return {
    resolve: (path: string) => {
      if (path in values) return values[path]!;
      throw new Error(`Unresolved: ${path}`);
    },
  };
}

describe('Condition Evaluator', () => {
  // ── Trivial ──
  it('returns true for empty expression', () => {
    expect(evaluateCondition('', ctx({}))).toBe(true);
  });

  it('returns true for literal "true"', () => {
    expect(evaluateCondition('true', ctx({}))).toBe(true);
  });

  it('returns false for literal "false"', () => {
    expect(evaluateCondition('false', ctx({}))).toBe(false);
  });

  // ── Template resolution ──
  it('resolves a simple template reference', () => {
    expect(evaluateCondition('{{status}} == done', ctx({ status: 'done' }))).toBe(true);
    expect(evaluateCondition('{{status}} == pending', ctx({ status: 'done' }))).toBe(false);
  });

  it('resolves nested path references (dot notation)', () => {
    expect(
      evaluateCondition(
        '{{steps.analyze.output.score}} > 0.7',
        ctx({ 'steps.analyze.output.score': '0.85' }),
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        '{{steps.analyze.output.score}} > 0.9',
        ctx({ 'steps.analyze.output.score': '0.85' }),
      ),
    ).toBe(false);
  });

  // ── Numeric comparisons ──
  it('evaluates >', () => {
    expect(evaluateCondition('5 > 3', ctx({}))).toBe(true);
    expect(evaluateCondition('3 > 5', ctx({}))).toBe(false);
  });

  it('evaluates <', () => {
    expect(evaluateCondition('3 < 5', ctx({}))).toBe(true);
    expect(evaluateCondition('5 < 3', ctx({}))).toBe(false);
  });

  it('evaluates >=', () => {
    expect(evaluateCondition('5 >= 5', ctx({}))).toBe(true);
    expect(evaluateCondition('5 >= 3', ctx({}))).toBe(true);
    expect(evaluateCondition('3 >= 5', ctx({}))).toBe(false);
  });

  it('evaluates <=', () => {
    expect(evaluateCondition('3 <= 3', ctx({}))).toBe(true);
    expect(evaluateCondition('3 <= 5', ctx({}))).toBe(true);
    expect(evaluateCondition('5 <= 3', ctx({}))).toBe(false);
  });

  it('evaluates ==', () => {
    expect(evaluateCondition('42 == 42', ctx({}))).toBe(true);
    expect(evaluateCondition('42 == 0', ctx({}))).toBe(false);
  });

  it('evaluates !=', () => {
    expect(evaluateCondition('42 != 0', ctx({}))).toBe(true);
    expect(evaluateCondition('42 != 42', ctx({}))).toBe(false);
  });

  // ── String comparisons ──
  it('evaluates string ==', () => {
    expect(evaluateCondition('"hello" == "hello"', ctx({}))).toBe(true);
    expect(evaluateCondition('"hello" == "world"', ctx({}))).toBe(false);
  });

  it('evaluates contains operator', () => {
    expect(evaluateCondition('"hello world" contains "world"', ctx({}))).toBe(true);
    expect(evaluateCondition('"hello world" contains "xyz"', ctx({}))).toBe(false);
  });

  it('case-sensitive contains', () => {
    expect(evaluateCondition('"Hello World" contains "World"', ctx({}))).toBe(true);
    expect(evaluateCondition('"Hello World" contains "world"', ctx({}))).toBe(false);
  });

  // ── Boolean comparisons ──
  it('evaluates boolean ==', () => {
    expect(evaluateCondition('true == true', ctx({}))).toBe(true);
    expect(evaluateCondition('true == false', ctx({}))).toBe(false);
  });

  it('evaluates boolean !=', () => {
    expect(evaluateCondition('true != false', ctx({}))).toBe(true);
  });

  // ── Logical operators ──
  it('evaluates AND', () => {
    expect(evaluateCondition('true AND true', ctx({}))).toBe(true);
    expect(evaluateCondition('true AND false', ctx({}))).toBe(false);
    expect(evaluateCondition('false AND true', ctx({}))).toBe(false);
    expect(evaluateCondition('false AND false', ctx({}))).toBe(false);
  });

  it('evaluates OR', () => {
    expect(evaluateCondition('true OR true', ctx({}))).toBe(true);
    expect(evaluateCondition('true OR false', ctx({}))).toBe(true);
    expect(evaluateCondition('false OR true', ctx({}))).toBe(true);
    expect(evaluateCondition('false OR false', ctx({}))).toBe(false);
  });

  it('evaluates NOT', () => {
    expect(evaluateCondition('NOT true', ctx({}))).toBe(false);
    expect(evaluateCondition('NOT false', ctx({}))).toBe(true);
  });

  // ── Combined ──
  it('evaluates combined expression with templates', () => {
    expect(
      evaluateCondition(
        '{{score}} > 0.7 AND {{pass}} == true',
        ctx({ score: '0.85', pass: 'true' }),
      ),
    ).toBe(true);

    expect(
      evaluateCondition(
        '{{score}} > 0.7 AND {{pass}} == true',
        ctx({ score: '0.65', pass: 'true' }),
      ),
    ).toBe(false);
  });

  it('evaluates OR with templates', () => {
    expect(
      evaluateCondition(
        '{{status}} == done OR {{status}} == approved',
        ctx({ status: 'approved' }),
      ),
    ).toBe(true);
  });

  it('evaluates contains with template', () => {
    expect(
      evaluateCondition(
        '{{output}} contains "error"',
        ctx({ output: 'Processing failed with error E500' }),
      ),
    ).toBe(true);

    expect(
      evaluateCondition(
        '{{output}} contains "error"',
        ctx({ output: 'Processing completed successfully' }),
      ),
    ).toBe(false);
  });

  // ── Parentheses ──
  it('respects parentheses grouping', () => {
    // (true OR false) AND false → false
    expect(evaluateCondition('(true OR false) AND false', ctx({}))).toBe(false);
    // true OR (false AND false) → true
    expect(evaluateCondition('true OR (false AND false)', ctx({}))).toBe(true);
  });

  it('NOT with parentheses', () => {
    expect(evaluateCondition('NOT (true AND false)', ctx({}))).toBe(true);
    expect(evaluateCondition('NOT (true OR false)', ctx({}))).toBe(false);
  });

  // ── Standalone value truthiness ──
  it('standalone non-empty string is truthy', () => {
    expect(evaluateCondition('"hello"', ctx({}))).toBe(true);
  });

  it('standalone empty string is falsy', () => {
    expect(evaluateCondition('""', ctx({}))).toBe(false);
  });

  it('standalone zero is falsy', () => {
    expect(evaluateCondition('0', ctx({}))).toBe(false);
  });

  it('standalone non-zero number is truthy', () => {
    expect(evaluateCondition('1', ctx({}))).toBe(true);
    expect(evaluateCondition('-1', ctx({}))).toBe(true);
  });
});
