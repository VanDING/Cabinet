import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';

export const TYPE_COLORS: Record<string, string> = {
  person: '#3b82f6',
  project: '#8b5cf6',
  concept: '#10b981',
  technology: '#f59e0b',
  decision: '#ef4444',
  memory: '#6b7280',
};

interface EntityNodeData extends Record<string, unknown> {
  label: string;
  type: string;
  frequency: number;
  selected?: boolean;
}

export type EntityNode = Node<EntityNodeData, 'entity'>;

function EntityNodeComp({ data, selected }: NodeProps<EntityNode>) {
  const color = TYPE_COLORS[data.type] ?? '#6b7280';
  const radius = 8 + Math.min(data.frequency * 2, 14);
  const label = data.label.length > 16 ? data.label.slice(0, 16) + '…' : data.label;

  return (
    <div className="relative" style={{ width: radius * 2 + 4, height: radius * 2 + 30 }}>
      <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }} />
      <div
        className="flex items-center justify-center"
        style={{ width: radius * 2 + 4, height: radius * 2 + 4 }}
      >
        <div
          className="rounded-full transition-shadow"
          style={{
            width: radius * 2,
            height: radius * 2,
            backgroundColor: color,
            opacity: selected ? 1 : 0.85,
            boxShadow: selected
              ? `0 0 0 3px ${color}40, 0 0 12px ${color}60`
              : `0 1px 3px ${color}30`,
          }}
          title={data.label}
        />
      </div>
      <div
        className="absolute text-center leading-tight"
        style={{
          top: radius * 2 + 6,
          left: '50%',
          transform: 'translateX(-50%)',
          fontSize: 10,
          color: '#e2e8f0',
          maxWidth: 80,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />
    </div>
  );
}

export const EntityNodeComponent = memo(EntityNodeComp);
