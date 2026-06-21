import { Handle, Position, NodeToolbar, type NodeProps } from '@xyflow/react';

export function IfElseNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown> | undefined;
  const title = String((d as any)?.title ?? '');
  const branches = (d as any)?.branches as Array<{ label: string }> | undefined;
  const count = branches?.length ?? 0;
  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top}>
        <span className="bg-surface-overlay border-border text-intent-warning rounded-sm border px-2 py-0.5 text-[10px] shadow-md">
          If-Else
        </span>
      </NodeToolbar>
      <div
        className={`wf-border-warning-40 wf-bg-warning-15 relative flex h-[85px] min-w-[160px] flex-col items-center justify-center shadow-xs transition-shadow ${selected ? 'shadow-md' : ''}`}
        style={{
          clipPath: 'polygon(50% 0%, 95% 50%, 50% 100%, 5% 50%)',
          border: 'none',
          outline: selected
            ? '2px solid color-mix(in srgb, var(--intent-warning) 40%, transparent)'
            : '2px solid color-mix(in srgb, var(--intent-warning) 30%, transparent)',
        }}
      >
        <span className="text-content-primary text-sm">{'<>'}</span>
        <span className="text-content-primary mt-0.5 text-xs font-semibold">
          {title || 'If-Else'}
        </span>
        {count > 0 ? (
          <span className="text-intent-warning text-[10px]">{count} branches</span>
        ) : null}
        <Handle
          type="target"
          position={Position.Top}
          className="!bg-intent-warning !border-surface-primary !h-3 !w-3 !border-2"
        />
        <Handle
          type="source"
          position={Position.Bottom}
          id="true"
          className="!bg-intent-success !border-surface-primary !h-3 !w-3 !border-2"
        />
        <Handle
          type="source"
          position={Position.Right}
          id="false"
          className="!bg-intent-danger !border-surface-primary !h-3 !w-3 !border-2"
        />
      </div>
    </>
  );
}
