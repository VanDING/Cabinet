import { Handle, Position, NodeToolbar, type NodeProps } from '@xyflow/react';

export function PassNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown> | undefined;
  const title = String((d as any)?.title ?? '');
  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top}>
        <span className="bg-surface-overlay border-border text-content-secondary rounded-sm border px-2 py-0.5 text-[10px] shadow-md">
          Pass
        </span>
      </NodeToolbar>
      <div
        className={`border-border wf-bg-surface-25 min-w-[130px] overflow-hidden rounded-xl border-2 shadow-xs transition-shadow ${selected ? 'ring-border/40 shadow-md ring-2' : ''}`}
      >
        <div className="wf-bg-surface-35 flex items-center gap-1.5 px-3 py-1.5">
          <span className="text-content-secondary text-sm">→</span>
          <span className="text-content-secondary text-xs font-semibold">Pass</span>
        </div>
        <div className="px-3 py-2">
          <p className="text-content-primary text-xs font-medium">{title}</p>
        </div>
        <Handle
          type="target"
          position={Position.Left}
          id="in-1"
          className="!bg-content-secondary !border-surface-primary !h-3 !w-3 !border-2"
        />
        <Handle
          type="target"
          position={Position.Top}
          id="in-2"
          className="!bg-content-secondary !border-surface-primary !h-3 !w-3 !border-2"
        />
        <Handle
          type="source"
          position={Position.Bottom}
          className="!bg-content-secondary !border-surface-primary !h-3 !w-3 !border-2"
        />
      </div>
    </>
  );
}
