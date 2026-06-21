import { Handle, Position, NodeToolbar, type NodeProps } from '@xyflow/react';

export function IntentClassifyNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown> | undefined;
  const intents = (d as any)?.intents as Array<{ name: string }> | undefined;
  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top}>
        <span className="bg-surface-overlay border-border text-accent rounded-sm border px-2 py-0.5 text-[10px] shadow-md">
          Intent
        </span>
      </NodeToolbar>
      <div
        className={`min-w-[170px] overflow-hidden rounded-xl border-2 shadow-xs transition-shadow ${selected ? 'wf-ring-accent-50 shadow-md ring-2' : ''} wf-border-accent-50 wf-bg-accent-5`}
      >
        <div className="wf-bg-accent-35 flex items-center gap-1.5 px-3 py-1.5">
          <span className="text-sm">⊿</span>
          <span className="text-content-primary text-xs font-semibold">Intent Classify</span>
        </div>
        <div className="px-3 py-2">
          <p className="text-content-primary text-xs font-medium">
            {String(d?.title ?? 'Classify intent')}
          </p>
          {intents && intents.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {intents.slice(0, 3).map((i, idx) => (
                <span
                  key={idx}
                  className="wf-bg-accent-50 text-accent rounded-full px-1.5 text-[10px]"
                >
                  {i.name}
                </span>
              ))}
              {intents.length > 3 && (
                <span className="text-content-tertiary text-[10px]">+{intents.length - 3}</span>
              )}
            </div>
          )}
        </div>
        <Handle
          type="target"
          position={Position.Top}
          className="!bg-accent !border-surface-primary !h-3 !w-3 !border-2"
        />
        <Handle
          type="source"
          position={Position.Bottom}
          id="default"
          className="!bg-accent !border-surface-primary !h-3 !w-3 !border-2"
        />
      </div>
    </>
  );
}
