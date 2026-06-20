import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { RefreshCw, Search } from 'lucide-react';
import { apiFetch, authHeaders } from '../../utils/api.js';
import { computeForceLayout } from './force-layout';
import { EntityNodeComponent, entityColor } from './EntityNode';
import type { EntityNode } from './EntityNode';
import { RelationEdgeComponent } from './RelationEdge';
import type { RelationEdge } from './RelationEdge';
import { GraphDetailPanel } from './GraphDetailPanel';

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

const nodeTypes = { entity: EntityNodeComponent };
const edgeTypes = { relation: RelationEdgeComponent };

const ALL_TYPES = ['person', 'project', 'concept', 'technology', 'decision', 'memory'];

export function GraphTab() {
  const [data, setData] = useState<GraphData>({ entities: [], relations: [] });
  const [loading, setLoading] = useState(true);
  const [nodes, setNodes, onNodesChange] = useNodesState<EntityNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<RelationEdge>([]);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GraphEntity[]>([]);
  const [activeTypes, setActiveTypes] = useState<Set<string>>(new Set(ALL_TYPES));
  const [layoutComputed, setLayoutComputed] = useState(false);

  const fetchGraph = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/memory/graph', { headers: authHeaders() });
      const json = await res.json();
      setData(json);
      setLayoutComputed(false);
    } catch {
      /* graph unavailable */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  // Filter entities by active types
  const filteredEntities = useMemo(
    () => data.entities.filter((e) => activeTypes.has(e.type)),
    [data, activeTypes],
  );

  const filteredEntityIds = useMemo(
    () => new Set(filteredEntities.map((e) => e.id)),
    [filteredEntities],
  );

  const filteredRelations = useMemo(
    () =>
      data.relations.filter((r) => filteredEntityIds.has(r.from) && filteredEntityIds.has(r.to)),
    [data.relations, filteredEntityIds],
  );

  // Compute force layout and build React Flow nodes/edges
  useEffect(() => {
    if (filteredEntities.length === 0 || layoutComputed) return;

    const positions = computeForceLayout(
      filteredEntities.map((e) => ({ id: e.id, frequency: e.frequency })),
      filteredRelations.map((r) => ({ from: r.from, to: r.to, strength: r.strength })),
      { width: 1200, height: 900 },
    );

    const rfNodes: EntityNode[] = filteredEntities.map((e) => {
      const pos = positions.get(e.id) ?? { x: Math.random() * 800, y: Math.random() * 600 };
      return {
        id: e.id,
        type: 'entity',
        position: pos,
        data: {
          label: e.name,
          type: e.type,
          frequency: e.frequency,
          selected: e.id === selectedEntityId,
        },
      };
    });

    const rfEdges: RelationEdge[] = filteredRelations.map((r) => ({
      id: r.id,
      source: r.from,
      target: r.to,
      type: 'relation',
      data: {
        relation: r.relation,
        strength: r.strength,
        active: r.from === hoveredNodeId || r.to === hoveredNodeId,
      },
    }));

    setNodes(rfNodes);
    setEdges(rfEdges);
    setLayoutComputed(true);
  }, [filteredEntities, filteredRelations, layoutComputed]);

  // Update edge active state on hover
  useEffect(() => {
    if (!layoutComputed) return;
    setEdges((eds) =>
      eds.map((e) => ({
        ...e,
        data: {
          relation: e.data?.relation ?? '',
          strength: e.data?.strength ?? 0,
          active: e.source === hoveredNodeId || e.target === hoveredNodeId,
        },
      })),
    );
  }, [hoveredNodeId, layoutComputed]);

  // Update node selected state
  useEffect(() => {
    if (!layoutComputed) return;
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: { ...n.data, selected: n.id === selectedEntityId },
      })),
    );
  }, [selectedEntityId, layoutComputed]);

  const toggleType = (t: string) => {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
    setLayoutComputed(false);
  };

  const handleSearch = useCallback(async (q: string) => {
    setSearchQuery(q);
    if (!q.trim()) {
      setSearchResults([]);
      return;
    }
    try {
      const res = await apiFetch(`/api/memory/graph/search?q=${encodeURIComponent(q)}`, {
        headers: authHeaders(),
      });
      const json = await res.json();
      setSearchResults(json.entities ?? []);
    } catch {
      setSearchResults([]);
    }
  }, []);

  const focusEntity = useCallback(
    (id: string) => {
      // Expand types to ensure the entity is visible
      const entity = data.entities.find((e) => e.id === id);
      if (entity && !activeTypes.has(entity.type)) {
        setActiveTypes((prev) => new Set([...prev, entity.type]));
        setLayoutComputed(false);
        // Focus after layout
        setTimeout(() => setSelectedEntityId(id), 200);
      } else {
        setSelectedEntityId(id);
      }
    },
    [data.entities, activeTypes],
  );

  return (
    <div className="flex h-full">
      {/* Main graph area */}
      <div className="flex flex-1 flex-col">
        {/* Toolbar */}
        <div className="border-border flex shrink-0 items-center gap-2 border-b px-3 py-2">
          <button
            onClick={() => {
              fetchGraph();
              setSelectedEntityId(null);
            }}
            className="text-content-tertiary hover:bg-surface-muted hover:text-content-secondary flex items-center gap-1 rounded-sm px-2 py-1 text-xs transition-colors"
            title="Refresh"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>

          {/* Type filters */}
          {ALL_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => toggleType(t)}
              className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] transition-colors ${
                activeTypes.has(t)
                  ? 'text-content-inverse'
                  : 'text-content-tertiary opacity-50 hover:opacity-80'
              }`}
              style={
                activeTypes.has(t)
                  ? { backgroundColor: entityColor(t) }
                  : { backgroundColor: 'transparent' }
              }
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  backgroundColor: activeTypes.has(t) ? 'white' : entityColor(t),
                }}
              />
              {t}
            </button>
          ))}

          <div className="ml-auto flex items-center gap-1">
            {/* Search */}
            <div className="relative">
              <Search
                size={12}
                className="text-content-tertiary absolute top-1/2 left-1.5 -translate-y-1/2"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && searchResults.length > 0 && searchResults[0]) {
                    focusEntity(searchResults[0].id);
                    setSearchQuery('');
                    setSearchResults([]);
                  }
                }}
                placeholder="Search entity..."
                className="border-border bg-surface-elevated text-content-secondary focus:ring-accent w-40 rounded-sm border py-0.5 pr-2 pl-6 text-xs focus:ring-1 focus:outline-hidden"
              />
              {searchResults.length > 0 && (
                <div className="border-border bg-surface-primary absolute top-full left-0 z-50 mt-1 max-h-40 w-56 overflow-y-auto rounded-md border shadow-lg">
                  {searchResults.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => {
                        focusEntity(e.id);
                        setSearchQuery('');
                        setSearchResults([]);
                      }}
                      className="text-content-secondary hover:bg-surface-muted flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs"
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: entityColor(e.type) }}
                      />
                      <span className="truncate">{e.name}</span>
                      <span className="text-content-tertiary ml-auto shrink-0 text-[10px]">
                        {e.type}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Graph canvas */}
        <div className="flex-1">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-content-tertiary text-sm italic">Loading graph...</p>
            </div>
          ) : filteredEntities.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-content-tertiary text-sm italic">
                No entities found. Enable types above or populate the knowledge graph.
              </p>
            </div>
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodeClick={(_e, node) => setSelectedEntityId(node.id)}
              onNodeMouseEnter={(_e, node) => setHoveredNodeId(node.id)}
              onNodeMouseLeave={() => setHoveredNodeId(null)}
              onPaneClick={() => setSelectedEntityId(null)}
              fitView
              fitViewOptions={{ padding: 0.3 }}
              minZoom={0.1}
              maxZoom={3}
              defaultViewport={{ x: 0, y: 0, zoom: 1 }}
              proOptions={{ hideAttribution: true }}
            >
              <Background color="var(--graph-bg-grid)" gap={24} />
              <Controls
                className="!border-border !bg-surface-primary !rounded-md !border !shadow-lg"
                position="bottom-right"
              />
              <MiniMap
                className="!border-border !bg-surface-primary !rounded-md !border"
                nodeColor={(n) => {
                  const nodeData = (n as EntityNode)?.data;
                  return nodeData?.type ? entityColor(nodeData.type) : entityColor('memory');
                }}
                maskColor="var(--graph-minimap-mask)"
                position="bottom-left"
                style={{ width: 160, height: 120 }}
              />
            </ReactFlow>
          )}
        </div>
      </div>

      {/* Detail panel */}
      <GraphDetailPanel
        entityId={selectedEntityId}
        onClose={() => setSelectedEntityId(null)}
        onFocusEntity={focusEntity}
      />
    </div>
  );
}
