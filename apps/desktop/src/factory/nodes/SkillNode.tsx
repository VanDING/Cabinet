import { Handle, Position, NodeToolbar, type NodeProps } from '@xyflow/react';

export function SkillNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown> | undefined;
  const name = String((d as any)?.skillId ?? (d as any)?.title ?? 'Skill');
  const mapping = (d as any)?.inputMapping;
  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top}>
        <span className="bg-surface-overlay border-border text-intent-purple rounded-sm border px-2 py-0.5 text-[10px] shadow-md">
          Skill
        </span>
      </NodeToolbar>
      <div
        className={`wf-border-purple-35 wf-bg-purple-15 max-w-[220px] min-w-[160px] overflow-hidden rounded-xl border-2 shadow-xs transition-shadow ${selected ? 'wf-ring-purple-50 shadow-md ring-2' : ''}`}
      >
        <div className="wf-bg-purple-35 flex items-center gap-1.5 px-3 py-1.5">
          <span className="text-content-primary text-sm">◇</span>
          <span className="text-content-primary text-xs font-semibold">Skill</span>
        </div>
        <div className="px-3 py-2">
          <p className="text-content-primary truncate text-xs font-medium">{name}</p>
          {mapping ? (
            <p className="text-content-tertiary mt-0.5 text-[11px]">
              {Object.keys(mapping as object).length} params
            </p>
          ) : null}
        </div>
        <Handle
          type="target"
          position={Position.Top}
          className="!bg-intent-purple !border-surface-primary !h-3 !w-3 !border-2"
        />
        <Handle
          type="source"
          position={Position.Bottom}
          className="!bg-intent-purple !border-surface-primary !h-3 !w-3 !border-2"
        />
      </div>
    </>
  );
}
