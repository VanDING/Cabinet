import { Handle, Position, NodeToolbar, type NodeProps } from '@xyflow/react';

export function WorkflowNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown> | undefined;
  const wfId = String(d?.workflowId ?? d?.title ?? 'Sub-workflow');
  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top}>
        <span className="bg-surface-overlay border-border text-intent-purple rounded-sm border px-2 py-0.5 text-[10px] shadow-md">
          Workflow
        </span>
      </NodeToolbar>
      <div
        className={`min-w-[170px] overflow-hidden rounded-xl border-2 shadow-xs transition-shadow ${selected ? 'wf-ring-purple-50 shadow-md ring-2' : ''} wf-border-purple-35 wf-bg-purple-15 border-dashed`}
      >
        <div className="wf-bg-purple-35 flex items-center gap-1.5 px-3 py-1.5">
          <span className="text-sm">⊞</span>
          <span className="text-content-primary text-xs font-semibold">Workflow</span>
        </div>
        <div className="px-3 py-2">
          <p className="text-content-primary truncate text-xs font-medium">{wfId}</p>
          {(d as any)?.inputMapping && (
            <p className="text-content-tertiary mt-0.5 text-[11px]">
              ↳ {Object.keys((d as any)?.inputMapping as object).length} inputs
            </p>
          )}
        </div>
        <Handle
          type="target"
          position={Position.Top}
          className="!bg-intent-purple !border-surface-primary !h-3 !w-3 !border-2"
        />
        <Handle
          type="source"
          position={Position.Bottom}
          className="!bg-intent-purple !border-surface-primary !h-3 !w-3 !border-2"
        />
      </div>
    </>
  );
}
