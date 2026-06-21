import { Handle, Position, NodeToolbar, type NodeProps } from '@xyflow/react';

export function ToolNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown> | undefined;
  const name = String((d as any)?.toolId ?? (d as any)?.title ?? 'Tool');
  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top}>
        <span className="bg-surface-overlay border-border text-content-secondary rounded-sm border px-2 py-0.5 text-[10px] shadow-md">
          Tool
        </span>
      </NodeToolbar>
      <div
        className={`border-border wf-bg-surface-25 flex max-w-[180px] min-w-[120px] items-center gap-1.5 rounded-md border px-3 py-2 shadow-xs transition-shadow ${selected ? 'ring-border/40 shadow-md ring-2' : ''}`}
      >
        <span className="text-content-secondary text-sm">{'*'}</span>
        <span className="text-content-primary truncate font-mono text-xs font-medium">{name}</span>
        <Handle
          type="target"
          position={Position.Top}
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
