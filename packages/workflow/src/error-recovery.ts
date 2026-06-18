import type { WorkflowNodeDef, WorkflowNodeType } from '@cabinet/types';
import type { WorkflowRun } from './engine.js';

/**
 * Error classification for retry decisions.
 * @deprecated Import from @cabinet/agent (canonical source). Kept locally to avoid
 * adding a dependency on @cabinet/agent from @cabinet/workflow.
 */
export function classifyError(error: Error): 'transient' | 'recoverable' | 'fatal' {
  const msg = error.message.toLowerCase();
  if (
    msg.includes('timeout') ||
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('socket') ||
    msg.includes('econnreset')
  ) {
    return 'transient';
  }
  if (
    msg.includes('temporarily') ||
    msg.includes('unavailable') ||
    msg.includes('busy') ||
    msg.includes('retry')
  ) {
    return 'recoverable';
  }
  return 'fatal';
}

/** Execute a node with automatic retry for transient errors (Level 1 of Error Strategy). */
export async function executeWithRetry(
  runNode: (
    node: WorkflowNodeDef,
    run: WorkflowRun,
    nodeMap: Map<string, WorkflowNodeDef>,
  ) => Promise<string>,
  node: WorkflowNodeDef,
  run: WorkflowRun,
  nodeMap: Map<string, WorkflowNodeDef>,
): Promise<string> {
  const maxRetries = 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await runNode(node, run, nodeMap);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const category = classifyError(lastError);

      if (category === 'fatal' || attempt >= maxRetries) {
        throw lastError;
      }

      const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError!;
}

/** Error-recovery result from attempting to execute a node. */
export interface RecoveryResult {
  status: 'success' | 'degraded' | 'failed';
  output?: string;
}

/** Execute a node with full error recovery: retry → continueOnFail → throw. */
export async function executeNodeWithRecovery(
  runNode: (
    node: WorkflowNodeDef,
    run: WorkflowRun,
    nodeMap: Map<string, WorkflowNodeDef>,
  ) => Promise<string>,
  node: WorkflowNodeDef,
  run: WorkflowRun,
  nodeMap: Map<string, WorkflowNodeDef>,
  saveRun: (run: WorkflowRun) => void,
  appendStepAndResult: (run: WorkflowRun, nodeId: string, nodeType: string, output: string) => void,
): Promise<RecoveryResult> {
  try {
    const output = await executeWithRetry(runNode, node, run, nodeMap);
    return { status: 'success', output };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (node.onError === 'continue') {
      const degradedOutput = `[DEGRADED] ${message}`;
      run.steps.push({
        nodeId: node.id,
        type: node.type,
        output: degradedOutput,
      });
      run.results.set(node.id, degradedOutput);
      run.currentNodeId = node.id;
      appendStepAndResult(run, node.id, node.type, degradedOutput);
      if (run.status !== 'failed') {
        run.status = 'completed_with_errors';
      }
      saveRun(run);
      return { status: 'degraded', output: degradedOutput };
    }

    throw err;
  }
}
