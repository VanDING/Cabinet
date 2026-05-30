import { Handle, Position, NodeToolbar, type NodeProps } from '@xyflow/react';

export function IfElseNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown> | undefined;
  const title = String((d as any)?.title ?? '');
  const branches = (d as any)?.branches as Array<{label: string}> | undefined;
  const count = branches?.length ?? 0;
  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top}>
        <span className="rounded bg-surface-overlay border border-border shadow-md px-2 py-0.5 text-[10px] text-intent-warning">If-Else</span>
      </NodeToolbar>
      <div
        className={`relative flex flex-col items-center justify-center min-w-[160px] h-[85px] shadow-sm transition-shadow wf-border-warning-40 wf-bg-warning-15 ${selected ? 'shadow-md' : ''}`}
        style={{
          clipPath: 'polygon(50% 0%, 95% 50%, 50% 100%, 5% 50%)',
          border: 'none',
          outline: selected ? '2px solid color-mix(in srgb, var(--intent-warning) 40%, transparent)' : '2px solid color-mix(in srgb, var(--intent-warning) 30%, transparent)',
        }}
      >
        <span className="text-sm text-content-primary">{'<>'}</span>
        <span className="text-xs font-semibold text-content-primary mt-0.5">{title || 'If-Else'}</span>
        {count > 0 ? <span className="text-[10px] text-intent-warning">{count} branches</span> : null}
        <Handle type="target" position={Position.Top} className="!bg-intent-warning !border-2 !border-surface-primary !w-3 !h-3" />
        <Handle type="source" position={Position.Bottom} id="true" className="!bg-intent-success !border-2 !border-surface-primary !w-3 !h-3" />
        <Handle type="source" position={Position.Right} id="false" className="!bg-intent-danger !border-2 !border-surface-primary !w-3 !h-3" />
      </div>
    </>
  );
}
