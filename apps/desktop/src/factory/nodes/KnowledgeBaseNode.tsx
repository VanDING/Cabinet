import { Handle, Position, NodeToolbar, type NodeProps } from '@xyflow/react';

export function KnowledgeBaseNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown> | undefined;
  const kb = String(d?.kbId ?? d?.title ?? 'Knowledge Base');
  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top}>
        <span className="rounded-sm bg-surface-overlay border border-border shadow-md px-2 py-0.5 text-[10px] text-intent-success">KB</span>
      </NodeToolbar>
      <div
        className={`rounded-xl border-2 min-w-[160px] overflow-hidden shadow-xs transition-shadow
          ${selected ? 'shadow-md ring-2 wf-ring-success-50' : ''}
          wf-border-success-50 wf-bg-success-5`}
      >
        <div className="flex items-center gap-1.5 wf-bg-success-35 px-3 py-1.5">
          <span className="text-sm">⊡</span>
          <span className="text-xs font-semibold text-content-primary">Knowledge Base</span>
        </div>
        <div className="px-3 py-2">
          <p className="text-xs font-medium text-content-primary truncate">{kb}</p>
          <p className="mt-0.5 text-[11px] text-content-tertiary">
            Top-K: {String(d?.topK ?? 5)} · ε: {String(d?.scoreThreshold ?? 0.7)}
          </p>
        </div>
        <Handle type="target" position={Position.Top} className="!bg-intent-success !border-2 !border-surface-primary !w-3 !h-3" />
        <Handle type="source" position={Position.Bottom} className="!bg-intent-success !border-2 !border-surface-primary !w-3 !h-3" />
      </div>
    </>
  );
}
