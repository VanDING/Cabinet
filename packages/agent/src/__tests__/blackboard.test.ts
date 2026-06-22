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
});
