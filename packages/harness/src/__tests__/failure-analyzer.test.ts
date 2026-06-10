import { describe, it, expect } from 'vitest';
import { FailurePatternAnalyzer } from '../failure-analyzer.js';

describe('FailurePatternAnalyzer', () => {
  it('analyzes memory stats', () => {
    const analyzer = new FailurePatternAnalyzer(null, false);
    const analysis = analyzer.analyze([
      {
        toolName: 'read_file',
        total: 10,
        failed: 5,
        errors: ['Error: timeout', 'Error: not found'],
      },
      { toolName: 'write_file', total: 8, failed: 1, errors: ['Error: permission denied'] },
      { toolName: 'search', total: 20, failed: 0, errors: [] },
    ]);

    expect(analysis.patterns.length).toBe(2);
    expect(analysis.patterns[0]!.toolName).toBe('read_file');
    expect(analysis.patterns[0]!.failureRate).toBe(0.5);
    expect(analysis.recommendations.length).toBeGreaterThan(0);
    expect(analysis.topIssues[0]).toContain('read_file');
  });

  it('categorizes errors', () => {
    const analyzer = new FailurePatternAnalyzer(null, false);
    const analysis = analyzer.analyze([
      {
        toolName: 'exec',
        total: 5,
        failed: 3,
        errors: ['Error: timeout', 'Error: rate limit', 'Error: network'],
      },
    ]);

    expect(analysis.patterns[0]!.errorTypes.timeout).toBe(1);
    expect(analysis.patterns[0]!.errorTypes.rate_limit).toBe(1);
    expect(analysis.patterns[0]!.errorTypes.network).toBe(1);
  });

  it('returns empty for healthy stats', () => {
    const analyzer = new FailurePatternAnalyzer(null, false);
    const analysis = analyzer.analyze([
      { toolName: 'read_file', total: 10, failed: 0, errors: [] },
    ]);

    expect(analysis.patterns.length).toBe(0);
    expect(analysis.recommendations.length).toBe(0);
  });
});
