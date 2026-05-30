import { Handle, Position, NodeToolbar, type NodeProps } from '@xyflow/react';

export function SkillNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown> | undefined;
  const name = String((d as any)?.skillId ?? (d as any)?.title ?? 'Skill');
  const mapping = (d as any)?.inputMapping;
  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top}>
        <span className="rounded bg-surface-overlay border border-border shadow-md px-2 py-0.5 text-[10px] text-intent-purple">Skill</span>
      </NodeToolbar>
      <div className={`rounded-xl border-2 min-w-[160px] max-w-[220px] overflow-hidden shadow-sm transition-shadow wf-border-purple-35 wf-bg-purple-15 ${selected ? 'shadow-md ring-2 wf-ring-purple-50' : ''}`}>
        <div className="flex items-center gap-1.5 wf-bg-purple-35 px-3 py-1.5">
          <span className="text-sm text-content-primary">◇</span>
          <span className="text-xs font-semibold text-content-primary">Skill</span>
        </div>
        <div className="px-3 py-2">
          <p className="text-xs font-medium text-content-primary truncate">{name}</p>
          {mapping ? <p className="mt-0.5 text-[11px] text-content-tertiary">{Object.keys(mapping as object).length} params</p> : null}
        </div>
        <Handle type="target" position={Position.Top} className="!bg-intent-purple !border-2 !border-surface-primary !w-3 !h-3" />
        <Handle type="source" position={Position.Bottom} className="!bg-intent-purple !border-2 !border-surface-primary !w-3 !h-3" />
      </div>
    </>
  );
}
