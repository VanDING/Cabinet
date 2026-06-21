import { WorkflowRepository, type Database } from '@cabinet/storage';
import type { WorkflowNodeType } from '@cabinet/types';
import type { WorkflowRun, WorkflowRunStatus } from './engine.js';

export class WorkflowPersistence {
  private repo: WorkflowRepository | null = null;

  setDb(db: Database): void {
    this.repo = new WorkflowRepository(db);
  }

  appendStepAndResult(run: WorkflowRun, nodeId: string, nodeType: string, output: string): void {
    if (!this.repo) return;
    try {
      this.repo.appendStep(run.runId, nodeId, nodeType, output);
      this.repo.appendResult(run.runId, nodeId, output);
    } catch (err) {
      console.error('[WorkflowEngine] Failed to persist step:', (err as Error).message);
    }
  }

  saveRun(run: WorkflowRun): void {
    if (!this.repo) return;
    try {
      const results: Record<string, unknown> = {};
      for (const [k, v] of run.results) results[k] = v;
      this.repo.saveRun({
        run_id: run.runId,
        workflow_id: run.workflowId,
        status: run.status,
        current_node_id: run.currentNodeId,
        steps: JSON.stringify(run.steps),
        results: JSON.stringify(results),
        started_at: run.startedAt.toISOString(),
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[WorkflowEngine] Failed to persist run:', (err as Error).message);
    }
  }

  loadRun(runId: string): WorkflowRun | null {
    if (!this.repo) return null;
    try {
      const row = this.repo.findRunById(runId);
      if (!row) return null;
      const results = new Map<string, unknown>(Object.entries(JSON.parse(row.results ?? '{}')));
      const incSteps = this.repo.findStepsByRunId(runId);
      const incResults = this.repo.findResultsByRunId(runId);
      const steps =
        incSteps.length > 0
          ? incSteps.map((s) => ({
              nodeId: s.nodeId,
              type: s.type as WorkflowNodeType,
              output: s.output,
            }))
          : JSON.parse(row.steps ?? '[]');
      for (const [k, v] of Object.entries(incResults)) results.set(k, v);
      return {
        runId: row.run_id,
        workflowId: row.workflow_id,
        status: row.status as WorkflowRunStatus,
        currentNodeId: row.current_node_id ?? '',
        results,
        steps,
        startedAt: new Date(row.started_at),
      };
    } catch {
      return null;
    }
  }
}
