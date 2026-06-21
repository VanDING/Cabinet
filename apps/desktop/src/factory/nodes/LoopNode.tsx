import { Handle, Position, NodeToolbar, type NodeProps } from '@xyflow/react';

export function LoopNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown> | undefined;
  const title = String((d as any)?.title ?? '');
  const loopLabel = (d as any)?.loopType === 'count' ? `x${(d as any)?.loopCount ?? '?'}` : '?';
  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top}>
        <span className="bg-surface-overlay border-border text-intent-info rounded-sm border px-2 py-0.5 text-[10px] shadow-md">
          Loop
        </span>
      </NodeToolbar>
      <div
        className={`wf-border-info-40 wf-bg-info-15 min-w-[160px] overflow-hidden rounded-xl border-2 shadow-xs transition-shadow ${selected ? 'wf-ring-info-50 shadow-md ring-2' : ''}`}
        style={{ borderLeft: '3px solid var(--intent-info)' }}
      >
        <div className="flex items-center gap-1.5 px-3 py-1.5">
          <span className="text-content-primary text-sm">{'~'}</span>
          <span className="text-content-primary text-xs font-semibold">{title || 'Loop'}</span>
          <span className="wf-bg-info-35 text-intent-info ml-auto rounded-full px-1.5 text-[10px] font-medium">
            {loopLabel}
          </span>
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
