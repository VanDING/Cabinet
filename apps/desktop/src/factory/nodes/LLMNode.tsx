import { Handle, Position, NodeToolbar, type NodeProps } from '@xyflow/react';

export function LLMNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown> | undefined;
  const title = String((d as any)?.title ?? '');
  const prompt = String((d as any)?.prompt ?? '');
  const model = (d as any)?.model;
  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top}>
        <span className="bg-surface-overlay border-border text-accent rounded-sm border px-2 py-0.5 text-[10px] shadow-md">
          LLM
        </span>
      </NodeToolbar>
      <div
        className={`wf-border-accent-50 wf-bg-accent-15 max-w-[240px] min-w-[180px] overflow-hidden rounded-xl border-2 shadow-xs transition-shadow ${selected ? 'wf-ring-accent-50 shadow-md ring-2' : ''}`}
      >
        <div className="wf-bg-accent-35 flex items-center gap-1.5 px-3 py-1.5">
          <span className="text-content-primary text-sm">✦</span>
          <span className="text-content-primary text-xs font-semibold">LLM</span>
          {model ? (
            <span className="wf-bg-accent-50 text-accent ml-auto rounded-full px-1.5 text-[10px]">
              {String(model)}
            </span>
          ) : null}
        </div>
        <div className="px-3 py-2">
          <p className="text-content-primary truncate text-xs font-medium">{title}</p>
          {prompt ? (
            <p className="text-content-tertiary mt-1 max-w-[200px] truncate text-[11px] leading-snug">
              {prompt.slice(0, 80)}
              {prompt.length > 80 ? '…' : ''}
            </p>
          ) : null}
        </div>
        <Handle
          type="target"
          position={Position.Top}
          className="!bg-accent !border-surface-primary !h-3 !w-3 !border-2"
        />
        <Handle
          type="source"
          position={Position.Bottom}
          className="!bg-accent !border-surface-primary !h-3 !w-3 !border-2"
        />
      </div>
    </>
  );
}
