import { Handle, Position, NodeToolbar, type NodeProps } from '@xyflow/react';

export function ParallelNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown> | undefined;
  const title = String((d as any)?.title ?? '');
  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top}>
        <span className="bg-surface-overlay border-border text-intent-info rounded-sm border px-2 py-0.5 text-[10px] shadow-md">
          Parallel
        </span>
      </NodeToolbar>
      <div
        className={`wf-border-info-40 wf-bg-info-15 min-w-[150px] overflow-hidden rounded-xl border-2 shadow-xs transition-shadow ${selected ? 'wf-ring-info-50 shadow-md ring-2' : ''}`}
      >
        <div className="wf-bg-info-35 flex items-center gap-1.5 px-3 py-1.5">
          <span className="text-content-primary text-sm">≣</span>
          <span className="text-content-primary text-xs font-semibold">Parallel</span>
        </div>
        <div className="px-3 py-2">
          <p className="text-content-primary text-xs font-medium">{title}</p>
          <div className="mt-1.5 flex gap-1">
            <div className="wf-bg-info-35 h-1.5 flex-1 rounded-xs" />
            <div className="wf-bg-info-30 h-1.5 flex-1 rounded-xs" />
            <div className="wf-bg-info-35 h-1.5 flex-1 rounded-xs" />
          </div>
        </div>
        <Handle
          type="target"
          position={Position.Top}
          className="!bg-intent-info !border-surface-primary !h-3 !w-3 !border-2"
        />
        <Handle
          type="source"
          position={Position.Bottom}
          className="!bg-intent-info !border-surface-primary !h-3 !w-3 !border-2"
        />
      </div>
    </>
  );
}
