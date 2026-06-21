import { Handle, Position, NodeToolbar, type NodeProps } from '@xyflow/react';

export function CodeNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown> | undefined;
  const title = String((d as any)?.title ?? 'Code');
  const code = String((d as any)?.code ?? '');
  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top}>
        <span className="bg-surface-overlay border-border text-intent-info rounded-sm border px-2 py-0.5 text-[10px] shadow-md">
          Code
        </span>
      </NodeToolbar>
      <div
        className={`wf-border-info-40 wf-bg-info-15 max-w-[200px] min-w-[130px] rounded-md border px-3 py-2 shadow-xs transition-shadow ${selected ? 'wf-ring-info-50 shadow-md ring-2' : ''}`}
      >
        <div className="flex items-center gap-1.5">
          <span className="text-content-primary text-xs font-semibold">{'<>'}</span>
          <span className="text-content-primary truncate text-xs font-medium">{title}</span>
        </div>
        {code ? (
          <p className="wf-bg-info-25 text-content-tertiary mt-1 truncate rounded-sm px-1.5 py-0.5 font-mono text-[10px]">
            {code.slice(0, 50)}
            {code.length > 50 ? '...' : ''}
          </p>
        ) : null}
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
