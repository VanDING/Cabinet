import { Handle, Position, NodeToolbar, type NodeProps } from '@xyflow/react';

export function KnowledgeBaseNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown> | undefined;
  const kb = String(d?.kbId ?? d?.title ?? 'Knowledge Base');
  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top}>
        <span className="bg-surface-overlay border-border text-intent-success rounded-sm border px-2 py-0.5 text-[10px] shadow-md">
          KB
        </span>
      </NodeToolbar>
      <div
        className={`min-w-[160px] overflow-hidden rounded-xl border-2 shadow-xs transition-shadow ${selected ? 'wf-ring-success-50 shadow-md ring-2' : ''} wf-border-success-50 wf-bg-success-5`}
      >
        <div className="wf-bg-success-35 flex items-center gap-1.5 px-3 py-1.5">
          <span className="text-sm">⊡</span>
          <span className="text-content-primary text-xs font-semibold">Knowledge Base</span>
        </div>
        <div className="px-3 py-2">
          <p className="text-content-primary truncate text-xs font-medium">{kb}</p>
          <p className="text-content-tertiary mt-0.5 text-[11px]">
            Top-K: {String(d?.topK ?? 5)} · ε: {String(d?.scoreThreshold ?? 0.7)}
          </p>
        </div>
        <Handle
          type="target"
          position={Position.Top}
          className="!bg-intent-success !border-surface-primary !h-3 !w-3 !border-2"
        />
        <Handle
          type="source"
          position={Position.Bottom}
          className="!bg-intent-success !border-surface-primary !h-3 !w-3 !border-2"
        />
      </div>
    </>
  );
}
