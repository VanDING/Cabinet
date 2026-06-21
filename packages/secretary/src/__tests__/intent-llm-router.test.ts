import { describe, it, expect, vi } from 'vitest';
import type { LLMGateway } from '@cabinet/gateway';
import { parseJSONIntent, parseRouteResult } from '../intent-llm-router.js';
import type { ParsedIntent } from '../intent-parser.js';

describe('parseJSONIntent', () => {
  it('parses a valid decision_request JSON', () => {
    const json =
      '{"kind": "decision_request", "topic": "投资决策", "context": "是否投资", "suggestedDimensions": ["成本", "风险"]}';
    const result = parseJSONIntent(json);
    expect(result.kind).toBe('decision_request');
    expect((result as any).topic).toBe('投资决策');
  });

  it('parses a valid knowledge_query JSON', () => {
    const json = '{"kind": "knowledge_query", "question": "什么是AI", "scope": "both"}';
    const result = parseJSONIntent(json);
    expect(result.kind).toBe('knowledge_query');
    expect((result as any).question).toBe('什么是AI');
  });

  it('parses a valid follow_up JSON', () => {
    const json = '{"kind": "follow_up", "previousKind": "decision_request", "raw": "继续"}';
    const result = parseJSONIntent(json);
    expect(result.kind).toBe('follow_up');
  });

  it('parses invoke_skill with extra fields', () => {
    const json = '{"kind": "invoke_skill", "skillName": "test-skill", "args": "some args"}';
    const result = parseJSONIntent(json);
    expect(result.kind).toBe('invoke_skill');
    if (result.kind === 'invoke_skill') {
      expect(result.skillName).toBe('test-skill');
      expect(result.args).toBe('some args');
    }
  });

  it('returns unknown for invalid JSON', () => {
    const result = parseJSONIntent('not json at all');
    expect(result.kind).toBe('unknown');
  });

  it('returns unknown for empty JSON object', () => {
    const result = parseJSONIntent('{}');
    expect(result.kind).toBe('unknown');
  });

  it('returns unknown for JSON without kind field', () => {
    const result = parseJSONIntent('{"topic": "something"}');
    expect(result.kind).toBe('unknown');
  });

  it('handles JSON wrapped in markdown backticks', () => {
    const json = '```json\n{"kind": "knowledge_query", "question": "test"}\n```';
    const result = parseJSONIntent(json);
    expect(result.kind).toBe('knowledge_query');
  });

  it('handles extra whitespace around JSON', () => {
    const json = '  \n  {"kind": "status_query", "target": "project"}  \n';
    const result = parseJSONIntent(json);
    expect(result.kind).toBe('status_query');
  });
});

describe('parseRouteResult', () => {
  const sampleIntent: ParsedIntent = { kind: 'unknown', raw: 'test' };
  const validAgents = new Set(['secretary', 'organize']);
  const fallback = {
    targetAgent: 'secretary' as const,
    confidence: 0.5,
    reasoning: 'default',
    intent: sampleIntent,
  };

  it('parses a valid routing JSON', () => {
    const json = '{"targetAgent": "secretary", "confidence": 0.9, "reasoning": "Best match"}';
    const result = parseRouteResult(json, sampleIntent, validAgents, () => fallback);
    expect(result.targetAgent).toBe('secretary');
    expect(result.confidence).toBe(0.9);
    expect(result.reasoning).toBe('Best match');
  });

  it('clamps confidence to 0-1 range', () => {
    const json = '{"targetAgent": "secretary", "confidence": 1.5, "reasoning": "x"}';
    const result = parseRouteResult(json, sampleIntent, validAgents, () => fallback);
    expect(result.confidence).toBe(1.0);
  });

  it('defaults unknown agent types to secretary', () => {
    const json = '{"targetAgent": "nonexistent", "confidence": 0.8, "reasoning": "x"}';
    const result = parseRouteResult(json, sampleIntent, validAgents, () => fallback);
    expect(result.targetAgent).toBe('secretary');
  });

  it('uses fallback when JSON is invalid', () => {
    const result = parseRouteResult('not json', sampleIntent, validAgents, () => fallback);
    expect(result.targetAgent).toBe('secretary');
    expect(result.confidence).toBe(0.5);
  });

  it('detects topicContinuity field', () => {
    const json =
      '{"targetAgent": "organize", "confidence": 0.7, "reasoning": "x", "topicContinuity": true}';
    const result = parseRouteResult(json, sampleIntent, validAgents, () => fallback);
    expect(result.topicContinuity).toBe(true);
  });

  it('topicContinuity defaults to false when absent', () => {
    const json = '{"targetAgent": "secretary", "confidence": 0.6, "reasoning": "x"}';
    const result = parseRouteResult(json, sampleIntent, validAgents, () => fallback);
    expect(result.topicContinuity).toBe(false);
  });
});
