import { describe, it, expect, beforeEach } from 'vitest';
import { ToolExecutor } from '../../tool-executor.js';
import { createCabinetTools, type ToolDependencies } from '../index.js';
import { MemoryEventBus } from '@cabinet/events';
import { ShortTermMemory, LongTermMemory, EntityMemory, ProjectMemory } from '@cabinet/memory';
import type { DecisionStore } from '@cabinet/decision';
import type { Decision } from '@cabinet/types';

class MockDecisionStore implements DecisionStore {
  private decisions = new Map<string, Decision>();
  save(d: Decision): void { this.decisions.set(d.id, d); }
  get(id: string): Decision | null { return this.decisions.get(id) ?? null; }
  listByProject(_projectId: string): Decision[] { return [...this.decisions.values()]; }
  listPending(_projectId: string): Decision[] {
    return [...this.decisions.values()].filter(d => d.status === 'pending');
  }
}

describe('Cabinet Tools', () => {
  let executor: ToolExecutor;
  let deps: ToolDependencies;

  beforeEach(() => {
    executor = new ToolExecutor();
    deps = {
      decisionStore: new MockDecisionStore(),
      eventBus: new MemoryEventBus(),
      shortTerm: new ShortTermMemory(),
      longTerm: new LongTermMemory(),
      entity: new EntityMemory(),
      project: new ProjectMemory(),
    };

    const tools = createCabinetTools(deps);
    for (const tool of tools) {
      executor.register(tool);
    }
  });

  it('registers 10 tools', () => {
    expect(executor.listTools()).toHaveLength(10);
  });

  it('remember and recall work together', async () => {
    const r1 = await executor.execute('remember', 'tc1', { sessionId: 's1', key: 'name', value: 'Captain' });
    expect(r1.output).toEqual({ remembered: true, key: 'name' });

    const r2 = await executor.execute('recall', 'tc2', { sessionId: 's1', key: 'name' });
    expect((r2.output as any).value).toBe('Captain');
  });

  it('query_decisions returns empty array initially', async () => {
    const r = await executor.execute('query_decisions', 'tc3', { status: 'pending' });
    expect((r.output as any)).toEqual([]);
  });

  it('get_decision returns error for unknown', async () => {
    const r = await executor.execute('get_decision', 'tc4', { decisionId: 'unknown' });
    expect((r.output as any).error).toContain('not found');
  });

  it('get_status returns operational', async () => {
    const r = await executor.execute('get_status', 'tc5', {});
    expect((r.output as any).status).toBe('operational');
  });

  it('search_memory finds stored entries', async () => {
    await deps.longTerm.store({ content: 'Q2 revenue up 15%', metadata: {}, timestamp: new Date() });
    const r = await executor.execute('search_memory', 'tc6', { query: 'revenue', limit: 5 });
    expect((r.output as any[])).toHaveLength(1);
  });

  it('get_project_context returns empty for uninitialized project', async () => {
    const r = await executor.execute('get_project_context', 'tc7', { projectId: 'unknown' });
    expect((r.output as any).error).toContain('not found');
  });

  it('get_captain_preferences returns defaults', async () => {
    const r = await executor.execute('get_captain_preferences', 'tc8', { captainId: 'c1' });
    expect((r.output as any).preferences).toEqual({});
  });
});
