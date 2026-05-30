import { Handle, Position, type NodeProps } from '@xyflow/react';

export function EndNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown> | undefined;
  const label = String((d as any)?.title ?? 'End');
  return (
    <div className={`flex items-center gap-2 rounded-full border-2 px-5 py-2.5 min-w-[110px] shadow-xs transition-shadow border-border wf-bg-surface-25 ${selected ? 'shadow-md ring-2 ring-border/40' : ''}`}>
      <Handle type="target" position={Position.Left} className="!bg-content-tertiary !border-2 !border-surface-primary !w-3 !h-3" />
      <span className="text-xs font-semibold text-content-secondary">{label}</span>
      <span className="text-sm text-content-secondary">{'[]'}</span>
    </div>
  );
}
