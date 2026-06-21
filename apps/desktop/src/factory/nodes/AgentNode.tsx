import { Handle, Position, NodeToolbar, type NodeProps } from '@xyflow/react';
import type { CanvasNodeData } from '../node-types';

export function AgentNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown> | undefined;
  const prompt = String(d?.prompt ?? '');
  const label = String(d?.role ?? d?.title ?? 'Agent');
  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top}>
        <div className="bg-surface-overlay border-border flex gap-1 rounded-sm border p-1 shadow-md">
          <span className="text-content-secondary px-1 text-[10px]">{label}</span>
        </div>
      </NodeToolbar>
      <div
        className={`bg-surface-primary max-w-[240px] min-w-[180px] rounded-lg border-2 px-3 py-2 shadow-xs ${selected ? 'border-accent shadow-md' : 'border-border'}`}
      >
        <Handle type="target" position={Position.Top} className="!bg-accent" />
        <div className="flex items-center gap-1.5">
          <span className="bg-accent h-2 w-2 rounded-full" />
          <span className="text-content-primary truncate text-xs font-medium">{label}</span>
        </div>
        {prompt && (
          <p className="text-content-tertiary mt-1 max-w-[200px] truncate text-[11px] leading-snug">
            {prompt.slice(0, 80)}
            {prompt.length > 80 ? '…' : ''}
          </p>
        )}
        <Handle type="source" position={Position.Bottom} className="!bg-accent" />
      </div>
    </>
  );
}
