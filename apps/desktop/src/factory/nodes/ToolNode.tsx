import { Handle, Position, NodeToolbar, type NodeProps } from '@xyflow/react';

export function ToolNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown> | undefined;
  const name = String((d as any)?.toolId ?? (d as any)?.title ?? 'Tool');
  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top}>
        <span className="rounded bg-surface-overlay border border-border shadow-md px-2 py-0.5 text-[10px] text-content-secondary">Tool</span>
      </NodeToolbar>
      <div className={`flex items-center gap-1.5 rounded-md border px-3 py-2 min-w-[120px] max-w-[180px] shadow-sm transition-shadow border-border wf-bg-surface-10 ${selected ? 'shadow-md ring-2 ring-border/40' : ''}`}>
        <span className="text-sm text-content-secondary">{'*'}</span>
        <span className="text-xs font-medium text-content-primary truncate font-mono">{name}</span>
        <Handle type="target" position={Position.Top} className="!bg-content-secondary !border-2 !border-surface-primary !w-3 !h-3" />
        <Handle type="source" position={Position.Bottom} className="!bg-content-secondary !border-2 !border-surface-primary !w-3 !h-3" />
      </div>
    </>
  );
}
