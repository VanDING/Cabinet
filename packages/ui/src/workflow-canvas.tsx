import React, { useState } from 'react';

export interface WorkflowNodeItem {
  id: string;
  type: 'skill' | 'condition' | 'parallel' | 'human';
  skillId?: string;
  title?: string;
}

export interface WorkflowCanvasProps {
  workflow: {
    id: string;
    name: string;
    nodes: WorkflowNodeItem[];
    edges: { from: string; to: string; condition?: string }[];
    status: string;
  };
  onRun?: (id: string) => void;
  onSave?: (workflow: any) => void;
  onAddNode?: (type: string) => void;
  onDeleteNode?: (nodeId: string) => void;
  onConnect?: (from: string, to: string) => void;
  editable?: boolean;
}

const nodeTypeColors: Record<string, string> = {
  skill: 'bg-blue-100 border-blue-400 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  condition: 'bg-amber-100 border-amber-400 text-amber-800 dark:bg-amber-900 dark:text-amber-300',
  parallel: 'bg-purple-100 border-purple-400 text-purple-800 dark:bg-purple-900 dark:text-purple-300',
  human: 'bg-green-100 border-green-400 text-green-800 dark:bg-green-900 dark:text-green-300',
};

export function WorkflowCanvas({ workflow, onRun, onSave, onAddNode, onDeleteNode, onConnect, editable = false }: WorkflowCanvasProps) {
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);

  const handleNodeClick = (nodeId: string) => {
    if (linkFrom && nodeId !== linkFrom) {
      onConnect?.(linkFrom, nodeId);
      setLinkFrom(null);
    } else if (editable) {
      setSelectedNode(nodeId === selectedNode ? null : nodeId);
      setLinkFrom(null);
    }
  };

  const handleStartLink = (nodeId: string) => {
    setLinkFrom(nodeId === linkFrom ? null : nodeId);
  };

  return (
    <div className="border rounded-lg bg-white dark:bg-gray-800 p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">{workflow.name}</h3>
          <span className={`text-xs px-2 py-0.5 rounded ${
            workflow.status === 'active' ? 'bg-green-100 text-green-700' :
            workflow.status === 'failed' ? 'bg-red-100 text-red-700' :
            'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
          }`}>
            {workflow.status} | {workflow.nodes.length} nodes | {workflow.edges.length} edges
          </span>
        </div>
        <div className="flex gap-2">
          {editable && onAddNode && (
            <div className="flex gap-1">
              {['skill', 'condition', 'human'].map(type => (
                <button key={type} onClick={() => onAddNode(type)}
                  className="px-2 py-1 text-xs border rounded hover:bg-gray-50 dark:hover:bg-gray-700 dark:border-gray-600 dark:text-gray-300">
                  +{type}
                </button>
              ))}
            </div>
          )}
          {onSave && editable && (
            <button onClick={() => onSave(workflow)}
              className="px-3 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700">
              Save
            </button>
          )}
          {onRun && (
            <button onClick={() => onRun(workflow.id)}
              className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">
              Run
            </button>
          )}
        </div>
      </div>

      {linkFrom && (
        <div className="mb-2 text-xs text-blue-600 dark:text-blue-400">
          Linking from: {linkFrom} — click a target node to connect
          <button onClick={() => setLinkFrom(null)} className="ml-2 text-red-500">Cancel</button>
        </div>
      )}

      {/* Node grid */}
      <div className="flex flex-wrap gap-3 mb-4">
        {workflow.nodes.map(node => (
          <div key={node.id}
            onClick={() => handleNodeClick(node.id)}
            className={`relative border-2 rounded-lg px-4 py-2 text-sm font-medium cursor-pointer transition-all ${
              nodeTypeColors[node.type] ?? 'bg-gray-100'
            } ${selectedNode === node.id ? 'ring-2 ring-blue-500' : ''}
              ${linkFrom === node.id ? 'ring-2 ring-amber-500' : ''}`}
          >
            <div className="text-xs opacity-60 uppercase">{node.type}</div>
            <div>{node.title ?? node.skillId ?? node.id}</div>
            {editable && (
              <div className="flex gap-1 mt-1">
                <button onClick={(e) => { e.stopPropagation(); handleStartLink(node.id); }}
                  className="text-xs text-blue-500 hover:underline">Link</button>
                {onDeleteNode && (
                  <button onClick={(e) => { e.stopPropagation(); onDeleteNode(node.id); }}
                    className="text-xs text-red-500 hover:underline">Del</button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Edge list */}
      <div className="border-t dark:border-gray-700 pt-3">
        <div className="text-xs text-gray-400 dark:text-gray-500 mb-2">
          Connections ({workflow.edges.length})
        </div>
        {workflow.edges.map((edge, i) => (
          <div key={i} className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2">
            <span className="font-mono">{edge.from}</span>
            <span>→</span>
            <span className="font-mono">{edge.to}</span>
            {edge.condition && (
              <span className="text-amber-600 dark:text-amber-400">[if: {edge.condition}]</span>
            )}
          </div>
        ))}
        {workflow.edges.length === 0 && (
          <p className="text-xs text-gray-400">No connections yet. {editable ? 'Click "Link" on a node to start.' : ''}</p>
        )}
      </div>
    </div>
  );
}
