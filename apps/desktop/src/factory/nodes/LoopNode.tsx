import { Handle, Position, NodeToolbar, type NodeProps } from '@xyflow/react';

export function LoopNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown> | undefined;
  const title = String((d as any)?.title ?? '');
  const loopLabel = (d as any)?.loopType === 'count' ? `x${(d as any)?.loopCount ?? '?'}` : '?';
  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top}>
        <span className="rounded-sm bg-surface-overlay border border-border shadow-md px-2 py-0.5 text-[10px] text-intent-info">Loop</span>
      </NodeToolbar>
      <div
        className={`rounded-xl border-2 min-w-[160px] overflow-hidden shadow-xs transition-shadow wf-border-info-40 wf-bg-info-15 ${selected ? 'shadow-md ring-2 wf-ring-info-50' : ''}`}
        style={{ borderLeft: '3px solid var(--intent-info)' }}
      >
        <div className="flex items-center gap-1.5 px-3 py-1.5">
          <span className="text-sm text-content-primary">{'~'}</span>
          <span className="text-xs font-semibold text-content-primary">{title || 'Loop'}</span>
          <span className="ml-auto rounded-full wf-bg-info-35 px-1.5 text-[10px] text-intent-info font-medium">{loopLabel}</span>
        </div>
        <Handle type="target" position={Position.Top} className="!bg-intent-info !border-2 !border-surface-primary !w-3 !h-3" />
        <Handle type="source" position={Position.Bottom} className="!bg-intent-info !border-2 !border-surface-primary !w-3 !h-3" />
      </div>
    </>
  );
}
