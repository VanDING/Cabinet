import type { WorkflowNode, WorkflowEdge } from '@cabinet/types';

export interface WorkflowCanvasProps {
  workflow: {
    id: string;
    name: string;
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
    status: string;
  };
  onRun?: (id: string) => void;
}

const nodeTypeColors: Record<string, string> = {
  skill: 'bg-blue-100 border-blue-400 text-blue-800',
  condition: 'bg-amber-100 border-amber-400 text-amber-800',
  parallel: 'bg-purple-100 border-purple-400 text-purple-800',
  human: 'bg-green-100 border-green-400 text-green-800',
};

export function WorkflowCanvas({ workflow, onRun }: WorkflowCanvasProps) {
  return (
    <div className="border rounded-lg bg-white p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-gray-900">{workflow.name}</h3>
          <span className={`text-xs px-2 py-0.5 rounded ${
            workflow.status === 'active' ? 'bg-green-100 text-green-700' :
            workflow.status === 'failed' ? 'bg-red-100 text-red-700' :
            'bg-gray-100 text-gray-600'
          }`}>
            {workflow.status}
          </span>
        </div>
        {onRun && (
          <button onClick={() => onRun(workflow.id)}
            className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">
            Run
          </button>
        )}
      </div>

      {/* Simple node visualization */}
      <div className="flex flex-wrap gap-3">
        {workflow.nodes.map(node => (
          <div key={node.id}
            className={`border-2 rounded-lg px-4 py-2 text-sm font-medium ${nodeTypeColors[node.type] ?? 'bg-gray-100'}`}>
            <div className="text-xs opacity-60 uppercase">{node.type}</div>
            <div>{node.title ?? node.skillId ?? node.id}</div>
          </div>
        ))}
      </div>

      {/* Edge list */}
      <div className="mt-4 pt-3 border-t">
        <div className="text-xs text-gray-400 mb-2">Edges ({workflow.edges.length})</div>
        {workflow.edges.map((edge, i) => (
          <div key={i} className="text-xs text-gray-500">
            {edge.from} → {edge.to} {edge.condition ? `[if: ${edge.condition}]` : ''}
          </div>
        ))}
      </div>
    </div>
  );
}
