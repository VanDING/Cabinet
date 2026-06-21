import { Handle, Position, NodeToolbar, type NodeProps } from '@xyflow/react';
import type { CanvasNodeData } from '../node-types';

export function BranchNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown> | undefined;
  const expr = String(d?.loopCondition ?? 'condition');
  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top}>
        <div className="bg-surface-overlay border-border text-intent-warning rounded-sm border px-2 py-0.5 text-[10px] shadow-md">
          Branch
        </div>
      </NodeToolbar>
      <div
        className={`bg-surface-primary max-w-[200px] min-w-[160px] rotate-[2deg] rounded-lg border-2 px-3 py-2 shadow-xs ${selected ? 'border-intent-warning shadow-md' : 'border-border'}`}
      >
        <Handle type="target" position={Position.Top} className="!bg-intent-warning" />
        <div className="flex items-center gap-1.5">
          <span className="text-intent-warning text-xs font-semibold">◇</span>
          <span className="text-content-primary text-xs font-medium">Branch</span>
        </div>
        <p className="text-content-tertiary mt-1 max-w-[180px] truncate text-[11px]">{expr}</p>
        <div className="mt-1 flex gap-2 text-[10px]">
          <Handle
            type="source"
            position={Position.Bottom}
            id="true"
            className="!bg-intent-success !relative !top-auto !right-auto !bottom-auto !left-auto !scale-none"
            title="True"
          />
          <span className="text-intent-success">T</span>
          <Handle
            type="source"
            position={Position.Bottom}
            id="false"
            className="!bg-intent-danger !relative !top-auto !right-auto !bottom-auto !left-auto !scale-none"
            title="False"
          />
          <span className="text-intent-danger">F</span>
        </div>
      </div>
    </>
  );
}
