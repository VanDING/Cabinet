import { memo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
  type Edge,
} from '@xyflow/react';

interface RelationEdgeData extends Record<string, unknown> {
  relation: string;
  strength: number;
  active?: boolean;
}

export type RelationEdge = Edge<RelationEdgeData, 'relation'>;

function RelationEdgeComp({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<RelationEdge>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const strength = data?.strength ?? 0.5;
  const strokeWidth = Math.max(0.5, strength * 2);
  const isActive = selected || (data?.active ?? false);
  const strokeColor = isActive ? 'var(--graph-edge-active)' : 'var(--graph-edge-inactive)';
  const opacity = isActive ? 1 : 0.25;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: strokeColor,
          strokeWidth,
          opacity,
          transition: 'opacity 0.2s, stroke 0.2s',
        }}
      />
      {isActive && data?.relation && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan rounded bg-surface-primary px-1.5 py-0.5 text-[10px] text-content-secondary shadow-sm"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
          >
            {data.relation}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const RelationEdgeComponent = memo(RelationEdgeComp);
