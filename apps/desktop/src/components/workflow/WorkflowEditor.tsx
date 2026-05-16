import { useState, useCallback } from 'react';
import {
  ReactFlow,
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
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { nodeTypes, nodePalette } from './nodes';

interface RunStep {
  nodeId: string;
  type: string;
  output: string;
}

interface RunResult {
  runId: string;
  workflowId: string;
  status: string;
  steps: RunStep[];
}

interface Props {
  initialNodes?: Node[];
  initialEdges?: Edge[];
  workflowName?: string;
  onSave?: (name: string, nodes: Node[], edges: Edge[]) => void;
  onExecute?: (nodes: Node[], edges: Edge[]) => void;
  isDark?: boolean;
  /** Server-side execution — called with nodes/edges, returns run result. */
  onExecuteRemote?: (nodes: Node[], edges: Edge[]) => Promise<RunResult>;
}

export function WorkflowEditor({
  initialNodes,
  initialEdges,
  workflowName = '',
  onSave,
  onExecute,
  onExecuteRemote,
  isDark,
}: Props) {
  const defaultNodes = initialNodes ?? [
    { id: 'start', type: 'start', position: { x: 250, y: 0 }, data: { label: 'Start' } },
  ];
  const [nodes, setNodes, onNodesChange] = useNodesState(defaultNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges ?? []);
  const [name, setName] = useState(workflowName);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [showPalette, setShowPalette] = useState(true);

  // Execution state
  const [executing, setExecuting] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [approvalNode, setApprovalNode] = useState<{ nodeId: string; decisionId: string } | null>(null);
  const [approving, setApproving] = useState(false);

  // Derive node status from run result
  const nodeStatus = useCallback(
    (nodeId: string): 'idle' | 'running' | 'completed' | 'failed' => {
      if (!runResult) return 'idle';
      const step = runResult.steps.find((s) => s.nodeId === nodeId);
      if (!step) return 'idle';
      if (step.type === 'humanApproval' && step.output.includes('pending')) return 'running';
      if (step.output.includes('Error')) return 'failed';
      return 'completed';
    },
    [runResult],
  );

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge({ ...params, animated: true }, eds)),
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
      const wrapper = document.querySelector('.react-flow__viewport');
      if (!wrapper) return;
      const bounds = wrapper.getBoundingClientRect();
      const transformMatch = wrapper.getAttribute('style')?.match(/translate\(([^)]+)\)/);
      let tx = 0, ty = 0;
      const matched = transformMatch?.[1];
      if (matched) {
        const parts = matched.split(',').map((s) => parseFloat(s.trim()));
        tx = parts[0] || 0;
        ty = parts[1] || 0;
      }
      const position = {
        x: event.clientX - bounds.left - tx - 80,
        y: event.clientY - bounds.top - ty - 20,
      };
      const paletteEntry = nodePalette.find((p) => p.type === type);
      const newNode: Node = {
        id: `${type}_${Date.now()}`,
        type,
        position,
        data: { label: paletteEntry?.label || type },
      };
      setNodes((nds) => [...nds, newNode]);
    },
    [setNodes],
  );

  const handleNodeClick = useCallback((_: any, node: Node) => {
    setSelectedNode(node);
  }, []);

  const handleConfigChange = useCallback(
    (id: string, config: NodeConfig) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...config } } : n)),
      );
    },
    [setNodes],
  );

  const handleSave = () => {
    onSave?.(name || 'Untitled', nodes, edges);
  };

  const handleExecute = async () => {
    if (onExecuteRemote) {
      setExecuting(true);
      setRunResult(null);
      setShowLog(true);
      try {
        const result = await onExecuteRemote(nodes, edges);
        setRunResult(result);
        // Check for approval needed
        const approval = result.steps.find(
          (s) => s.type === 'humanApproval' && s.output.includes('pending'),
        );
        if (approval) {
          const decisionId = approval.output.match(/decision (dec_\d+)/)?.[1];
          if (decisionId) {
            setApprovalNode({ nodeId: approval.nodeId, decisionId });
          }
        }
      } catch (e: any) {
        setRunResult({ runId: '', workflowId: '', status: 'failed', steps: [{ nodeId: '', type: 'error', output: e.message }] });
      } finally {
        setExecuting(false);
      }
    } else {
      onExecute?.(nodes, edges);
    }
  };

  const handleApprove = async (decisionId: string, approved: boolean) => {
    setApproving(true);
    try {
      const { apiFetch, authJsonHeaders } = await import('../../utils/pin.js');
      const endpoint = approved
        ? `/api/decisions/${decisionId}/approve`
        : `/api/decisions/${decisionId}/reject`;
      await apiFetch(endpoint, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({ chosenOptionId: approved ? 'approve_continue' : 'reject_terminate' }),
      });
    } catch { /* ignore */ }
    setApproving(false);
    setApprovalNode(null);
  };

  const styledNodes = nodes.map((n) => {
    const status = nodeStatus(n.id);
    let borderColor: string | undefined;
    let shadow: string | undefined;
    if (status === 'running') { borderColor = '#3b82f6'; shadow = '0 0 8px rgba(59,130,246,0.5)'; }
    else if (status === 'completed') borderColor = '#22c55e';
    else if (status === 'failed') borderColor = '#ef4444';

    return {
      ...n,
      style: {
        ...(n.style as Record<string, unknown> ?? {}),
        ...(borderColor ? { border: `2px solid ${borderColor}` } : {}),
        ...(shadow ? { boxShadow: shadow } : {}),
        ...(status === 'running' ? { animation: 'pulse 1.5s infinite' } : {}),
      },
    };
  });

  const nodeColor = useCallback((node: Node) => {
    const status = nodeStatus(node.id);
    if (status === 'running') return '#3b82f6';
    if (status === 'completed') return '#22c55e';
    if (status === 'failed') return '#ef4444';
    const entry = nodePalette.find((p) => p.type === node.type);
    return entry?.color ?? '#6b7280';
  }, [nodeStatus]);

  return (
    <div className={`flex h-full ${isDark ? 'bg-gray-900' : 'bg-gray-100'}`}>
      {showPalette && (
        <div className={`w-48 flex-shrink-0 overflow-y-auto border-r p-3 ${isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'}`}>
          <div className="mb-3 flex items-center justify-between">
            <h3 className={`text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Nodes</h3>
            <button onClick={() => setShowPalette(false)} className="text-xs text-gray-400 hover:text-gray-600">&times;</button>
          </div>
          <div className="space-y-1.5">
            {nodePalette.map((p) => (
              <div
                key={p.type}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/reactflow-type', p.type);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                className={`flex cursor-grab items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors active:cursor-grabbing ${
                  isDark ? 'border-gray-700 text-gray-300 hover:bg-gray-700' : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span className="text-sm">{p.icon}</span>
                <span className="font-medium">{p.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className={`flex flex-shrink-0 items-center gap-2 border-b px-4 py-2 ${isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'}`}>
          {!showPalette && (
            <button onClick={() => setShowPalette(true)} className={`rounded border px-2 py-1 text-xs transition-colors ${isDark ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-300 text-gray-600 hover:bg-gray-100'}`}>
              &#9776; Nodes
            </button>
          )}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Workflow name..."
            className={`flex-1 rounded border bg-transparent px-2 py-1 text-sm ${isDark ? 'border-gray-600 text-gray-200 placeholder-gray-500' : 'border-gray-300 text-gray-700 placeholder-gray-400'}`}
          />
          <button onClick={handleSave} className="rounded bg-blue-600 px-3 py-1 text-xs text-white transition-colors hover:bg-blue-700">Save</button>
          <button
            onClick={handleExecute}
            disabled={executing}
            className="rounded bg-green-600 px-3 py-1 text-xs text-white transition-colors hover:bg-green-700 disabled:opacity-50"
          >
            {executing ? 'Running...' : 'Run'}
          </button>
          {runResult && (
            <button
              onClick={() => setShowLog(!showLog)}
              className={`rounded border px-2 py-1 text-xs transition-colors ${isDark ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-300 text-gray-600 hover:bg-gray-100'}`}
            >
              {showLog ? 'Hide Log' : 'Log'}
            </button>
          )}
          <button onClick={() => { setSelectedNode(null); setRunResult(null); }} className={`rounded border px-2 py-1 text-xs transition-colors ${isDark ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-300 text-gray-600 hover:bg-gray-100'}`}>
            Clear
          </button>
        </div>

        <div className="flex-1">
          <ReactFlow
            nodes={styledNodes}
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
            <MiniMap nodeColor={nodeColor} style={isDark ? { backgroundColor: '#1f2937' } : undefined} maskColor={isDark ? 'rgba(0,0,0,0.5)' : undefined} />
            {executing && (
              <Panel position="top-center">
                <div className="rounded-full bg-blue-600 px-4 py-1.5 text-xs text-white shadow-lg">Executing workflow...</div>
              </Panel>
            )}
          </ReactFlow>
        </div>

        {/* Log panel (bottom) */}
        {showLog && runResult && (
          <div className={`flex-shrink-0 border-t ${isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'}`} style={{ maxHeight: '30%', overflowY: 'auto' }}>
            <div className={`flex items-center justify-between px-4 py-2 ${isDark ? 'border-b border-gray-700' : 'border-b border-gray-200'}`}>
              <span className={`text-xs font-semibold ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                Execution Log — {runResult.status}
              </span>
              <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{runResult.steps.length} steps</span>
            </div>
            <div className="space-y-0">
              {runResult.steps.map((step, i) => {
                const isError = step.output.includes('Error');
                const isPending = step.type === 'humanApproval' && step.output.includes('pending');
                return (
                  <div key={i} className={`flex items-start gap-3 px-4 py-2 text-xs ${i % 2 === 0 ? (isDark ? 'bg-gray-800/50' : 'bg-white/50') : ''}`}>
                    <span className={`mt-0.5 w-16 flex-shrink-0 rounded px-1 py-0.5 text-center font-mono text-[10px] ${
                      isDark ? 'bg-gray-700 text-gray-400' : 'bg-gray-200 text-gray-600'
                    }`}>{step.nodeId || 'system'}</span>
                    <span className={`w-20 flex-shrink-0 rounded px-1 py-0.5 text-center font-mono text-[10px] ${
                      isError ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' :
                      isPending ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' :
                      'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                    }`}>{step.type}</span>
                    <span className={`flex-1 truncate ${isError ? 'text-red-600 dark:text-red-400' : isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                      {step.output.length > 120 ? step.output.slice(0, 120) + '...' : step.output}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Node config panel */}
      {selectedNode && (
        <NodeConfigPanelContent
          node={selectedNode}
          onChange={(config) => handleConfigChange(selectedNode.id, config)}
          onClose={() => setSelectedNode(null)}
          isDark={isDark}
        />
      )}

      {/* Approval popup */}
      {approvalNode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className={`w-full max-w-sm rounded-xl p-6 shadow-2xl ${isDark ? 'bg-gray-800 border border-gray-700' : 'bg-white'}`}>
            <h3 className={`text-lg font-semibold mb-2 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>Approval Required</h3>
            <p className={`text-sm mb-4 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
              Workflow is waiting for approval at node: <strong>{approvalNode.nodeId}</strong>
            </p>
            <p className={`text-xs mb-4 font-mono ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              Decision: {approvalNode.decisionId}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => handleApprove(approvalNode.decisionId, true)}
                disabled={approving}
                className="flex-1 rounded bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700 disabled:opacity-50"
              >
                {approving ? '...' : 'Approve & Continue'}
              </button>
              <button
                onClick={() => handleApprove(approvalNode.decisionId, false)}
                disabled={approving}
                className="flex-1 rounded bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-50"
              >
                {approving ? '...' : 'Reject & Stop'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Node config panel ──
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
  const data = (node.data || {}) as Record<string, string | undefined>;
  const type = node.type || '';

  return (
    <div className={`w-64 flex-shrink-0 overflow-y-auto border-l p-4 ${isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'}`}>
      <div className="mb-4 flex items-center justify-between">
        <h3 className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>Node Config</h3>
        <button onClick={onClose} className="text-lg leading-none text-gray-400 hover:text-gray-600">&times;</button>
      </div>
      <div className="space-y-3">
        <div>
          <label className={`mb-1 block text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Type</label>
          <p className={`font-mono text-xs font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{type}</p>
        </div>
        <div>
          <label className={`mb-1 block text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Label</label>
          <input value={data.label || ''} onChange={(e) => onChange({ label: e.target.value })}
            className={`w-full rounded border px-2 py-1 text-xs ${isDark ? 'border-gray-600 bg-gray-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'}`} />
        </div>
        {(type === 'aiAgent' || type === 'llmCall') && (
          <>
            <div>
              <label className={`mb-1 block text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Model</label>
              <select value={data.model || 'claude-sonnet-4-6'} onChange={(e) => onChange({ model: e.target.value })}
                className={`w-full rounded border px-2 py-1 text-xs ${isDark ? 'border-gray-600 bg-gray-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'}`}>
                <option value="claude-haiku-4-5">Haiku 4.5</option>
                <option value="claude-sonnet-4-6">Sonnet 4.6</option>
                <option value="claude-opus-4-7">Opus 4.7</option>
                <option value="gpt-4o">GPT-4o</option>
                <option value="gpt-4o-mini">GPT-4o Mini</option>
              </select>
            </div>
            <div>
              <label className={`mb-1 block text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Prompt</label>
              <textarea value={data.prompt || ''} onChange={(e) => onChange({ prompt: e.target.value })} rows={3}
                className={`w-full resize-none rounded border px-2 py-1 text-xs ${isDark ? 'border-gray-600 bg-gray-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'}`}
                placeholder="System prompt or instruction..." />
            </div>
          </>
        )}
        {type === 'humanApproval' && (
          <div>
            <label className={`mb-1 block text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Reviewer</label>
            <input value={data.role || 'Captain'} onChange={(e) => onChange({ role: e.target.value })}
              className={`w-full rounded border px-2 py-1 text-xs ${isDark ? 'border-gray-600 bg-gray-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'}`} />
          </div>
        )}
        {type === 'condition' && (
          <div>
            <label className={`mb-1 block text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Condition</label>
            <textarea value={data.condition || ''} onChange={(e) => onChange({ condition: e.target.value })} rows={2}
              className={`w-full resize-none rounded border px-2 py-1 text-xs ${isDark ? 'border-gray-600 bg-gray-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'}`}
              placeholder="e.g. response contains 'approved'" />
          </div>
        )}
        {type === 'dataQuery' && (
          <div>
            <label className={`mb-1 block text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Query</label>
            <textarea value={data.query || ''} onChange={(e) => onChange({ query: e.target.value })} rows={2}
              className={`w-full resize-none rounded border px-2 py-1 text-xs ${isDark ? 'border-gray-600 bg-gray-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'}`}
              placeholder="SQL or search query..." />
          </div>
        )}
        {type === 'notification' && (
          <div>
            <label className={`mb-1 block text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Message</label>
            <textarea value={data.message || ''} onChange={(e) => onChange({ message: e.target.value })} rows={2}
              className={`w-full resize-none rounded border px-2 py-1 text-xs ${isDark ? 'border-gray-600 bg-gray-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'}`}
              placeholder="Notification text..." />
          </div>
        )}
        {type === 'wait' && (
          <div>
            <label className={`mb-1 block text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Duration</label>
            <input value={data.duration || '5s'} onChange={(e) => onChange({ duration: e.target.value })}
              className={`w-full rounded border px-2 py-1 text-xs ${isDark ? 'border-gray-600 bg-gray-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'}`}
              placeholder="e.g. 5s, 1m" />
          </div>
        )}
      </div>
    </div>
  );
}
