import { describe, it, expect } from 'vitest';
import {
  buildChairPrompt,
  parseChairResponse,
  buildAdvisorPrompt,
  parseAdvisorResponse,
  buildReviewerTask,
  parseReviewerResponse,
  buildExtractionPrompt,
  parseExtractionResponse,
} from '../protocol.js';

describe('buildChairPrompt', () => {
  it('includes topic in prompt', () => {
    const prompt = buildChairPrompt('Should we enter the EU market?');
    expect(prompt).toContain('Should we enter the EU market?');
  });

  it('includes user-specified advisors when provided', () => {
    const prompt = buildChairPrompt('Test topic', ['供应链', '市场']);
    expect(prompt).toContain('供应链');
    expect(prompt).toContain('市场');
    expect(prompt).toContain('MUST all be included');
  });

  it('does not include user advisor section when none provided', () => {
    const prompt = buildChairPrompt('Test topic');
    expect(prompt).not.toContain('MUST all be included');
  });
});

describe('parseChairResponse', () => {
  it('parses valid JSON response', () => {
    const json = JSON.stringify({
      selected_perspectives: [
        { id: 'market', name: 'Market Analysis', focus: 'EU entry barriers' },
      ],
      topic_refined: 'Should we enter EU?',
      key_questions: ['What are barriers?'],
    });
    const result = parseChairResponse(json, 'fallback');
    expect(result.selected_perspectives).toHaveLength(1);
    expect(result.selected_perspectives[0]!.name).toBe('Market Analysis');
    expect(result.topic_refined).toBe('Should we enter EU?');
  });

  it('falls back on invalid JSON', () => {
    const result = parseChairResponse('not json at all', 'fallback topic');
    expect(result.selected_perspectives[0]!.name).toBe('General Analysis');
    expect(result.topic_refined).toBe('fallback topic');
  });

  it('falls back on non-blueprint JSON', () => {
    const result = parseChairResponse('{"foo": "bar"}', 'fallback');
    expect(result.topic_refined).toBe('fallback');
  });
});

describe('parseAdvisorResponse', () => {
  it('parses valid findings', () => {
    const json = JSON.stringify({
      findings: [
        {
          perspective: 'Market',
          claim: 'High potential',
          evidence: 'Data shows...',
          confidence: 0.8,
        },
      ],
      synthesis: 'Overall positive',
      risks: ['Regulatory risk'],
      open_questions: ['Timeline?'],
    });
    const result = parseAdvisorResponse(json);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.confidence).toBe(0.8);
    expect(result.synthesis).toBe('Overall positive');
  });

  it('returns empty on invalid JSON', () => {
    const result = parseAdvisorResponse('not json');
    expect(result.findings).toEqual([]);
  });
});

describe('parseReviewerResponse', () => {
  it('parses pass result', () => {
    const json = JSON.stringify({ pass: true, score: 0.9, issues: [] });
    const result = parseReviewerResponse(json);
    expect(result.pass).toBe(true);
    expect(result.score).toBe(0.9);
  });

  it('parses fail result with issues', () => {
    const json = JSON.stringify({
      pass: false,
      score: 0.4,
      issues: [{ type: 'weak_evidence', detail: 'No data cited', severity: 'high' }],
    });
    const result = parseReviewerResponse(json);
    expect(result.pass).toBe(false);
    expect(result.issues).toHaveLength(1);
  });
});

describe('parseExtractionResponse', () => {
  it('parses actionable decision', () => {
    const json = JSON.stringify({
      hasDecision: true,
      title: 'Enter EU market',
      description: 'Decision about EU entry',
      options: [{ label: 'Enter', impact: 'High cost' }],
      level: 'L2',
    });
    const result = parseExtractionResponse(json);
    expect(result.hasDecision).toBe(true);
    expect(result.title).toBe('Enter EU market');
    expect(result.level).toBe('L2');
  });

  it('parses non-actionable result', () => {
    const json = JSON.stringify({ hasDecision: false });
    const result = parseExtractionResponse(json);
    expect(result.hasDecision).toBe(false);
  });
});

describe('end-to-end prompt/parse roundtrip', () => {
  it('chair prompt → parse produces valid brief', () => {
    const prompt = buildChairPrompt('Should we refactor the auth module?', ['安全']);
    expect(prompt).toContain('安全');
    // Simulate LLM response
    const response = JSON.stringify({
      selected_perspectives: [
        { id: 'security', name: '安全', focus: 'Auth vulnerability assessment' },
        { id: 'technical', name: '技术债务', focus: 'Refactor cost vs benefit' },
        { id: 'ux', name: '用户体验', focus: 'Login flow impact' },
      ],
      topic_refined: 'Evaluate auth module refactoring',
      key_questions: ['What are the risks?', 'How long will it take?'],
    });
    const brief = parseChairResponse(response, 'fallback');
    expect(brief.selected_perspectives).toHaveLength(3);
    expect(brief.key_questions).toHaveLength(2);
  });
});
