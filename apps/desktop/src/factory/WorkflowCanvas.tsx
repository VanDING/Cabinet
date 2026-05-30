import { useCallback, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  reconnectEdge,
  MarkerType,
  type Node,
  type Edge,
  type OnConnect,
  type OnReconnect,
  type NodeTypes,
  type Connection,
  type ReactFlowInstance,
  BackgroundVariant,
  SelectionMode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import {
  StartNode, EndNode, IfElseNode, LoopNode, ParallelNode, MergeNode, PassNode,
  AgentGroupNode,
  LLMNode, SkillNode, ToolNode, CodeNode, WorkflowNode,
  IntentClassifyNode, KnowledgeBaseNode,
  ApprovalNode, HumanNode,
} from './nodes';
import type { CanvasNode, CanvasEdge, CanvasNodeType } from './node-types';
import { CANVAS_NODE_TYPES, NODE_LABELS } from './node-types';
import { CanvasContextMenu, type ContextMenuState } from './CanvasContextMenu';

const nodeTypes: NodeTypes = {
  start: StartNode, end: EndNode,
  ifElse: IfElseNode, loop: LoopNode, parallel: ParallelNode, merge: MergeNode, pass: PassNode,
  agentGroup: AgentGroupNode,
  llm: LLMNode, skill: SkillNode, tool: ToolNode, code: CodeNode, workflow: WorkflowNode,
  intentClassify: IntentClassifyNode, knowledgeBase: KnowledgeBaseNode,
  approval: ApprovalNode, human: HumanNode,
} as const;

const defaultEdgeOptions = {
  type: 'smoothstep' as const,
  animated: false,
  markerEnd: {
    type: MarkerType.ArrowClosed,
    width: 16,
    height: 16,
    color: 'var(--graph-edge-inactive, #b1b1b7)',
  },
  style: {
    stroke: 'var(--graph-edge-inactive, #b1b1b7)',
    strokeWidth: 1.5,
  },
};

interface WorkflowCanvasProps {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  editable?: boolean;
  onNodesChange?: (nodes: CanvasNode[]) => void;
  onEdgesChange?: (edges: CanvasEdge[]) => void;
  onNodeClick?: (nodeId: string | null) => void;
  onNodeDoubleClick?: (nodeId: string) => void;
  onNodeAdd?: (type: CanvasNodeType, position: { x: number; y: number }) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  undoStackSize?: number;
  onGroupNodes?: (nodeIds: string[], groupId: string) => void;
}

let nodeIdCounter = 0;
function nextNodeId(type: string): string {
  return `${type}_${Date.now()}_${++nodeIdCounter}`;
}

export function WorkflowCanvas({
  nodes: initialNodes,
  edges: initialEdges,
  editable = true,
  onNodesChange,
  onEdgesChange,
  onNodeClick,
  onNodeAdd,
  onGroupNodes,
}: WorkflowCanvasProps) {
  const [nodes, setNodes, onNodesChangeInternal] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChangeInternal] = useEdgesState(initialEdges);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const prevNodesRef = useRef(initialNodes);
  const prevEdgesRef = useRef(initialEdges);

  // Sync external changes — only apply when node IDs change (new/deleted nodes)
  if (initialNodes !== prevNodesRef.current) {
    prevNodesRef.current = initialNodes;
    const currentIds = new Set(nodes.map((n) => n.id));
    const newIds = new Set(initialNodes.map((n) => n.id));
    const hasNewOrRemoved =
      currentIds.size !== newIds.size || [...newIds].some((id) => !currentIds.has(id));
    if (hasNewOrRemoved) {
      // Merge: keep existing positions for unchanged nodes
      const posMap = new Map(nodes.map((n) => [n.id, n.position]));
      const merged = initialNodes.map((n) => ({
        ...n,
        position: posMap.get(n.id) ?? n.position,
      }));
      setNodes(merged);
    }
  }
  if (initialEdges !== prevEdgesRef.current) {
    prevEdgesRef.current = initialEdges;
    setEdges(initialEdges);
  }

  const syncToParent = useCallback(
    (n: CanvasNode[], e: CanvasEdge[]) => {
      onNodesChange?.(n);
      onEdgesChange?.(e);
    },
    [onNodesChange, onEdgesChange],
  );

  // ── Connection validation ──

  const isValidConnection = useCallback((conn: Connection | Edge) => {
    // No self-connections
    if (conn.source === conn.target) return false;
    // No circular source→target duplications
    const existing = edges.some(
      (e) => e.source === conn.source && e.target === conn.target,
    );
    if (existing) return false;
    // Start nodes cannot have incoming connections
    const targetNode = nodes.find((n) => n.id === conn.target);
    if (targetNode?.type === 'start') return false;
    // End nodes cannot have outgoing connections
    const sourceNode = nodes.find((n) => n.id === conn.source);
    if (sourceNode?.type === 'end') return false;
    return true;
  }, [edges, nodes]);

  // ── Connect ──

  const handleConnect: OnConnect = useCallback(
    (connection) => {
      if (!editable) return;
      setEdges((eds) => {
        const updated = addEdge(
          { ...connection, ...defaultEdgeOptions },
          eds as Edge[],
        ) as CanvasEdge[];
        syncToParent([...nodes], updated as CanvasEdge[]);
        return updated;
      });
    },
    [editable, setEdges, nodes, syncToParent],
  );

  // ── Reconnect ──

  const handleReconnect: OnReconnect = useCallback(
    (oldEdge, newConnection) => {
      if (!editable) return;
      setEdges((eds) => {
        const updated = reconnectEdge(oldEdge, newConnection, eds as Edge[]) as CanvasEdge[];
        syncToParent([...nodes], updated as CanvasEdge[]);
        return updated;
      });
    },
    [editable, setEdges, nodes, syncToParent],
  );

  // ── Delete ──

  const handleNodesDelete = useCallback(
    (deleted: Node[]) => {
      if (!editable) return;
      // Remove edges connected to deleted nodes
      const deletedIds = new Set(deleted.map((n) => n.id));
      setEdges((eds) => {
        const filtered = eds.filter(
          (e) => !deletedIds.has(e.source) && !deletedIds.has(e.target),
        );
        syncToParent(
          nodes.filter((n) => !deletedIds.has(n.id)),
          filtered as CanvasEdge[],
        );
        return filtered;
      });
      setNodes((nds) => nds.filter((n) => !deletedIds.has(n.id)));
      onNodeClick?.(null);
    },
    [editable, setNodes, setEdges, nodes, syncToParent, onNodeClick],
  );

  // ── Click / Select ──

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      setContextMenu(null);
      onNodeClick?.(node.id);
    },
    [onNodeClick],
  );

  const handlePaneClick = useCallback(() => {
    setContextMenu(null);
    onNodeClick?.(null);
  }, [onNodeClick]);

  // ── Context menu ──

  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      if (!editable) return;

      const target = event.target as HTMLElement;
      const nodeEl = target.closest('.react-flow__node') as HTMLElement | null;
      const edgeEl = target.closest('.react-flow__edge') as HTMLElement | null;

      // xyflow nodes carry data-id from the node ID
      const nodeId = nodeEl?.getAttribute('data-id') ?? null;
      const edgePath = edgeEl?.querySelector('.react-flow__edge-path') as HTMLElement | null;
      const edgeId = edgePath?.getAttribute('data-id') ?? null;

      if (!reactFlowInstance) return;

      const panePos = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        flowPosition: panePos,
        nodeId,
        edgeId: edgeId ?? undefined,
      });
    },
    [editable, reactFlowInstance],
  );

  const handleContextAction = useCallback(
    (action: string) => {
      if (!reactFlowInstance || !contextMenu) return;

      switch (action) {
        case 'delete-node': {
          if (contextMenu.nodeId) {
            handleNodesDelete([{ id: contextMenu.nodeId } as Node]);
          }
          break;
        }
        case 'duplicate-node': {
          if (contextMenu.nodeId) {
            const src = nodes.find((n) => n.id === contextMenu.nodeId);
            if (src) {
              const newId = nextNodeId(src.type!);
              const newNode: CanvasNode = {
                ...src,
                id: newId,
                position: { x: src.position.x + 50, y: src.position.y + 50 },
                selected: false,
              };
              setNodes((nds) => {
                const updated = [...nds, newNode];
                syncToParent(updated, [...edges]);
                return updated;
              });
            }
          }
          break;
        }
        case 'delete-edge': {
          if (contextMenu.edgeId) {
            setEdges((eds) => {
              const filtered = eds.filter((e) => e.id !== contextMenu.edgeId);
              syncToParent([...nodes], filtered as CanvasEdge[]);
              return filtered;
            });
          }
          break;
        }
        case 'add-node': {
          const type = contextMenu.nodeType as CanvasNodeType;
          if (type && onNodeAdd) {
            onNodeAdd(type, contextMenu.flowPosition);
          }
          break;
        }
        case 'group-into-agent': {
          // Create AgentGroup and set parentId for selected nodes
          const selectedNodeIds = nodes.filter((n) => n.selected).map((n) => n.id);
          if (selectedNodeIds.length > 0 && onGroupNodes) {
            const groupId = `agentGroup_${Date.now()}`;
            onGroupNodes(selectedNodeIds, groupId);
          }
          break;
        }
        case 'fit-view': {
          reactFlowInstance.fitView({ padding: 0.3, duration: 300 });
          break;
        }
      }
      setContextMenu(null);
    },
    [reactFlowInstance, contextMenu, nodes, edges, setNodes, setEdges, syncToParent, handleNodesDelete, onNodeAdd],
  );

  // ── Drag & Drop from palette ──

  const handleDragOver = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    },
    [],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      if (!editable || !reactFlowInstance || !onNodeAdd) return;

      const type = event.dataTransfer.getData('application/reactflow-type') as CanvasNodeType;
      if (!type || !CANVAS_NODE_TYPES.includes(type)) return;

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      onNodeAdd(type, position);
    },
    [editable, reactFlowInstance, onNodeAdd],
  );

  // ── Group containment on drag stop ──

  const handleNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (!editable) return;
      const groups = nodes.filter((n) => n.type === 'agentGroup');
      if (groups.length === 0) return;

      // Check if node center is inside any group
      const nodeCenter = {
        x: node.position.x + ((node as any).width ?? 180) / 2,
        y: node.position.y + ((node as any).height ?? 60) / 2,
      };

      for (const group of groups) {
        const gx = group.position.x;
        const gy = group.position.y;
        const gw = (group as any).width ?? 300;
        const gh = (group as any).height ?? 140;

        if (nodeCenter.x > gx && nodeCenter.x < gx + gw && nodeCenter.y > gy + 30 && nodeCenter.y < gy + gh) {
          // Node is inside group
          if (node.parentId !== group.id) {
            setNodes((nds) => {
              const updated = nds.map((n) =>
                n.id === node.id ? { ...n, parentId: group.id, extent: 'parent' as const } : n,
              );
              syncToParent(updated as CanvasNode[], [...edges]);
              return updated;
            });
          }
          return;
        }
      }
      // Node is outside all groups — remove parent
      if (node.parentId) {
        setNodes((nds) => {
          const updated = nds.map((n) =>
            n.id === node.id ? { ...n, parentId: undefined, extent: undefined } : n,
          );
          syncToParent(updated as CanvasNode[], [...edges]);
          return updated;
        });
      }
    },
    [editable, nodes, edges, setNodes, syncToParent],
  );

  // ── Keyboard ──

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!editable) return;
      // Ctrl+Z / Ctrl+Y handled by useUndoRedo in parent
      if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
        // Select all handled by xyflow internally
      }
    },
    [editable],
  );

  return (
    <div className="h-full w-full" onKeyDown={handleKeyDown} tabIndex={0}>
      <ReactFlow
        nodes={nodes}
        edges={edges as Edge[]}
        onNodesChange={editable ? (onNodesChangeInternal as any) : undefined}
        onEdgesChange={editable ? (onEdgesChangeInternal as any) : undefined}
        onConnect={handleConnect}
        onReconnect={handleReconnect}
        onNodesDelete={handleNodesDelete}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        onContextMenu={handleContextMenu}
        onInit={setReactFlowInstance}
        onNodeDragStop={handleNodeDragStop}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        isValidConnection={isValidConnection}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        deleteKeyCode={editable ? ['Delete', 'Backspace'] : null}
        multiSelectionKeyCode="Shift"
        selectionMode={SelectionMode.Partial}
        snapToGrid
        snapGrid={[15, 15]}
        selectNodesOnDrag={false}
        className="bg-surface-primary"
        minZoom={0.1}
        maxZoom={2}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="var(--graph-bg-grid, #ccc)"
        />
        <Controls
          className="[&>button]:bg-surface-primary [&>button]:border-border [&>button]:text-content-primary [&>button]:rounded-sm [&>button]:shadow-xs"
          showInteractive={false}
        />
        <MiniMap
          nodeStrokeColor="var(--border-color)"
          nodeColor="var(--surface-elevated)"
          maskColor="var(--graph-minimap-mask, rgba(0,0,0,0.1))"
          className="!bg-surface-elevated rounded-lg border border-border"
          pannable
          zoomable
        />
      </ReactFlow>

      {contextMenu && (
        <CanvasContextMenu
          state={contextMenu}
          onAction={handleContextAction}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
