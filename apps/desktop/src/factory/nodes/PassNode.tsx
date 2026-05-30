import { Handle, Position, NodeToolbar, type NodeProps } from '@xyflow/react';

export function PassNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown> | undefined;
  const title = String((d as any)?.title ?? '');
  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top}>
        <span className="rounded bg-surface-overlay border border-border shadow-md px-2 py-0.5 text-[10px] text-content-secondary">Pass</span>
      </NodeToolbar>
      <div className={`rounded-xl border-2 min-w-[130px] overflow-hidden shadow-sm transition-shadow border-border wf-bg-surface-10 ${selected ? 'shadow-md ring-2 ring-border/40' : ''}`}>
        <div className="flex items-center gap-1.5 wf-bg-surface-30 px-3 py-1.5">
          <span className="text-sm text-content-secondary">→</span>
          <span className="text-xs font-semibold text-content-secondary">Pass</span>
        </div>
        <div className="px-3 py-2">
          <p className="text-xs font-medium text-content-primary">{title}</p>
        </div>
        <Handle type="target" position={Position.Left} id="in-1" className="!bg-content-secondary !border-2 !border-surface-primary !w-3 !h-3" />
        <Handle type="target" position={Position.Top} id="in-2" className="!bg-content-secondary !border-2 !border-surface-primary !w-3 !h-3" />
        <Handle type="source" position={Position.Bottom} className="!bg-content-secondary !border-2 !border-surface-primary !w-3 !h-3" />
      </div>
    </>
  );
}
