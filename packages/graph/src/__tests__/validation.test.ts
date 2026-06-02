import { describe, it, expect } from 'vitest';
import { validateGraph, type EdgeDef } from '../validation.js';

describe('validateGraph', () => {
  const nodeIds = new Set(['a', 'b', 'c', 'd']);
  const entry = 'a';

  it('passes for a valid linear graph', () => {
    const edges: EdgeDef[] = [
      { type: 'static', from: 'a', to: 'b' },
      { type: 'static', from: 'b', to: 'c' },
    ];
    const result = validateGraph(nodeIds, edges, entry);
    expect(result.ok).toBe(true);
  });

  it('fails when edge references unknown target', () => {
    const edges: EdgeDef[] = [
      { type: 'static', from: 'a', to: 'nonexistent' },
    ];
    const result = validateGraph(nodeIds, edges, entry);
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors![0]!.message).toContain('nonexistent');
  });

  it('fails when entry node does not exist', () => {
    const edges: EdgeDef[] = [];
    const result = validateGraph(nodeIds, edges, 'nonexistent');
    expect(result.ok).toBe(false);
    expect(result.errors![0]!.message.toLowerCase()).toContain('entry');
  });

  it('warns about unreachable nodes', () => {
    const edges: EdgeDef[] = [
      { type: 'static', from: 'a', to: 'b' },
    ];
    const result = validateGraph(nodeIds, edges, entry);
    expect(result.warnings?.some((w) => w.message.includes('unreachable'))).toBe(true);
  });

  it('warns about cycles without conditional exit', () => {
    const edges: EdgeDef[] = [
      { type: 'static', from: 'a', to: 'b' },
      { type: 'static', from: 'b', to: 'a' },
    ];
    const result = validateGraph(nodeIds, edges, entry);
    const cycleWarning = result.warnings?.find((w) => w.pass === 'pass_3_cycles');
    expect(cycleWarning).toBeDefined();
    expect(cycleWarning!.message.toLowerCase()).toContain('cycle');
  });

  it('does NOT warn when cycle has a conditional edge as escape', () => {
    const edges: EdgeDef[] = [
      { type: 'static', from: 'a', to: 'b' },
      { type: 'static', from: 'b', to: 'a' },
      { type: 'conditional', from: 'a', to: 'c', conditionValue: 'done' },
      { type: 'conditional', from: 'a', to: 'b', conditionValue: 'tools' },
    ];
    const result = validateGraph(nodeIds, edges, entry);
    const cycleWarning = result.warnings?.find((w) => w.pass === 'pass_3_cycles');
    expect(cycleWarning).toBeUndefined();
  });

  it('fails when conditional edge from a node has no default target', () => {
    const edges: EdgeDef[] = [
      { type: 'conditional', from: 'a', to: 'b', conditionValue: 'tools' },
    ];
    const result = validateGraph(nodeIds, edges, entry);
    expect(result.ok).toBe(false);
    expect(result.errors![0]!.message).toContain('default');
  });
});
