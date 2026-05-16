import { useState, useCallback, useMemo } from 'react';
import ReactFlow, {
  Controls,
  Background,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Node,
  type Edge,
  BackgroundVariant,
  Panel,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { nodeTypes, nodePalette } from './nodes';

interface Props {
  initialNodes?: Node[];
  initialEdges?: Edge[];
  workflowName?: string;
  onSave?: (name: string, nodes: Node[], edges: Edge[]) => void;
  onExecute?: (nodes: Node[], edges: Edge[]) => void;
  isDark?: boolean;
}

export function WorkflowEditor({ initialNodes, initialEdges, workflowName = '', onSave, onExecute, isDark }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes ?? [
    { id: 'start', type: 'start', position: { x: 250, y: 0 }, data: { label: 'Start' } },
  ]);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges ?? []);
  const [name, setName] = useState(workflowName);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [showPalette, setShowPalette] = useState(true);

  const onConnect = useCallback(
    (params: Connection) => setEdges(eds => addEdge({ ...params, animated: true }, eds)),
    [setEdges],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/reactflow-type');
      if (!type || !nodeTypes[type as keyof typeof nodeTypes]) return;

      // Use the ReactFlow viewport wrapper for coordinate calculation
      const wrapper = document.querySelector('.react-flow__viewport');
      if (!wrapper) return;
      const bounds = wrapper.getBoundingClientRect();

      // Account for the current viewport transform
      const transformMatch = wrapper.getAttribute('style')?.match(/translate\(([^)]+)\)/);
      let tx = 0, ty = 0;
      const matched = transformMatch?.[1];
      if (matched) {
        const parts = matched.split(',').map(s => parseFloat(s.trim()));
        tx = parts[0] || 0;
        ty = parts[1] || 0;
      }

      const position = {
        x: event.clientX - bounds.left - tx - 80,
        y: event.clientY - bounds.top - ty - 20,
      };
      const paletteEntry = nodePalette.find(p => p.type === type);
      const newNode: Node = {
        id: `${type}_${Date.now()}`,
        type,
        position,
        data: { label: paletteEntry?.label || type },
      };
      setNodes(nds => [...nds, newNode]);
    },
    [setNodes],
  );

  const handleNodeClick = useCallback((_: any, node: Node) => {
    setSelectedNode(node);
  }, []);

  const handleConfigChange = useCallback((id: string, config: NodeConfig) => {
    setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, ...config } } : n));
  }, [setNodes]);

  const handleSave = () => {
    onSave?.(name || 'Untitled', nodes, edges);
  };

  const handleExecute = () => {
    onExecute?.(nodes, edges);
  };

  const nodeColor = useCallback((node: Node) => {
    const entry = nodePalette.find(p => p.type === node.type);
    return entry?.color ?? '#6b7280';
  }, []);

  return (
    <div className={`flex h-full ${isDark ? 'bg-gray-900' : 'bg-gray-100'}`}>
      {/* Node palette (left side) */}
      {showPalette && (
        <div className={`w-48 flex-shrink-0 border-r p-3 overflow-y-auto ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className={`text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Nodes</h3>
            <button onClick={() => setShowPalette(false)} className="text-gray-400 hover:text-gray-600 text-xs">&times;</button>
          </div>
          <div className="space-y-1.5">
            {nodePalette.map(p => (
              <div
                key={p.type}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/reactflow-type', p.type);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-grab active:cursor-grabbing text-xs border transition-colors ${
                  isDark
                    ? 'border-gray-700 hover:bg-gray-700 text-gray-300'
                    : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                }`}
              >
                <span className="text-sm">{p.icon}</span>
                <span className="font-medium">{p.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main canvas */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className={`flex items-center gap-2 px-4 py-2 border-b flex-shrink-0 ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
          {!showPalette && (
            <button onClick={() => setShowPalette(true)}
              className={`px-2 py-1 text-xs rounded border transition-colors ${isDark ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-300 text-gray-600 hover:bg-gray-100'}`}>
              &#9776; Nodes
            </button>
          )}
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Workflow name..."
            className={`flex-1 px-2 py-1 text-sm border rounded bg-transparent ${isDark ? 'border-gray-600 text-gray-200 placeholder-gray-500' : 'border-gray-300 text-gray-700 placeholder-gray-400'}`}
          />
          <button onClick={handleSave}
            className="px-3 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors">Save</button>
          <button onClick={handleExecute}
            className="px-3 py-1 text-xs rounded bg-green-600 text-white hover:bg-green-700 transition-colors">Run</button>
          <button onClick={() => setSelectedNode(null)}
            className={`px-2 py-1 text-xs rounded border transition-colors ${isDark ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-300 text-gray-600 hover:bg-gray-100'}`}>
            Clear Selection
          </button>
        </div>

        {/* React Flow canvas */}
        <div className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={handleNodeClick}
            onDragOver={onDragOver}
            onDrop={onDrop}
            nodeTypes={nodeTypes as any}
            fitView
            deleteKeyCode={['Backspace', 'Delete']}
          >
            <Controls />
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} color={isDark ? '#374151' : '#e5e7eb'} />
            <MiniMap
              nodeColor={nodeColor}
              style={isDark ? { backgroundColor: '#1f2937' } : undefined}
              maskColor={isDark ? 'rgba(0,0,0,0.5)' : undefined}
            />
          </ReactFlow>
        </div>
      </div>

      {/* Node config panel (right side, shown when node selected) */}
      {selectedNode && (
        <NodeConfigPanelContent
          node={selectedNode}
          onChange={(config) => handleConfigChange(selectedNode.id, config)}
          onClose={() => setSelectedNode(null)}
          isDark={isDark}
        />
      )}
    </div>
  );
}

// ── Simple inline config panel ──
interface NodeConfigPanelContentProps {
  node: Node;
  onChange: (config: NodeConfig) => void;
  onClose: () => void;
  isDark?: boolean;
}

export interface NodeConfig {
  label?: string;
  model?: string;
  prompt?: string;
  role?: string;
  condition?: string;
  query?: string;
  message?: string;
  duration?: string;
}

function NodeConfigPanelContent({ node, onChange, onClose, isDark }: NodeConfigPanelContentProps) {
  const data = node.data || {};
  const type = node.type || '';

  return (
    <div className={`w-64 flex-shrink-0 border-l p-4 overflow-y-auto ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>Node Config</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
      </div>

      <div className="space-y-3">
        <div>
          <label className={`block text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Type</label>
          <p className={`text-xs font-mono font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{type}</p>
        </div>

        <div>
          <label className={`block text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Label</label>
          <input
            value={data.label || ''}
            onChange={e => onChange({ label: e.target.value })}
            className={`w-full border rounded px-2 py-1 text-xs ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-white border-gray-300 text-gray-700'}`}
          />
        </div>

        {(type === 'aiAgent' || type === 'llmCall') && (
          <>
            <div>
              <label className={`block text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Model</label>
              <select
                value={data.model || 'claude-sonnet-4-6'}
                onChange={e => onChange({ model: e.target.value })}
                className={`w-full border rounded px-2 py-1 text-xs ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-white border-gray-300 text-gray-700'}`}
              >
                <option value="claude-haiku-4-5">Claude Haiku 4.5</option>
                <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
                <option value="claude-opus-4-7">Claude Opus 4.7</option>
                <option value="gpt-4o">GPT-4o</option>
                <option value="gpt-4o-mini">GPT-4o Mini</option>
              </select>
            </div>
            <div>
              <label className={`block text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Prompt</label>
              <textarea
                value={data.prompt || ''}
                onChange={e => onChange({ prompt: e.target.value })}
                rows={3}
                className={`w-full border rounded px-2 py-1 text-xs resize-none ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-white border-gray-300 text-gray-700'}`}
                placeholder="System prompt or instruction..."
              />
            </div>
          </>
        )}

        {type === 'humanApproval' && (
          <div>
            <label className={`block text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Reviewer Role</label>
            <input
              value={data.role || 'Captain'}
              onChange={e => onChange({ role: e.target.value })}
              className={`w-full border rounded px-2 py-1 text-xs ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-white border-gray-300 text-gray-700'}`}
            />
          </div>
        )}

        {type === 'condition' && (
          <div>
            <label className={`block text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Condition Expression</label>
            <textarea
              value={data.condition || ''}
              onChange={e => onChange({ condition: e.target.value })}
              rows={2}
              className={`w-full border rounded px-2 py-1 text-xs resize-none ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-white border-gray-300 text-gray-700'}`}
              placeholder="e.g. response.contains('approved')"
            />
          </div>
        )}

        {(type === 'dataQuery') && (
          <div>
            <label className={`block text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Query</label>
            <textarea
              value={data.query || ''}
              onChange={e => onChange({ query: e.target.value })}
              rows={2}
              className={`w-full border rounded px-2 py-1 text-xs resize-none ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-white border-gray-300 text-gray-700'}`}
              placeholder="SQL or search query..."
            />
          </div>
        )}

        {(type === 'notification') && (
          <div>
            <label className={`block text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Message</label>
            <textarea
              value={data.message || ''}
              onChange={e => onChange({ message: e.target.value })}
              rows={2}
              className={`w-full border rounded px-2 py-1 text-xs resize-none ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-white border-gray-300 text-gray-700'}`}
              placeholder="Notification message..."
            />
          </div>
        )}

        {type === 'wait' && (
          <div>
            <label className={`block text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Duration</label>
            <input
              value={data.duration || '5s'}
              onChange={e => onChange({ duration: e.target.value })}
              className={`w-full border rounded px-2 py-1 text-xs ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-white border-gray-300 text-gray-700'}`}
              placeholder="e.g. 5s, 1m, 1h"
            />
          </div>
        )}
      </div>
    </div>
  );
}
