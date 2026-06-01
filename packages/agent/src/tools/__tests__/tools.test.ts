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
  listAll(_opts?: { limit?: number }): Decision[] {
    return [...this.decisions.values()];
  }
  listAllPending(_opts?: { limit?: number }): Decision[] {
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
        // For UPDATE
        if (sql.startsWith('UPDATE')) {
          return {
            run: (...args: any[]) => {
              // UPDATE memory_embeddings SET metadata = ? WHERE id = ?
              const id = args[args.length - 1];
              const r = rows.find((row) => row.id === id);
              if (r && sql.includes('metadata')) {
                r.metadata = args[0];
              }
              return { changes: r ? 1 : 0 };
            },
          };
        }
        // For SELECT COUNT(*)
        if (sql.includes('COUNT(*)')) {
          return {
            get: () => ({ count: rows.length }),
            all: () => [{ count: rows.length }],
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
        // For SELECT ... WHERE id IN (...)
        if (sql.includes('id IN')) {
          return {
            all: (...args: any[]) => rows.filter((r) => args.includes(r.id)),
            get: () => null,
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
      getProjectContext: (projectId) =>
        projectId === 'unknown' ? null : { id: projectId, name: 'Test' },
      getDashboardStats: () => ({
        pendingDecisions: 3,
        activeWorkflows: 2,
        activeProjects: 1,
        todayCost: 0.42,
        totalLLMCalls: 100,
        totalTokens: 50000,
        totalDecisions: 25,
        errors: 1,
        recentEvents: [{ message: 'Event A', time: '2026-05-27T10:00:00Z' }],
      }),
      getDecisionAudit: (decisionId) => [
        {
          action: 'create',
          actor: 'system',
          changes: { title: 'Test Decision' },
          timestamp: '2026-05-27T10:00:00Z',
        },
        {
          action: 'approve',
          actor: 'captain_1',
          changes: { status: 'approved' },
          timestamp: '2026-05-27T10:05:00Z',
        },
      ],
      getSystemMetrics: () => ({
        totalLLMCalls: 42,
        totalTokens: 2100,
        totalDecisions: 7,
        errors: 0,
      }),
      delegateTask: (name) => `task_${name}_test`,
      getTaskStatus: (taskId) => ({
        id: taskId,
        name: 'Test Task',
        status: 'running',
        startTime: Date.now(),
      }),
      listActiveTasks: () => [{ id: 'task_1', name: 'Task One', status: 'running' }],
      getWorkflowRun: (runId) => ({
        runId,
        workflowId: 'wf_test',
        status: 'completed',
        steps: [{ nodeId: 'n1', type: 'start', output: 'started' }],
        startedAt: '2026-05-27T10:00:00Z',
        updatedAt: '2026-05-27T10:05:00Z',
      }),
      listWorkflowRuns: (workflowId) => [
        {
          runId: 'run_1',
          workflowId,
          status: 'completed',
          startedAt: '2026-05-27T10:00:00Z',
          updatedAt: '2026-05-27T10:05:00Z',
        },
        {
          runId: 'run_2',
          workflowId,
          status: 'failed',
          startedAt: '2026-05-27T11:00:00Z',
          updatedAt: '2026-05-27T11:02:00Z',
        },
      ],
    };

    const tools = createCabinetTools(deps);
    for (const tool of tools) {
      executor.register(tool);
    }
  });

  it('registers all built-in tools', () => {
    expect(executor.listTools().length).toBeGreaterThanOrEqual(76);
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
    const out = r.output as any;
    expect(out.status).toBe('operational');
    expect(out.toolsAvailable).toBe(42);
    expect(out.metrics).toEqual({
      totalLLMCalls: 42,
      totalTokens: 2100,
      totalDecisions: 7,
      errors: 0,
    });
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

  it('delegate_task returns task id', async () => {
    const r = await executor.execute('delegate_task', 'tc_delegate', { name: 'Analyze data' });
    expect((r.output as any).taskId).toBe('task_Analyze data_test');
  });

  it('get_task_status returns task info', async () => {
    const r = await executor.execute('get_task_status', 'tc_status', { taskId: 'task_123' });
    const out = r.output as any;
    expect(out.id).toBe('task_123');
    expect(out.name).toBe('Test Task');
    expect(out.status).toBe('running');
    expect(out.startTime).toBeDefined();
  });

  it('list_active_tasks returns active tasks', async () => {
    const r = await executor.execute('list_active_tasks', 'tc_list', {});
    const out = r.output as any;
    expect(Array.isArray(out.tasks)).toBe(true);
    expect(out.tasks).toHaveLength(1);
    expect(out.tasks[0].id).toBe('task_1');
    expect(out.tasks[0].name).toBe('Task One');
    expect(out.tasks[0].status).toBe('running');
  });

  it('get_workflow_run returns run details', async () => {
    const r = await executor.execute('get_workflow_run', 'tc_wfrun', { runId: 'run_123' });
    const out = r.output as any;
    expect(out.runId).toBe('run_123');
    expect(out.workflowId).toBe('wf_test');
    expect(out.status).toBe('completed');
    expect(Array.isArray(out.steps)).toBe(true);
    expect(out.steps).toHaveLength(1);
    expect(out.startedAt).toBe('2026-05-27T10:00:00Z');
    expect(out.updatedAt).toBe('2026-05-27T10:05:00Z');
  });

  it('list_workflow_runs returns runs for workflow', async () => {
    const r = await executor.execute('list_workflow_runs', 'tc_wfruns', { workflowId: 'wf_abc' });
    const out = r.output as any;
    expect(Array.isArray(out.runs)).toBe(true);
    expect(out.runs).toHaveLength(2);
    expect(out.runs[0].runId).toBe('run_1');
    expect(out.runs[0].status).toBe('completed');
    expect(out.runs[1].runId).toBe('run_2');
    expect(out.runs[1].status).toBe('failed');
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

  it('get_dashboard_stats returns dashboard data', async () => {
    const r = await executor.execute('get_dashboard_stats', 'tc19', {});
    const out = r.output as any;
    expect(out.pendingDecisions).toBe(3);
    expect(out.activeWorkflows).toBe(2);
    expect(out.activeProjects).toBe(1);
    expect(out.todayCost).toBe(0.42);
    expect(out.totalLLMCalls).toBe(100);
    expect(out.totalTokens).toBe(50000);
    expect(out.totalDecisions).toBe(25);
    expect(out.errors).toBe(1);
    expect(out.recentEvents).toHaveLength(1);
    expect(out.recentEvents[0].message).toBe('Event A');
  });

  it('get_decision_audit returns audit entries', async () => {
    const r = await executor.execute('get_decision_audit', 'tc_audit', { decisionId: 'dec_123' });
    const out = r.output as any;
    expect(out.decisionId).toBe('dec_123');
    expect(Array.isArray(out.entries)).toBe(true);
    expect(out.entries).toHaveLength(2);
    expect(out.entries[0].action).toBe('create');
    expect(out.entries[0].actor).toBe('system');
    expect(out.entries[0].changes).toEqual({ title: 'Test Decision' });
    expect(out.entries[0].timestamp).toBe('2026-05-27T10:00:00Z');
    expect(out.entries[1].action).toBe('approve');
    expect(out.entries[1].actor).toBe('captain_1');
    expect(out.entries[1].changes).toEqual({ status: 'approved' });
    expect(out.entries[1].timestamp).toBe('2026-05-27T10:05:00Z');
  });

  it('update_memory updates memory metadata', async () => {
    const id = await deps.longTerm.store({
      content: 'Test memory',
      metadata: {},
      timestamp: new Date(),
    });
    const r = await executor.execute('update_memory', 'tc_update_mem', {
      memoryId: id,
      status: 'archived',
      importance: 5,
      confidence: 0.9,
    });
    expect((r.output as any).updated).toBe(true);
    expect((r.output as any).memoryId).toBe(id);
  });

  it('delete_memory removes memory', async () => {
    const id = await deps.longTerm.store({
      content: 'Test memory to delete',
      metadata: {},
      timestamp: new Date(),
    });
    const r = await executor.execute('delete_memory', 'tc_delete_mem', { memoryId: id });
    expect((r.output as any).deleted).toBe(true);
    expect((r.output as any).memoryId).toBe(id);
  });
});
