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
        <div className="bg-surface-overlay border-border flex gap-1 rounded-sm border p-1 shadow-md">
          <span className="text-accent px-1 text-[10px]">{(d as any)?.role ?? 'Agent'}</span>
        </div>
      </NodeToolbar>

      {/* Group container */}
      <div
        className={`min-h-[140px] min-w-[300px] rounded-xl border-2 border-dashed shadow-xs transition-shadow ${selected ? 'wf-ring-accent-50 shadow-md ring-2' : ''} wf-bg-accent-15 wf-border-accent-35`}
      >
        {/* Header bar */}
        <div className="wf-bg-accent-25 flex items-center gap-1.5 rounded-t-xl px-4 py-2">
          <span className="text-content-primary text-sm">{'[-]'}</span>
          <span className="text-content-primary text-xs font-semibold">{role}</span>
          {model ? (
            <span className="text-content-tertiary ml-1 text-[10px]">{String(model)}</span>
          ) : null}
          {persistent ? (
            <span className="wf-bg-accent-50 text-accent ml-auto rounded-full px-1.5 text-[10px]">
              persistent
            </span>
          ) : null}
          {tools ? (
            <span className="text-content-tertiary ml-auto text-[10px]">{tools.length} tools</span>
          ) : null}
        </div>
        {/* Body — children render here via xyflow parentId */}
        <div className="text-content-tertiary/50 px-4 py-2 text-[11px]">
          Drag nodes here or select nodes + right-click "Group into Agent"
        </div>
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
    </>
  );
}
