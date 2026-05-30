import { Handle, Position, NodeToolbar, type NodeProps } from '@xyflow/react';

export function CodeNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown> | undefined;
  const title = String((d as any)?.title ?? 'Code');
  const code = String((d as any)?.code ?? '');
  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top}>
        <span className="rounded-sm bg-surface-overlay border border-border shadow-md px-2 py-0.5 text-[10px] text-intent-info">Code</span>
      </NodeToolbar>
      <div className={`rounded-md border px-3 py-2 min-w-[130px] max-w-[200px] shadow-xs transition-shadow wf-border-info-40 wf-bg-info-15 ${selected ? 'shadow-md ring-2 wf-ring-info-50' : ''}`}>
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-content-primary">{'<>'}</span>
          <span className="text-xs font-medium text-content-primary truncate">{title}</span>
        </div>
        {code ? (
          <p className="mt-1 rounded-sm wf-bg-info-25 px-1.5 py-0.5 text-[10px] text-content-tertiary font-mono truncate">{code.slice(0, 50)}{code.length > 50 ? '...' : ''}</p>
        ) : null}
        <Handle type="target" position={Position.Top} className="!bg-intent-info !border-2 !border-surface-primary !w-3 !h-3" />
        <Handle type="source" position={Position.Bottom} className="!bg-intent-info !border-2 !border-surface-primary !w-3 !h-3" />
      </div>
    </>
  );
}
