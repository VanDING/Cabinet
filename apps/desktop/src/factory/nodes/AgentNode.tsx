import { Handle, Position, NodeToolbar, type NodeProps } from '@xyflow/react';
import type { CanvasNodeData } from '../node-types';

export function AgentNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown> | undefined;
  const prompt = String(d?.prompt ?? '');
  const label = String(d?.role ?? d?.title ?? 'Agent');
  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top}>
        <div className="flex gap-1 rounded-sm bg-surface-overlay border border-border shadow-md p-1">
          <span className="text-[10px] text-content-secondary px-1">{label}</span>
        </div>
      </NodeToolbar>
      <div
        className={`rounded-lg border-2 px-3 py-2 min-w-[180px] max-w-[240px]
          bg-surface-primary shadow-xs
          ${selected ? 'border-accent shadow-md' : 'border-border'}`}
      >
        <Handle type="target" position={Position.Top} className="!bg-accent" />
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-accent" />
          <span className="text-xs font-medium text-content-primary truncate">{label}</span>
        </div>
        {prompt && (
          <p className="mt-1 text-[11px] text-content-tertiary truncate max-w-[200px] leading-snug">
            {prompt.slice(0, 80)}{prompt.length > 80 ? '…' : ''}
          </p>
        )}
        <Handle type="source" position={Position.Bottom} className="!bg-accent" />
      </div>
    </>
  );
}
