import { Handle, Position, NodeToolbar, type NodeProps } from '@xyflow/react';

export function WorkflowNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown> | undefined;
  const wfId = String(d?.workflowId ?? d?.title ?? 'Sub-workflow');
  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top}>
        <span className="rounded bg-surface-overlay border border-border shadow-md px-2 py-0.5 text-[10px] text-intent-purple">Workflow</span>
      </NodeToolbar>
      <div
        className={`rounded-xl border-2 min-w-[170px] overflow-hidden shadow-sm transition-shadow
          ${selected ? 'shadow-md ring-2 wf-ring-purple-40' : ''}
          wf-border-purple-30 wf-bg-purple-5 border-dashed`}
      >
        <div className="flex items-center gap-1.5 wf-bg-purple-20 px-3 py-1.5">
          <span className="text-sm">⊞</span>
          <span className="text-xs font-semibold text-intent-purple-foreground">Workflow</span>
        </div>
        <div className="px-3 py-2">
          <p className="text-xs font-medium text-content-primary truncate">{wfId}</p>
          {(d as any)?.inputMapping && (
            <p className="mt-0.5 text-[11px] text-content-tertiary">
              ↳ {Object.keys((d as any)?.inputMapping as object).length} inputs
            </p>
          )}
        </div>
        <Handle type="target" position={Position.Top} className="!bg-intent-purple !border-2 !border-surface-primary !w-3 !h-3" />
        <Handle type="source" position={Position.Bottom} className="!bg-intent-purple !border-2 !border-surface-primary !w-3 !h-3" />
      </div>
    </>
  );
}
