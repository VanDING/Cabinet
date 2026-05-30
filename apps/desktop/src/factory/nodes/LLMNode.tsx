import { Handle, Position, NodeToolbar, type NodeProps } from '@xyflow/react';

export function LLMNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown> | undefined;
  const title = String((d as any)?.title ?? '');
  const prompt = String((d as any)?.prompt ?? '');
  const model = (d as any)?.model;
  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top}>
        <span className="rounded bg-surface-overlay border border-border shadow-md px-2 py-0.5 text-[10px] text-accent">LLM</span>
      </NodeToolbar>
      <div className={`rounded-xl border-2 min-w-[180px] max-w-[240px] overflow-hidden shadow-sm transition-shadow wf-border-accent-30 wf-bg-accent-5 ${selected ? 'shadow-md ring-2 wf-ring-accent-40' : ''}`}>
        <div className="flex items-center gap-1.5 wf-bg-accent-20 px-3 py-1.5">
          <span className="text-sm text-accent-foreground">✦</span>
          <span className="text-xs font-semibold text-accent-foreground">LLM</span>
          {model ? <span className="ml-auto rounded-full wf-bg-accent-30 px-1.5 text-[10px] text-accent">{String(model)}</span> : null}
        </div>
        <div className="px-3 py-2">
          <p className="text-xs font-medium text-content-primary truncate">{title}</p>
          {prompt ? <p className="mt-1 text-[11px] text-content-tertiary truncate max-w-[200px] leading-snug">{prompt.slice(0, 80)}{prompt.length > 80 ? '…' : ''}</p> : null}
        </div>
        <Handle type="target" position={Position.Top} className="!bg-accent !border-2 !border-surface-primary !w-3 !h-3" />
        <Handle type="source" position={Position.Bottom} className="!bg-accent !border-2 !border-surface-primary !w-3 !h-3" />
      </div>
    </>
  );
}
