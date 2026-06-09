import { describe, it, expect } from 'vitest';
import { collectToolVariety } from '../tool-variety-collector.js';

describe('collectToolVariety', () => {
  it('calculates variety for empty history', () => {
    const snapshot = collectToolVariety('sess-1', [], 20);
    expect(snapshot.sessionId).toBe('sess-1');
    expect(snapshot.exposedTools).toBe(20);
    expect(snapshot.usedTools).toBe(0);
    expect(snapshot.gapRatio).toBe(Infinity);
    expect(snapshot.topTools).toHaveLength(0);
  });

  it('calculates variety for single tool', () => {
    const history = Array(10).fill({ name: 'read_file' });
    const snapshot = collectToolVariety('sess-2', history, 20);
    expect(snapshot.usedTools).toBe(1);
    expect(snapshot.gapRatio).toBe(20);
    expect(snapshot.uniqueToolsPerStepAvg).toBe(0.1);
    expect(snapshot.topTools).toEqual([['read_file', 10]]);
  });

  it('calculates variety for diverse tools', () => {
    const history = [
      { name: 'read_file' },
      { name: 'grep' },
      { name: 'read_file' },
      { name: 'write_file' },
      { name: 'grep' },
      { name: 'edit_file' },
    ];
    const snapshot = collectToolVariety('sess-3', history, 20);
    expect(snapshot.usedTools).toBe(4);
    expect(snapshot.gapRatio).toBe(5); // 20 / 4
    expect(snapshot.uniqueToolsPerStepAvg).toBeCloseTo(4 / 6, 2);
    expect(snapshot.topTools).toHaveLength(4);
    expect(snapshot.topTools[0]![0]).toBe('read_file');
    expect(snapshot.topTools[0]![1]).toBe(2);
  });

  it('limits topTools to 5', () => {
    const history = [
      { name: 't1' },
      { name: 't2' },
      { name: 't3' },
      { name: 't4' },
      { name: 't5' },
      { name: 't6' },
      { name: 't7' },
    ];
    const snapshot = collectToolVariety('sess-4', history, 20);
    expect(snapshot.topTools).toHaveLength(5);
  });
});
