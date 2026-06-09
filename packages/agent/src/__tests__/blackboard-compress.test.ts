import { describe, it, expect } from 'vitest';
import { compressSnapshot, injectBlackboardSnapshot } from '../blackboard-compress.js';

describe('blackboard-compress', () => {
  it('compresses long entries to maxEntryLength', () => {
    const snapshot = '## discoveries\n' + '- [2024-01-01T00:00:00.000Z @agent] ' + 'x'.repeat(500);
    const compressed = compressSnapshot(snapshot, { budget: 1000, maxEntryLength: 50 });
    const lines = compressed.split('\n');
    expect(lines[1]!.length).toBeLessThanOrEqual(55); // 50 + '…'
  });

  it('drops oldest entries when over budget', () => {
    const snapshot = [
      '## discoveries',
      '- [2024-01-01T00:00:00.000Z @a] old1',
      '- [2024-01-02T00:00:00.000Z @a] old2',
      '- [2024-01-03T00:00:00.000Z @a] keep',
    ].join('\n');
    const compressed = compressSnapshot(snapshot, { budget: 50, maxEntryLength: 200 });
    expect(compressed).toContain('keep');
  });

  it('injects snapshot when under budget', () => {
    const result = injectBlackboardSnapshot('short snapshot', 'base prompt', 2000);
    expect(result).toContain('[Shared Context]');
    expect(result).toContain('short snapshot');
  });

  it('injects compressed snapshot when over budget', () => {
    const longSnapshot = '## topic\n' + '- '.repeat(1000);
    const result = injectBlackboardSnapshot(longSnapshot, 'base prompt', 50);
    expect(result).toContain('[Shared Context (compressed)]');
  });
});
