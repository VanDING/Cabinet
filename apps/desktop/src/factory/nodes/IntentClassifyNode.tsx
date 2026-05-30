import { Handle, Position, NodeToolbar, type NodeProps } from '@xyflow/react';

export function IntentClassifyNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown> | undefined;
  const intents = (d as any)?.intents as Array<{name: string}> | undefined;
  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top}>
        <span className="rounded-sm bg-surface-overlay border border-border shadow-md px-2 py-0.5 text-[10px] text-accent">Intent</span>
      </NodeToolbar>
      <div
        className={`rounded-xl border-2 min-w-[170px] overflow-hidden shadow-xs transition-shadow
          ${selected ? 'shadow-md ring-2 wf-ring-accent-50' : ''}
          wf-border-accent-50 wf-bg-accent-5`}
      >
        <div className="flex items-center gap-1.5 wf-bg-accent-35 px-3 py-1.5">
          <span className="text-sm">⊿</span>
          <span className="text-xs font-semibold text-content-primary">Intent Classify</span>
        </div>
        <div className="px-3 py-2">
          <p className="text-xs font-medium text-content-primary">{String(d?.title ?? 'Classify intent')}</p>
          {intents && intents.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {intents.slice(0, 3).map((i, idx) => (
                <span key={idx} className="rounded-full wf-bg-accent-50 px-1.5 text-[10px] text-accent">{i.name}</span>
              ))}
              {intents.length > 3 && <span className="text-[10px] text-content-tertiary">+{intents.length - 3}</span>}
            </div>
          )}
        </div>
        <Handle type="target" position={Position.Top} className="!bg-accent !border-2 !border-surface-primary !w-3 !h-3" />
        <Handle type="source" position={Position.Bottom} id="default" className="!bg-accent !border-2 !border-surface-primary !w-3 !h-3" />
      </div>
    </>
  );
}
