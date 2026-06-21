import { Handle, Position, NodeToolbar, type NodeProps } from '@xyflow/react';

export function MergeNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown> | undefined;
  const title = String((d as any)?.title ?? '');
  const strategy = String((d as any)?.mergeStrategy ?? 'object');
  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top}>
        <span className="bg-surface-overlay border-border text-intent-purple rounded-sm border px-2 py-0.5 text-[10px] shadow-md">
          Merge
        </span>
      </NodeToolbar>
      <div
        className={`wf-border-purple-35 wf-bg-purple-15 min-w-[140px] overflow-hidden rounded-xl border-2 shadow-xs transition-shadow ${selected ? 'wf-ring-purple-50 shadow-md ring-2' : ''}`}
      >
        <div className="wf-bg-purple-35 flex items-center gap-1.5 px-3 py-1.5">
          <span className="text-content-primary text-sm">∪</span>
          <span className="text-content-primary text-xs font-semibold">Merge</span>
        </div>
        <div className="px-3 py-2">
          <p className="text-content-primary text-xs font-medium">{title}</p>
          <p className="text-content-tertiary mt-0.5 text-[11px]">{strategy}</p>
        </div>
        <Handle
          type="target"
          position={Position.Left}
          id="in-1"
          className="!bg-intent-purple !border-surface-primary !h-3 !w-3 !border-2"
        />
        <Handle
          type="target"
          position={Position.Top}
          id="in-2"
          className="!bg-intent-purple !border-surface-primary !h-3 !w-3 !border-2"
        />
        <Handle
          type="target"
          position={Position.Right}
          id="in-3"
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
