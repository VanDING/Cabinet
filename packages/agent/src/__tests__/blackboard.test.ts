import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryEventBus } from '@cabinet/events';
import { AgentBlackboard } from '../blackboard.js';

describe('AgentBlackboard', () => {
  let eventBus: MemoryEventBus;
  let bb: AgentBlackboard;

  beforeEach(() => {
    eventBus = new MemoryEventBus();
    bb = new AgentBlackboard(eventBus, {
      enabled: true,
      snapshotBudgetTokens: 2000,
      defaultMaxEntries: 10,
    });
  });

  it('registers built-in topics on construction', () => {
    const entries = bb.read('discoveries');
    expect(entries).toEqual([]);
  });

  it('appends entries to append topics', async () => {
    await bb.write('discoveries', { type: 'bug', summary: 'Found XSS' }, 'agent-a');
    await bb.write('discoveries', { type: 'feat', summary: 'Added auth' }, 'agent-b');
    const entries = bb.read('discoveries');
    expect(entries.length).toBe(2);
    expect(entries[0]!.payload).toEqual({ type: 'bug', summary: 'Found XSS' });
    expect(entries[1]!.payload).toEqual({ type: 'feat', summary: 'Added auth' });
  });

  it('replaces entries on replace topics', async () => {
    await bb.write('files', 'a.ts', 'agent-a');
    await bb.write('files', 'b.ts', 'agent-b');
    const entries = bb.read('files');
    expect(entries.length).toBe(1);
    expect(entries[0]!.payload).toBe('b.ts');
  });

  it('merges object payloads on merge topics', async () => {
    await bb.write('preferences', { theme: 'dark' }, 'agent-a');
    await bb.write('preferences', { fontSize: 14 }, 'agent-b');
    const entries = bb.read('preferences');
    expect(entries.length).toBe(2);
    const lastPayload = entries[entries.length - 1]!.payload as Record<string, unknown>;
    expect(lastPayload.theme).toBe('dark');
    expect(lastPayload.fontSize).toBe(14);
  });

  it('enforces maxEntries', async () => {
    const limitedBb = new AgentBlackboard(eventBus, {
      enabled: true,
      snapshotBudgetTokens: 2000,
      defaultMaxEntries: 3,
    });
    for (let i = 0; i < 5; i++) {
      await limitedBb.write('discoveries', { type: 'test', summary: String(i) }, 'agent');
    }
    const entries = limitedBb.read('discoveries');
    expect(entries.length).toBe(3);
    expect((entries[0]!.payload as any).summary).toBe('2');
  });

  it('generates a snapshot string', async () => {
    await bb.write('discoveries', { type: 'bug', summary: 'XSS' }, 'agent-a');
    await bb.write('project', { name: 'MyApp', goals: ['ship'] }, 'agent-a');
    const snapshot = bb.snapshot();
    expect(snapshot).toContain('## discoveries');
    expect(snapshot).toContain('XSS');
    expect(snapshot).toContain('## project');
    expect(snapshot).toContain('MyApp');
  });

  it('snapshot filters by topic list', async () => {
    await bb.write('discoveries', { type: 'bug', summary: 'XSS' }, 'agent-a');
    await bb.write('project', { name: 'MyApp', goals: ['ship'] }, 'agent-a');
    const snapshot = bb.snapshot(['discoveries']);
    expect(snapshot).toContain('discoveries');
    expect(snapshot).not.toContain('project');
  });

  it('publishes events via EventBus', async () => {
    let received = false;
    eventBus.subscribe('system_notification' as any, () => {
      received = true;
    });
    await bb.write('discoveries', { type: 'test', summary: 'x' }, 'agent');
    expect(received).toBe(true);
  });

  describe('ContextSlot bridge', () => {
    it('imports a ContextSlot into Blackboard topics', async () => {
      const slot = {
        version: 5,
        project: { name: 'MyApp', goals: ['ship'], tech_stack: 'TS' },
        memories: ['m1', 'm2'],
        preferences: { riskTolerance: 'medium' as const },
        files: ['a.ts'],
        discoveries: [{ type: 'bug', summary: 'XSS' }],
        previous_outputs: ['out1'],
        security: { level: 'L2', maxRetries: 3 },
      };

      await bb.importFromContextSlot(slot, 'agent-x');

      expect((bb.read('project')[0]?.payload as any).name).toBe('MyApp');
      expect(bb.read('memories').map((e) => e.payload)).toEqual(['m1', 'm2']);
      expect(bb.read('files').map((e) => e.payload)).toEqual(['a.ts']);
      expect(bb.read('discoveries').map((e) => e.payload)).toEqual([
        { type: 'bug', summary: 'XSS' },
      ]);
      expect(bb.read('outputs').map((e) => e.payload)).toEqual(['out1']);
      expect(bb.read('security')[0]?.payload).toEqual({ level: 'L2', maxRetries: 3 });
    });

    it('round-trips ContextSlot through Blackboard', async () => {
      const slot = {
        version: 3,
        project: { name: 'MyApp', goals: ['ship'] },
        memories: ['m1'],
        preferences: { riskTolerance: 'high' as const },
        files: ['a.ts', 'b.ts'],
        discoveries: [{ type: 'feat', summary: 'auth' }],
        previous_outputs: ['out1', 'out2'],
        security: { level: 'L1', maxRetries: 2 },
        deliverable: { report: 'done' },
      };

      await bb.importFromContextSlot(slot, 'agent-x');
      const exported = bb.exportToContextSlot();

      expect(exported.version).toBeGreaterThanOrEqual(3);
      expect(exported.project).toEqual(slot.project);
      expect(exported.memories).toEqual(slot.memories);
      expect(exported.preferences).toEqual(slot.preferences);
      expect(exported.files).toEqual(slot.files);
      expect(exported.discoveries).toEqual(slot.discoveries);
      expect(exported.previous_outputs).toEqual(slot.previous_outputs);
      expect(exported.security).toEqual(slot.security);
      expect(exported.deliverable).toEqual(slot.deliverable);
    });

    it('maps per-topic versions to ContextSlot.version', async () => {
      const slot = {
        version: 1,
        project: { name: 'App', goals: [] },
        memories: [],
        preferences: {},
        files: [],
        discoveries: [],
        previous_outputs: [],
        security: { level: 'L1', maxRetries: 2 },
      };
      await bb.importFromContextSlot(slot);
      await bb.write('memories', 'new memory', 'agent');
      await bb.write('files', 'c.ts', 'agent');

      const exported = bb.exportToContextSlot();
      expect(exported.version).toBeGreaterThan(1);
    });
  });
});
