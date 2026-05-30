import { Handle, Position, type NodeProps } from '@xyflow/react';

export function StartNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown> | undefined;
  const label = String((d as any)?.title ?? 'Start');
  return (
    <div className={`flex items-center gap-2 rounded-full border-2 px-5 py-2.5 min-w-[110px] shadow-sm transition-shadow wf-border-success-30 wf-bg-success-5 ${selected ? 'shadow-md ring-2 wf-ring-success-40' : ''}`}>
      <span className="text-sm text-intent-success-foreground">{'>'}</span>
      <span className="text-xs font-semibold text-intent-success-foreground">{label}</span>
      <Handle type="source" position={Position.Right} className="!bg-intent-success !border-2 !border-surface-primary !w-3 !h-3" />
    </div>
  );
}
