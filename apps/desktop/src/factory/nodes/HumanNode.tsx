import { Handle, Position, NodeToolbar, type NodeProps } from '@xyflow/react';

export function HumanNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown> | undefined;
  const title = String(d?.title ?? 'Human Task');
  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top}>
        <span className="rounded bg-surface-overlay border border-border shadow-md px-2 py-0.5 text-[10px] text-intent-danger">Human</span>
      </NodeToolbar>
      <div
        className={`rounded-xl border-2 min-w-[160px] overflow-hidden shadow-sm transition-shadow
          ${selected ? 'shadow-md ring-2 wf-ring-danger-50' : ''}
          wf-border-danger-40 wf-bg-danger-15 border-dashed`}
      >
        <div className="flex items-center gap-1.5 wf-bg-danger-25 px-3 py-1.5">
          <span className="text-sm">⊚</span>
          <span className="text-xs font-semibold text-content-primary">Human</span>
          {d?.humanDeadline ? (
            <span className="ml-auto text-[10px] text-content-tertiary">◷</span>
          ) : null}
        </div>
        <div className="px-3 py-2">
          <p className="text-xs font-medium text-content-primary truncate">{title}</p>
          {(d as any)?.outputSchema ? (
            <p className="mt-0.5 text-[11px] text-content-tertiary">
              Schema: {Object.keys((d as any)?.outputSchema as object ?? {}).length} fields
            </p>
          ) : null}
        </div>
        <Handle type="target" position={Position.Top} className="!bg-intent-danger !border-2 !border-surface-primary !w-3 !h-3" />
        <Handle type="source" position={Position.Bottom} className="!bg-intent-danger !border-2 !border-surface-primary !w-3 !h-3" />
      </div>
    </>
  );
}
