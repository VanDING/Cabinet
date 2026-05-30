import { Handle, Position, NodeToolbar, type NodeProps } from '@xyflow/react';

export function MergeNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown> | undefined;
  const title = String((d as any)?.title ?? '');
  const strategy = String((d as any)?.mergeStrategy ?? 'object');
  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top}>
        <span className="rounded-sm bg-surface-overlay border border-border shadow-md px-2 py-0.5 text-[10px] text-intent-purple">Merge</span>
      </NodeToolbar>
      <div className={`rounded-xl border-2 min-w-[140px] overflow-hidden shadow-xs transition-shadow wf-border-purple-35 wf-bg-purple-15 ${selected ? 'shadow-md ring-2 wf-ring-purple-50' : ''}`}>
        <div className="flex items-center gap-1.5 wf-bg-purple-35 px-3 py-1.5">
          <span className="text-sm text-content-primary">∪</span>
          <span className="text-xs font-semibold text-content-primary">Merge</span>
        </div>
        <div className="px-3 py-2">
          <p className="text-xs font-medium text-content-primary">{title}</p>
          <p className="mt-0.5 text-[11px] text-content-tertiary">{strategy}</p>
        </div>
        <Handle type="target" position={Position.Left} id="in-1" className="!bg-intent-purple !border-2 !border-surface-primary !w-3 !h-3" />
        <Handle type="target" position={Position.Top} id="in-2" className="!bg-intent-purple !border-2 !border-surface-primary !w-3 !h-3" />
        <Handle type="target" position={Position.Right} id="in-3" className="!bg-intent-purple !border-2 !border-surface-primary !w-3 !h-3" />
        <Handle type="source" position={Position.Bottom} className="!bg-intent-purple !border-2 !border-surface-primary !w-3 !h-3" />
      </div>
    </>
  );
}
