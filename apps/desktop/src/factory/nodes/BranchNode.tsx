import { Handle, Position, NodeToolbar, type NodeProps } from '@xyflow/react';
import type { CanvasNodeData } from '../node-types';

export function BranchNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown> | undefined;
  const expr = String(d?.loopCondition ?? 'condition');
  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top}>
        <div className="rounded bg-surface-overlay border border-border shadow-md px-2 py-0.5 text-[10px] text-intent-warning">
          Branch
        </div>
      </NodeToolbar>
      <div
        className={`rounded-lg border-2 px-3 py-2 min-w-[160px] max-w-[200px] rotate-[2deg]
          bg-surface-primary shadow-sm
          ${selected ? 'border-intent-warning shadow-md' : 'border-border'}`}
      >
        <Handle type="target" position={Position.Top} className="!bg-intent-warning" />
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-intent-warning">◇</span>
          <span className="text-xs font-medium text-content-primary">Branch</span>
        </div>
        <p className="mt-1 text-[11px] text-content-tertiary truncate max-w-[180px]">{expr}</p>
        <div className="mt-1 flex gap-2 text-[10px]">
          <Handle
            type="source" position={Position.Bottom} id="true"
            className="!relative !left-auto !right-auto !top-auto !bottom-auto !transform-none !bg-intent-success"
            title="True"
          />
          <span className="text-intent-success">T</span>
          <Handle
            type="source" position={Position.Bottom} id="false"
            className="!relative !left-auto !right-auto !top-auto !bottom-auto !transform-none !bg-intent-danger"
            title="False"
          />
          <span className="text-intent-danger">F</span>
        </div>
      </div>
    </>
  );
}
