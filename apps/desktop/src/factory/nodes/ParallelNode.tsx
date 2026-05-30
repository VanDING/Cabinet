import { Handle, Position, NodeToolbar, type NodeProps } from '@xyflow/react';

export function ParallelNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown> | undefined;
  const title = String((d as any)?.title ?? '');
  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top}>
        <span className="rounded bg-surface-overlay border border-border shadow-md px-2 py-0.5 text-[10px] text-intent-info">Parallel</span>
      </NodeToolbar>
      <div className={`rounded-xl border-2 min-w-[150px] overflow-hidden shadow-sm transition-shadow wf-border-info-40 wf-bg-info-15 ${selected ? 'shadow-md ring-2 wf-ring-info-50' : ''}`}>
        <div className="flex items-center gap-1.5 wf-bg-info-35 px-3 py-1.5">
          <span className="text-sm text-content-primary">≣</span>
          <span className="text-xs font-semibold text-content-primary">Parallel</span>
        </div>
        <div className="px-3 py-2">
          <p className="text-xs font-medium text-content-primary">{title}</p>
          <div className="mt-1.5 flex gap-1">
            <div className="h-1.5 flex-1 rounded-sm wf-bg-info-35" />
            <div className="h-1.5 flex-1 rounded-sm wf-bg-info-30" />
            <div className="h-1.5 flex-1 rounded-sm wf-bg-info-35" />
          </div>
        </div>
        <Handle type="target" position={Position.Top} className="!bg-intent-info !border-2 !border-surface-primary !w-3 !h-3" />
        <Handle type="source" position={Position.Bottom} className="!bg-intent-info !border-2 !border-surface-primary !w-3 !h-3" />
      </div>
    </>
  );
}
