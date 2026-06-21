import { Handle, Position, type NodeProps } from '@xyflow/react';

export function EndNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown> | undefined;
  const label = String((d as any)?.title ?? 'End');
  return (
    <div
      className={`border-border wf-bg-surface-25 flex min-w-[110px] items-center gap-2 rounded-full border-2 px-5 py-2.5 shadow-xs transition-shadow ${selected ? 'ring-border/40 shadow-md ring-2' : ''}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-content-tertiary !border-surface-primary !h-3 !w-3 !border-2"
      />
      <span className="text-content-secondary text-xs font-semibold">{label}</span>
      <span className="text-content-secondary text-sm">{'[]'}</span>
    </div>
  );
}
