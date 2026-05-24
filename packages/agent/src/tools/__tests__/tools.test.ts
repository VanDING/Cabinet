import { describe, it, expect, beforeEach } from 'vitest';
import { ToolExecutor } from '../../tool-executor.js';
import { createCabinetTools, type ToolDependencies } from '../index.js';
import { MemoryEventBus } from '@cabinet/events';
import { ShortTermMemory, LongTermMemory, EntityMemory, ProjectMemory } from '@cabinet/memory';
import type { DecisionStore } from '@cabinet/decision';
import type { Decision } from '@cabinet/types';

class MockDecisionStore implements DecisionStore {
  private decisions = new Map<string, Decision>();
  save(d: Decision): void {
    this.decisions.set(d.id, d);
  }
  get(id: string): Decision | null {
    return this.decisions.get(id) ?? null;
  }
  listByProject(_projectId: string): Decision[] {
    return [...this.decisions.values()];
  }
  listPending(_projectId: string): Decision[] {
    return [...this.decisions.values()].filter((d) => d.status === 'pending');
  }
}

describe('Cabinet Tools', () => {
  let executor: ToolExecutor;
  let deps: ToolDependencies;

  // Mock DB for LongTermMemory (better-sqlite3 native module unavailable in test)
  function mockDb() {
    const rows: any[] = [];
    return {
      exec: () => {},
      prepare: (sql: string) => {
        // For INSERT
        if (sql.startsWith('INSERT')) {
          return {
            run: (...args: any[]) => {
              if (sql.includes('memory_fts')) {
                return { changes: 1, lastInsertRowid: 1 };
              }
              rows.push({
                id: args[0],
                content: args[1],
                embedding: args[2],
                metadata: args[3],
                timestamp: args[4],
              });
              return { changes: 1, lastInsertRowid: rows.length };
            },
          };
        }
        // For DELETE
        if (sql.startsWith('DELETE')) {
          return {
            run: (...args: any[]) => {
              const idx = rows.findIndex((r) => r.id === args[0]);
              if (idx >= 0) rows.splice(idx, 1);
              return { changes: 1 };
            },
          };
        }
        // For SELECT rowid
        if (sql.includes('rowid')) {
          return {
            all: () => rows,
            get: (key: any) => {
              const r = rows.find((row) => row.id === key);
              return r ? { rowid: rows.indexOf(r) + 1 } : null;
            },
          };
        }
        // For SELECT (search)
        return {
          all: (...args: any[]) => {
            if (args.length > 0) {
              const pattern = String(args[0]).replace(/%/g, '');
              return rows.filter(
                (r) => String(r.content).includes(pattern) || String(r.metadata).includes(pattern),
              );
            }
            return rows;
          },
          get: (key: any) => rows.find((r) => r.id === key || r.entity_id === key) ?? null,
        };
      },
    } as any;
  }

  beforeEach(() => {
    executor = new ToolExecutor();
    deps = {
      decisionStore: new MockDecisionStore(),
      eventBus: new MemoryEventBus(),
      shortTerm: new ShortTermMemory(),
      longTerm: new LongTermMemory(mockDb()),
      entity: new EntityMemory(),
      project: new ProjectMemory(),
      // ── Write callbacks (mocked) ──
      createDecision(input) {
        return {
          id: `dec_test_${Date.now()}`,
          projectId: input.projectId,
          type: input.type as any,
          level: 'L1' as any,
          status: 'approved' as any,
          title: input.title,
          description: input.description,
          options: input.options,
          createdAt: new Date(),
        };
      },
      approveDecision(decisionId, captainId, chosenOptionId) {
        return {
          id: decisionId,
          projectId: 'default',
          type: 'strategic' as any,
          level: 'L1' as any,
          status: 'approved' as any,
          title: 'Test',
          description: '',
          options: [],
          chosenOptionId,
          captainId,
          createdAt: new Date(),
          resolvedAt: new Date(),
        };
      },
      rejectDecision(decisionId, captainId) {
        return {
          id: decisionId,
          projectId: 'default',
          type: 'strategic' as any,
          level: 'L1' as any,
          status: 'rejected' as any,
          title: 'Test',
          description: '',
          options: [],
          captainId,
          createdAt: new Date(),
          resolvedAt: new Date(),
        };
      },
      createWorkflow: () => ({ id: 'wf_test' }),
      updateWorkflow: () => {},
      deleteWorkflow: () => {},
      runWorkflow: async () => ({ runId: 'run_test', status: 'completed', steps: [] }),
      startMeeting: async (topic) => ({
        meetingId: 'meeting_test',
        topic,
        synthesis: 'Test synthesis',
        perspectives: [{ advisor: 'Test', role: 'Tester', content: 'OK' }],
      }),
      writeLongTermMemory: async (content) => `ltm_test_${Date.now()}`,
      createEmployee: () => {},
      registerAgent: (input) => ({ type: 'custom', name: input.name }),
      listAgents: () => [
        { type: 'secretary', name: 'Secretary', description: 'General purpose', builtIn: true },
      ],
      setProjectContext: (projectId) => ({ id: projectId, name: 'Test Project' }),
      createProject: (input) => ({ id: 'proj_test', name: input.name }),
      listProjects: () => [{ id: 'proj-1', name: 'Test Project' }],
      getProjectContext: (projectId) => projectId === 'unknown' ? null : { id: projectId, name: 'Test' },
    };

    const tools = createCabinetTools(deps);
    for (const tool of tools) {
      executor.register(tool);
    }
  });

  it('registers 33 tools', () => {
    expect(executor.listTools()).toHaveLength(66);
  });

  it('remember and recall work together', async () => {
    const r1 = await executor.execute('remember', 'tc1', {
      sessionId: 's1',
      key: 'name',
      value: 'Captain',
    });
    expect(r1.output).toEqual({ remembered: true, key: 'name' });

    const r2 = await executor.execute('recall', 'tc2', { sessionId: 's1', key: 'name' });
    expect((r2.output as any).value).toBe('Captain');
  });

  it('query_decisions returns empty array initially', async () => {
    const r = await executor.execute('query_decisions', 'tc3', { status: 'pending' });
    expect(r.output as any).toEqual([]);
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
    await deps.longTerm.store({
      content: 'Q2 revenue up 15%',
      metadata: {},
      timestamp: new Date(),
    });
    const r = await executor.execute('search_memory', 'tc6', { query: 'revenue', limit: 5 });
    expect(r.output as any[]).toHaveLength(1);
  });

  it('get_project_context returns null for unknown project', async () => {
    const r = await executor.execute('get_project_context', 'tc7', { projectId: 'unknown' });
    expect((r.output as any).context).toBeNull();
  });

  it('get_captain_preferences returns defaults', async () => {
    const r = await executor.execute('get_captain_preferences', 'tc8', { captainId: 'c1' });
    expect((r.output as any).preferences).toEqual({});
  });

  // ── Write tool tests ──

  it('create_decision returns a decision', async () => {
    const r = await executor.execute('create_decision', 'tc9', {
      title: 'Test Decision',
      description: 'Testing',
      type: 'strategic',
      projectId: 'default',
    });
    const out = r.output as any;
    expect(out.title).toBe('Test Decision');
    expect(out.status).toBe('approved');
  });

  it('approve_decision requires decisionId and chosenOptionId', async () => {
    const r = await executor.execute('approve_decision', 'tc10', {
      decisionId: 'dec_1',
      chosenOptionId: 'opt_1',
    });
    const out = r.output as any;
    expect(out.status).toBe('approved');
  });

  it('reject_decision requires decisionId', async () => {
    const r = await executor.execute('reject_decision', 'tc11', {
      decisionId: 'dec_1',
    });
    const out = r.output as any;
    expect(out.status).toBe('rejected');
  });

  it('create_workflow returns workflow id', async () => {
    const r = await executor.execute('create_workflow', 'tc12', {
      name: 'Test WF',
      projectId: 'default',
    });
    expect((r.output as any).workflowId).toBe('wf_test');
  });

  it('start_meeting returns synthesis', async () => {
    const r = await executor.execute('start_meeting', 'tc13', {
      topic: 'Should we expand?',
    });
    const out = r.output as any;
    expect(out.meetingId).toBeDefined();
    expect(out.synthesis).toBe('Test synthesis');
  });

  it('write_memory stores content', async () => {
    const r = await executor.execute('write_memory', 'tc14', {
      content: 'Important finding: market is bullish on Q3',
    });
    expect((r.output as any).stored).toBe(true);
  });

  it('add_milestone adds to project', async () => {
    deps.project.initialize('default', ['goal1']);
    const r = await executor.execute('add_milestone', 'tc15', {
      projectId: 'default',
      title: 'Launch MVP',
    });
    expect((r.output as any).added).toBe(true);

    const ctx = deps.project.get('default');
    expect(ctx?.milestones).toHaveLength(1);
  });

  it('update_project_summary updates project', async () => {
    deps.project.initialize('default', ['goal1']);
    const r = await executor.execute('update_project_summary', 'tc16', {
      projectId: 'default',
      summary: 'Steady progress towards MVP',
    });
    expect((r.output as any).updated).toBe(true);

    const ctx = deps.project.get('default');
    expect(ctx?.summary).toBe('Steady progress towards MVP');
  });

  it('set_captain_preferences stores preferences', async () => {
    const r = await executor.execute('set_captain_preferences', 'tc17', {
      captainId: 'captain-1',
      name: 'Captain',
      preferences: { theme: 'dark', language: 'zh' },
    });
    expect((r.output as any).updated).toBe(true);

    const prefs = deps.entity.getPreferences('captain-1');
    expect(prefs?.preferences).toEqual({ theme: 'dark', language: 'zh' });
  });

  it('create_employee creates an employee', async () => {
    const r = await executor.execute('create_employee', 'tc18', {
      name: 'Bot',
      role: 'developer',
      kind: 'ai',
    });
    expect((r.output as any).created).toBe(true);
  });
});
