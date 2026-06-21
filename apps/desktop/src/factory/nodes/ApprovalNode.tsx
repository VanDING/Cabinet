import { Handle, Position, NodeToolbar, type NodeProps } from '@xyflow/react';

export function ApprovalNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown> | undefined;
  const title = String((d as any)?.approvalTitle ?? (d as any)?.title ?? 'Approval');
  const options = (d as any)?.options as string[] | undefined;
  const leftStripe = '3px solid var(--intent-danger)';
  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top}>
        <span className="bg-surface-overlay border-border text-intent-danger rounded-sm border px-2 py-0.5 text-[10px] shadow-md">
          Approval
        </span>
      </NodeToolbar>
      <div
        className={`wf-border-danger-40 wf-bg-danger-15 min-w-[160px] overflow-hidden rounded-xl border-2 shadow-xs transition-shadow ${selected ? 'wf-ring-danger-50 shadow-md ring-2' : ''}`}
        style={{ borderLeft: leftStripe }}
      >
        <div className="flex items-center gap-1.5 px-3 py-2">
          <span className="text-content-primary text-sm">{'||'}</span>
          <span className="text-content-primary text-xs font-semibold">{title}</span>
        </div>
        {options ? (
          <div className="flex gap-1 px-3 pb-2">
            {options.map((opt, i) => (
              <span
                key={i}
                className="wf-bg-danger-25 text-intent-danger rounded-full px-1.5 text-[10px]"
              >
                {opt}
              </span>
            ))}
          </div>
        ) : null}
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
