import { Handle, Position, NodeToolbar, type NodeProps } from '@xyflow/react';

export function AgentGroupNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown> | undefined;
  const role = String((d as any)?.role ?? (d as any)?.title ?? 'Agent');
  const model = (d as any)?.model;
  const persistent = (d as any)?.persistent;
  const tools = (d as any)?.allowedTools as string[] | undefined;

  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top}>
        <div className="flex gap-1 rounded bg-surface-overlay border border-border shadow-md p-1">
          <span className="text-[10px] text-accent px-1">
            {(d as any)?.role ?? 'Agent'}
          </span>
        </div>
      </NodeToolbar>

      {/* Group container */}
      <div
        className={`rounded-xl border-2 border-dashed min-w-[300px] min-h-[140px] shadow-sm transition-shadow
          ${selected ? 'shadow-md ring-2 wf-ring-accent-40' : ''}
          wf-bg-accent-5 wf-border-accent-20`}
      >
        {/* Header bar */}
        <div className="flex items-center gap-1.5 wf-bg-accent-10 px-4 py-2 rounded-t-xl">
          <span className="text-sm text-accent-foreground">{'[-]'}</span>
          <span className="text-xs font-semibold text-accent-foreground">{role}</span>
          {model ? <span className="text-[10px] text-content-tertiary ml-1">{String(model)}</span> : null}
          {persistent ? <span className="ml-auto rounded-full wf-bg-accent-30 px-1.5 text-[10px] text-accent">persistent</span> : null}
          {tools ? <span className="ml-auto text-[10px] text-content-tertiary">{tools.length} tools</span> : null}
        </div>
        {/* Body — children render here via xyflow parentId */}
        <div className="px-4 py-2 text-[11px] text-content-tertiary/50">
          Drag nodes here or select nodes + right-click "Group into Agent"
        </div>
      </div>

      <Handle type="target" position={Position.Top} className="!bg-accent !border-2 !border-surface-primary !w-3 !h-3" />
      <Handle type="source" position={Position.Bottom} className="!bg-accent !border-2 !border-surface-primary !w-3 !h-3" />
    </>
  );
}
