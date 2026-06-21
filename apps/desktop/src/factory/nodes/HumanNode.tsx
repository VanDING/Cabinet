import { Handle, Position, NodeToolbar, type NodeProps } from '@xyflow/react';

export function HumanNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown> | undefined;
  const title = String(d?.title ?? 'Human Task');
  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top}>
        <span className="bg-surface-overlay border-border text-intent-danger rounded-sm border px-2 py-0.5 text-[10px] shadow-md">
          Human
        </span>
      </NodeToolbar>
      <div
        className={`min-w-[160px] overflow-hidden rounded-xl border-2 shadow-xs transition-shadow ${selected ? 'wf-ring-danger-50 shadow-md ring-2' : ''} wf-border-danger-40 wf-bg-danger-15 border-dashed`}
      >
        <div className="wf-bg-danger-25 flex items-center gap-1.5 px-3 py-1.5">
          <span className="text-sm">⊚</span>
          <span className="text-content-primary text-xs font-semibold">Human</span>
          {d?.humanDeadline ? (
            <span className="text-content-tertiary ml-auto text-[10px]">◷</span>
          ) : null}
        </div>
        <div className="px-3 py-2">
          <p className="text-content-primary truncate text-xs font-medium">{title}</p>
          {(d as any)?.outputSchema ? (
            <p className="text-content-tertiary mt-0.5 text-[11px]">
              Schema: {Object.keys(((d as any)?.outputSchema as object) ?? {}).length} fields
            </p>
          ) : null}
        </div>
        <Handle
          type="target"
          position={Position.Top}
          className="!bg-intent-danger !border-surface-primary !h-3 !w-3 !border-2"
        />
        <Handle
          type="source"
          position={Position.Bottom}
          className="!bg-intent-danger !border-surface-primary !h-3 !w-3 !border-2"
        />
      </div>
    </>
  );
}
