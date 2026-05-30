import { Handle, Position, NodeToolbar, type NodeProps } from '@xyflow/react';

export function ApprovalNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown> | undefined;
  const title = String((d as any)?.approvalTitle ?? (d as any)?.title ?? 'Approval');
  const options = (d as any)?.options as string[] | undefined;
  const leftStripe = '3px solid var(--intent-danger)';
  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top}>
        <span className="rounded bg-surface-overlay border border-border shadow-md px-2 py-0.5 text-[10px] text-intent-danger">Approval</span>
      </NodeToolbar>
      <div className={`rounded-xl border-2 min-w-[160px] overflow-hidden shadow-sm transition-shadow wf-border-danger-30 wf-bg-danger-5 ${selected ? 'shadow-md ring-2 wf-ring-danger-40' : ''}`} style={{ borderLeft: leftStripe }}>
        <div className="flex items-center gap-1.5 px-3 py-2">
          <span className="text-sm text-intent-danger-foreground">{'||'}</span>
          <span className="text-xs font-semibold text-intent-danger-foreground">{title}</span>
        </div>
        {options ? (
          <div className="px-3 pb-2 flex gap-1">
            {options.map((opt, i) => (
              <span key={i} className="rounded-full wf-bg-danger-10 px-1.5 text-[10px] text-intent-danger">{opt}</span>
            ))}
          </div>
        ) : null}
        <Handle type="target" position={Position.Top} className="!bg-intent-danger !border-2 !border-surface-primary !w-3 !h-3" />
        <Handle type="source" position={Position.Bottom} className="!bg-intent-danger !border-2 !border-surface-primary !w-3 !h-3" />
      </div>
    </>
  );
}
