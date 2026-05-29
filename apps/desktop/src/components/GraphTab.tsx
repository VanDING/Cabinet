import { useState, useEffect, useMemo } from 'react';
import { apiFetch, authHeaders } from '../utils/pin.js';

interface GraphEntity {
  id: string;
  name: string;
  type: string;
  frequency: number;
}

interface GraphRelation {
  id: string;
  from: string;
  to: string;
  relation: string;
  strength: number;
}

interface GraphData {
  entities: GraphEntity[];
  relations: GraphRelation[];
}

interface NodePosition {
  x: number;
  y: number;
}

const TYPE_COLORS: Record<string, string> = {
  person: '#3b82f6',
  project: '#8b5cf6',
  concept: '#10b981',
  technology: '#f59e0b',
  decision: '#ef4444',
  memory: '#6b7280',
};

function computeLayout(entities: GraphEntity[]): Map<string, NodePosition> {
  const positions = new Map<string, NodePosition>();
  const typeGroups = new Map<string, GraphEntity[]>();

  for (const e of entities) {
    const list = typeGroups.get(e.type) ?? [];
    list.push(e);
    typeGroups.set(e.type, list);
  }

  const centerX = 400;
  const centerY = 300;
  let ringIndex = 0;

  for (const [, group] of typeGroups) {
    const radius = 120 + ringIndex * 100;
    const angleStep = (2 * Math.PI) / Math.max(group.length, 1);
    group.forEach((e, i) => {
      const angle = i * angleStep;
      positions.set(e.id, {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      });
    });
    ringIndex++;
  }

  return positions;
}

export function GraphTab() {
  const [data, setData] = useState<GraphData>({ entities: [], relations: [] });
  const [loading, setLoading] = useState(false);
  const [selectedType, setSelectedType] = useState<string>('all');
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const fetchGraph = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/memory/graph', { headers: authHeaders() });
      const json = await res.json();
      setData(json);
    } catch {
      setData({ entities: [], relations: [] });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGraph();
  }, []);

  const types = useMemo(() => {
    const set = new Set(data.entities.map((e) => e.type));
    return ['all', ...Array.from(set)];
  }, [data.entities]);

  const filteredEntities = useMemo(() => {
    if (selectedType === 'all') return data.entities;
    return data.entities.filter((e) => e.type === selectedType);
  }, [data.entities, selectedType]);

  const filteredEntityIds = useMemo(
    () => new Set(filteredEntities.map((e) => e.id)),
    [filteredEntities],
  );

  const filteredRelations = useMemo(() => {
    return data.relations.filter(
      (r) => filteredEntityIds.has(r.from) && filteredEntityIds.has(r.to),
    );
  }, [data.relations, filteredEntityIds]);

  const positions = useMemo(() => computeLayout(filteredEntities), [filteredEntities]);

  const svgWidth = 800;
  const svgHeight = 600;

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-content-tertiary">Entity type:</span>
        {types.map((t) => (
          <button
            key={t}
            onClick={() => setSelectedType(t)}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
              selectedType === t
                ? 'border-accent bg-accent text-content-inverse'
                : 'border-border text-content-secondary hover:bg-surface-elevated:bg-surface-input'
            }`}
          >
            {t}
          </button>
        ))}
        <button
          onClick={fetchGraph}
          className="ml-auto rounded-lg border px-3 py-1 text-xs text-content-tertiary transition-colors hover:text-content-secondary"
        >
          Refresh
        </button>
      </div>

      <div className="flex-1 overflow-hidden rounded-lg border border-border">
        {loading ? (
          <div className="flex h-full items-center justify-center text-content-tertiary">
            Loading graph...
          </div>
        ) : filteredEntities.length === 0 ? (
          <div className="flex h-full items-center justify-center text-content-tertiary">
            No entities found.
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="h-full w-full bg-surface-elevated"
          >
            {filteredRelations.map((r) => {
              const from = positions.get(r.from);
              const to = positions.get(r.to);
              if (!from || !to) return null;
              const isHighlighted = hoveredNode === r.from || hoveredNode === r.to;
              return (
                <line
                  key={r.id}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  strokeWidth={isHighlighted ? 2 : Math.max(0.5, r.strength * 1.5)}
                  opacity={hoveredNode && !isHighlighted ? 0.2 : 1}
                  className={
                    isHighlighted
                      ? '[stroke:#60a5fa]'
                      : '[stroke:#d1d5db]:#374151]'
                  }
                />
              );
            })}

            {filteredEntities.map((e) => {
              const pos = positions.get(e.id);
              if (!pos) return null;
              const color = TYPE_COLORS[e.type] || '#6b7280';
              const isHighlighted = hoveredNode === e.id;
              const hasRelation = hoveredNode
                ? filteredRelations.some(
                    (r) =>
                      (r.from === e.id || r.to === e.id) &&
                      (r.from === hoveredNode || r.to === hoveredNode),
                  )
                : false;
              const dimmed = hoveredNode && !isHighlighted && !hasRelation;

              return (
                <g
                  key={e.id}
                  transform={`translate(${pos.x}, ${pos.y})`}
                  onMouseEnter={() => setHoveredNode(e.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                  style={{ cursor: 'pointer' }}
                  opacity={dimmed ? 0.3 : 1}
                >
                  <circle
                    r={8 + Math.min(e.frequency * 2, 12)}
                    fill={color}
                    strokeWidth={isHighlighted ? 3 : 2}
                    className="[stroke:#ffffff]:#1f2937]"
                  />
                  <text
                    y={22 + Math.min(e.frequency * 2, 12)}
                    textAnchor="middle"
                    fontSize={11}
                    className="[fill:#374151]:#d1d5db]"
                  >
                    {e.name.length > 16 ? e.name.slice(0, 16) + '...' : e.name}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-3 text-xs text-content-tertiary">
        {Object.entries(TYPE_COLORS).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="capitalize">{type}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
