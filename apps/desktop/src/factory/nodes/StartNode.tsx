import { Handle, Position, type NodeProps } from '@xyflow/react';

export function StartNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown> | undefined;
  const label = String((d as any)?.title ?? 'Start');
  return (
    <div
      className={`wf-border-success-50 wf-bg-success-15 flex min-w-[110px] items-center gap-2 rounded-full border-2 px-5 py-2.5 shadow-xs transition-shadow ${selected ? 'wf-ring-success-50 shadow-md ring-2' : ''}`}
    >
      <span className="text-content-primary text-sm">{'>'}</span>
      <span className="text-content-primary text-xs font-semibold">{label}</span>
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-intent-success !border-surface-primary !h-3 !w-3 !border-2"
      />
    </div>
  );
}
