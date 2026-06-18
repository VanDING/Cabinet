import { getServerContext } from '../../context.js';
import { getEngine } from './engine.js';
import { normalizeDefinition, findEntryNode } from './normalize.js';

// ── Workflow resumption (called by decision callback) ──
export async function resumeWorkflowAfterApproval(workflowId: string): Promise<void> {
  const { workflowRepo, auditLogRepo, logger } = getServerContext();

  const wf = workflowRepo.findById(workflowId);
  if (!wf) throw new Error(`Workflow not found: ${workflowId}`);

  const def = JSON.parse(wf.definition ?? '{}');
  const { nodes, edges } = normalizeDefinition(def);

  const approvalNode = nodes.find(
    (n) => n.type === 'approval' || (n.type as string) === 'humanApproval',
  );
  if (!approvalNode) {
    logger.warn('No approval node found for resume', { workflowId });
    return;
  }

  // Find the latest incomplete run for this workflow to resume
  const incompleteRuns = workflowRepo
    .findRunsByWorkflow(workflowId)
    .filter(
      (r) => r.status === 'awaiting_approval' || r.status === 'paused' || r.status === 'running',
    )
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  const latestRun = incompleteRuns[0];
  if (!latestRun) {
    logger.warn('No incomplete run found for resume', { workflowId });
    return;
  }

  const eng = getEngine();
  const run = await eng.continueRun(latestRun.run_id, nodes, edges);

  const finalStatus: string =
    run.status === 'awaiting_approval' ? 'awaiting_approval' : 'completed';
  workflowRepo.updateStatus(workflowId, finalStatus);
  auditLogRepo.insert('workflow', workflowId, 'resume', 'system', {
    status: finalStatus,
    steps: run.steps,
    runId: run.runId,
  });

  logger.info('Workflow resumed after approval', {
    workflowId,
    nodes: run.steps.length,
    status: finalStatus,
  });
}

// ── Approval polling (fallback when WebSocket event is missed) ──

let approvalPollTimer: ReturnType<typeof setInterval> | null = null;

export function startApprovalPolling(intervalMs: number = 30_000): void {
  if (approvalPollTimer) return; // already running

  approvalPollTimer = setInterval(async () => {
    try {
      const { workflowRepo, auditLogRepo, decisionRepo, db, logger } = getServerContext();

      // Find workflows stuck in awaiting_approval state
      const runs = workflowRepo.findRunsByStatus(['awaiting_approval']);

      for (const runRow of runs) {
        const wfId = runRow.workflow_id;
        // Check if there's a pending approval record for this workflow
        const approvalRow = db
          .prepare(
            "SELECT * FROM audit_log WHERE entity_type = 'workflow_approval' AND action = 'pending' AND json_extract(changes, '$.workflowId') = ? ORDER BY timestamp DESC LIMIT 1",
          )
          .get(wfId) as any;

        if (!approvalRow) continue;

        const changes = JSON.parse(approvalRow.changes ?? '{}');
        const decisionId = changes.decisionId as string | undefined;
        if (!decisionId) continue;

        // Check if the associated decision has been resolved
        const decision = decisionRepo.get(decisionId);

        if (decision && (decision.status === 'approved' || decision.status === 'rejected')) {
          logger.info('Workflow approval resolved via polling', {
            workflowId: wfId,
            decisionId,
            status: decision.status,
          });
          try {
            if (decision.status === 'approved') {
              await resumeWorkflowAfterApproval(wfId);
            } else {
              // Rejected — mark workflow as failed
              workflowRepo.updateStatus(wfId, 'failed');
              workflowRepo.failAwaitingRuns(wfId);
            }
            // Mark approval as resolved
            auditLogRepo.insert('workflow_approval', approvalRow.entity_id, 'resolved', 'system', {
              workflowId: wfId,
              status: 'resolved',
            });
          } catch (err) {
            logger.error('Failed to resume workflow after approval', {
              workflowId: wfId,
              error: (err as Error).message,
            });
          }
        }
      }
    } catch (err) {
      // Non-fatal — polling continues on next interval
    }
  }, intervalMs);
}

export function stopApprovalPolling(): void {
  if (approvalPollTimer) {
    clearInterval(approvalPollTimer);
    approvalPollTimer = null;
  }
}
