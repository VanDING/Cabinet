import { describe, it, expect, beforeEach } from 'vitest';
import { QualityGate } from '../quality-gate';
import { TeachBack } from '../teach-back';

describe('QualityGate', () => {
  let gate: QualityGate;
  beforeEach(() => { gate = new QualityGate(); });

  it('passes output with all HEI sections', () => {
    const result = gate.checkHEI('假设：应该进入市场。证据：市场规模大。影响：可能带来高收益。');
    expect(result.passed).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it('fails output missing impact', () => {
    const result = gate.checkHEI('假设：应该进入。证据：有需求。');
    expect(result.passed).toBe(false);
    expect(result.missing).toContain('impact');
  });

  it('scores partial output correctly', () => {
    const result = gate.checkHEI('Only hypothesis here.');
    expect(result.score).toBeLessThan(1.0);
    expect(result.score).toBeGreaterThan(0);
  });
});

describe('TeachBack', () => {
  it('verifies correct restatement', () => {
    const tb = new TeachBack();
    const valid = tb.verify('Delete the old database', 'I understand that I should delete the old database');
    expect(valid).toBe(true);
  });

  it('rejects unrelated restatement', () => {
    const tb = new TeachBack();
    const valid = tb.verify('Delete the old database', 'I will create a new file');
    expect(valid).toBe(false);
  });

  it('generates teach-back prompt', () => {
    const tb = new TeachBack();
    const prompt = tb.generatePrompt('Delete production data');
    expect(prompt).toContain('Delete production data');
    expect(prompt).toContain('restate');
  });
});
