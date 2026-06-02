import { describe, it, expect } from 'vitest';
import { Annotation } from '../annotation.js';

describe('Annotation', () => {
  it('creates annotation with default and reducer', () => {
    const ann = Annotation<string[]>({
      reducer: (a, b) => [...a, ...b],
      default: () => [],
    });

    expect(ann.default()).toEqual([]);
    expect(ann.reducer(['a'], ['b'])).toEqual(['a', 'b']);
  });

  it('last-write-wins reducer', () => {
    const ann = Annotation<number>({
      reducer: (_a, b) => b,
      default: () => 0,
    });

    expect(ann.default()).toBe(0);
    expect(ann.reducer(5, 10)).toBe(10);
  });

  it('custom dedup reducer by key', () => {
    type Item = { id: string; value: string };
    const ann = Annotation<Item[]>({
      reducer: (a, b) => {
        const seen = new Set(a.map((x) => x.id));
        const newItems = b.filter((x) => !seen.has(x.id));
        return [...a, ...newItems];
      },
      default: () => [],
    });

    const result = ann.reducer(
      [{ id: '1', value: 'a' }],
      [{ id: '1', value: 'b' }, { id: '2', value: 'c' }],
    );
    expect(result).toEqual([
      { id: '1', value: 'a' },
      { id: '2', value: 'c' },
    ]);
  });
});
