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
  skill: 'bg-accent-muted border-accent text-accent',
  condition: 'bg-intent-warning-muted border-intent-warning text-intent-warning',
  parallel:
    'bg-intent-purple-muted border-intent-purple text-intent-purple',
  human: 'bg-intent-success-muted border-intent-success text-intent-success',
};

export function WorkflowCanvas({
  workflow,
  onRun,
  onSave,
  onAddNode,
  onDeleteNode,
  onConnect,
  editable = false,
}: WorkflowCanvasProps) {
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
    <div className="rounded-lg border bg-surface-primary p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-content-primary">{workflow.name}</h3>
          <span
            className={`rounded px-2 py-0.5 text-xs ${
              workflow.status === 'active'
                ? 'bg-intent-success-muted text-intent-success'
                : workflow.status === 'failed'
                  ? 'bg-intent-danger-muted text-intent-danger'
                  : 'bg-surface-muted text-content-secondary'
            }`}
          >
            {workflow.status} | {workflow.nodes.length} nodes | {workflow.edges.length} edges
          </span>
        </div>
        <div className="flex gap-2">
          {editable && onAddNode && (
            <div className="flex gap-1">
              {['skill', 'condition', 'human'].map((type) => (
                <button
                  key={type}
                  onClick={() => onAddNode(type)}
                  className="rounded border px-2 py-1 text-xs hover:bg-surface-elevated"
                >
                  +{type}
                </button>
              ))}
            </div>
          )}
          {onSave && editable && (
            <button
              onClick={() => onSave(workflow)}
              className="rounded bg-intent-success px-3 py-1.5 text-sm text-content-inverse hover:bg-intent-success"
            >
              Save
            </button>
          )}
          {onRun && (
            <button
              onClick={() => onRun(workflow.id)}
              className="rounded bg-accent px-4 py-1.5 text-sm text-content-inverse hover:bg-accent-hover"
            >
              Run
            </button>
          )}
        </div>
      </div>

      {linkFrom && (
        <div className="mb-2 text-xs text-accent">
          Linking from: {linkFrom} — click a target node to connect
          <button onClick={() => setLinkFrom(null)} className="ml-2 text-intent-danger">
            Cancel
          </button>
        </div>
      )}

      {/* Node grid */}
      <div className="mb-4 flex flex-wrap gap-3">
        {workflow.nodes.map((node) => (
          <div
            key={node.id}
            onClick={() => handleNodeClick(node.id)}
            className={`relative cursor-pointer rounded-lg border-2 px-4 py-2 text-sm font-medium transition-all ${
              nodeTypeColors[node.type] ?? 'bg-surface-muted'
            } ${selectedNode === node.id ? 'ring-2 ring-accent' : ''} ${linkFrom === node.id ? 'ring-2 ring-intent-warning' : ''}`}
          >
            <div className="text-xs uppercase opacity-60">{node.type}</div>
            <div>{node.title ?? node.skillId ?? node.id}</div>
            {editable && (
              <div className="mt-1 flex gap-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStartLink(node.id);
                  }}
                  className="text-xs text-accent hover:underline"
                >
                  Link
                </button>
                {onDeleteNode && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteNode(node.id);
                    }}
                    className="text-xs text-intent-danger hover:underline"
                  >
                    Del
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Edge list */}
      <div className="border-t border-border pt-3">
        <div className="mb-2 text-xs text-content-tertiary">
          Connections ({workflow.edges.length})
        </div>
        {workflow.edges.map((edge, i) => (
          <div key={i} className="flex items-center gap-2 text-xs text-content-tertiary">
            <span className="font-mono">{edge.from}</span>
            <span>→</span>
            <span className="font-mono">{edge.to}</span>
            {edge.condition && (
              <span className="text-intent-warning">[if: {edge.condition}]</span>
            )}
          </div>
        ))}
        {workflow.edges.length === 0 && (
          <p className="text-xs text-content-tertiary">
            No connections yet. {editable ? 'Click "Link" on a node to start.' : ''}
          </p>
        )}
      </div>
    </div>
  );
}
