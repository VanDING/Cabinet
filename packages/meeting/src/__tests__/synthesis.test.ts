import { describe, it, expect } from 'vitest';
import { generateSynthesis } from '../synthesis.js';
import type { AdvisorFinding, ReviewIssue } from '../protocol.js';

describe('generateSynthesis', () => {
  it('generates section header with topic', () => {
    const result = generateSynthesis({
      topic: 'Test Topic',
      findings: [],
      synthesisText: '',
      reviewIssues: [],
    });
    expect(result).toContain('## Analysis: Test Topic');
  });

  it('includes synthesis text when provided', () => {
    const result = generateSynthesis({
      topic: 'Topic',
      findings: [],
      synthesisText: 'A synthesized summary.',
      reviewIssues: [],
    });
    expect(result).toContain('**Synthesis:** A synthesized summary.');
  });

  it('omits synthesis text when empty', () => {
    const result = generateSynthesis({
      topic: 'Topic',
      findings: [],
      synthesisText: '',
      reviewIssues: [],
    });
    expect(result).not.toContain('**Synthesis:**');
  });

  it('lists perspectives with confidence scores', () => {
    const findings: AdvisorFinding[] = [
      { perspective: 'Finance', claim: 'Costs are too high', evidence: 'Budget report Q2', confidence: 0.8 },
      { perspective: 'Legal', claim: 'Risk of non-compliance', evidence: 'Regulation XYZ', confidence: 0.6 },
    ];
    const result = generateSynthesis({
      topic: 'Budget Review',
      findings,
      synthesisText: '',
      reviewIssues: [],
    });
    expect(result).toContain('### Perspectives');
    expect(result).toContain('**Finance**');
    expect(result).toContain('confidence: 0.8');
    expect(result).toContain('**Legal**');
    expect(result).toContain('confidence: 0.6');
    expect(result).toContain('Costs are too high');
  });

  it('flags minority opinions when confidence is >0.3 below average with >2 findings', () => {
    const findings: AdvisorFinding[] = [
      { perspective: 'A', claim: 'X', evidence: 'E1', confidence: 0.9 },
      { perspective: 'B', claim: 'Y', evidence: 'E2', confidence: 0.85 },
      { perspective: 'C', claim: 'Z', evidence: 'E3', confidence: 0.3 }, // avg=0.683, diff=0.383 > 0.3
    ];
    const result = generateSynthesis({
      topic: 'Topic',
      findings,
      synthesisText: '',
      reviewIssues: [],
    });
    expect(result).toContain('MINORITY');
    expect(result).toContain('### Minority Report');
    expect(result).toContain('**C**');
  });

  it('does NOT flag minority with only 2 findings', () => {
    const findings: AdvisorFinding[] = [
      { perspective: 'A', claim: 'X', evidence: 'E1', confidence: 0.9 },
      { perspective: 'B', claim: 'Y', evidence: 'E2', confidence: 0.3 },
    ];
    const result = generateSynthesis({
      topic: 'Topic',
      findings,
      synthesisText: '',
      reviewIssues: [],
    });
    expect(result).not.toContain('MINORITY');
    expect(result).not.toContain('Minority Report');
  });

  it('includes reviewer notes with severity', () => {
    const issues: ReviewIssue[] = [
      { type: 'bias', detail: 'Potential confirmation bias detected', severity: 'high' },
      { type: 'gap', detail: 'Missing financial perspective', severity: 'medium' },
    ];
    const result = generateSynthesis({
      topic: 'Topic',
      findings: [],
      synthesisText: '',
      reviewIssues: issues,
    });
    expect(result).toContain('### Reviewer Notes');
    expect(result).toContain('[high] Potential confirmation bias detected');
    expect(result).toContain('[medium] Missing financial perspective');
  });

  it('includes all sections together', () => {
    const findings: AdvisorFinding[] = [
      { perspective: 'Ops', claim: 'Process is broken', evidence: 'Incident #5', confidence: 0.75 },
    ];
    const issues: ReviewIssue[] = [
      { type: 'clarity', detail: 'Ambiguous wording in claim', severity: 'low' },
    ];
    const result = generateSynthesis({
      topic: 'Full Test',
      findings,
      synthesisText: 'Everything is fine.',
      reviewIssues: issues,
    });

    expect(result).toContain('## Analysis: Full Test');
    expect(result).toContain('**Synthesis:** Everything is fine.');
    expect(result).toContain('### Perspectives');
    expect(result).toContain('**Ops**');
    expect(result).toContain('### Reviewer Notes');
    expect(result).toContain('[low] Ambiguous wording in claim');
  });

  it('minority threshold calc: confidence < avg-0.3', () => {
    // avg = (0.5 + 0.5 + 0.1) / 3 = 0.366..., threshold = 0.366 - 0.3 = 0.066
    // 0.1 is NOT < 0.066, so no minority
    const findings: AdvisorFinding[] = [
      { perspective: 'A', claim: 'a', evidence: 'e', confidence: 0.5 },
      { perspective: 'B', claim: 'b', evidence: 'e', confidence: 0.5 },
      { perspective: 'C', claim: 'c', evidence: 'e', confidence: 0.1 },
    ];
    const result = generateSynthesis({
      topic: 'Edge',
      findings,
      synthesisText: '',
      reviewIssues: [],
    });
    // avg=0.366, threshold=0.066, 0.1 is NOT < 0.066
    expect(result).not.toContain('MINORITY');
  });
});
