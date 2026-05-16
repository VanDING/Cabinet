import { useState, useEffect, useCallback } from 'react';
import { useTheme } from '../hooks/useTheme';
import { WorkflowEditor } from '../components/workflow/WorkflowEditor';
import { useToast } from '../components/Toast';
import { apiFetch, authHeaders, authJsonHeaders } from '../utils/pin.js';

interface WorkflowItem {
  id: string;
  name: string;
  nodes: any[];
  edges: any[];
  status: string;
}

export function FactoryPage() {
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState<WorkflowItem | null>(null);
  const { addToast } = useToast();
  const { isDark } = useTheme();

  const fetchWorkflows = useCallback(() => {
    apiFetch('/api/factory', { headers: authHeaders() })
      .then(res => res.json())
      .then(data => { if (data.workflows) setWorkflows(data.workflows); })
      .catch(() => { addToast('error', 'Failed to load workflows'); });
  }, [addToast]);

  useEffect(() => { fetchWorkflows(); }, [fetchWorkflows]);

  const handleSave = async (name: string, nodes: any[], edges: any[]) => {
    const definition = { nodes, edges };
    try {
      if (editingWorkflow) {
        await apiFetch(`/api/factory/${editingWorkflow.id}`, {
          method: 'PUT',
          headers: authJsonHeaders(),
          body: JSON.stringify({ name, definition }),
        });
        addToast('success', `Workflow "${name}" updated`);
      } else {
        const res = await apiFetch('/api/factory', {
          method: 'POST',
          headers: authJsonHeaders(),
          body: JSON.stringify({ name, definition, projectId: 'default' }),
        });
        const data = await res.json();
        addToast('success', `Workflow "${name}" created`);
      }
      fetchWorkflows();
      setEditorOpen(false);
      setEditingWorkflow(null);
    } catch {
      addToast('error', 'Failed to save workflow');
    }
  };

  const handleExecute = async (nodes: any[], edges: any[]) => {
    if (!editingWorkflow) {
      addToast('error', 'Save the workflow first');
      return;
    }
    try {
      await apiFetch(`/api/factory/${editingWorkflow.id}/run`, {
        method: 'POST',
        headers: authJsonHeaders(),
      });
      addToast('success', `Workflow "${editingWorkflow.name}" started`);
      fetchWorkflows();
    } catch {
      addToast('error', 'Failed to run workflow');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this workflow?')) return;
    try {
      await apiFetch(`/api/factory/${id}`, { method: 'DELETE', headers: authHeaders() });
      setWorkflows(prev => prev.filter(w => w.id !== id));
      addToast('success', 'Workflow deleted');
    } catch {
      addToast('error', 'Failed to delete workflow');
    }
  };

  if (editorOpen) {
    return (
      <div className="h-full">
        <WorkflowEditor
          initialNodes={editingWorkflow?.nodes}
          initialEdges={editingWorkflow?.edges}
          workflowName={editingWorkflow?.name}
          onSave={handleSave}
          onExecute={handleExecute}
          isDark={isDark}
        />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Factory</h1>
          <span className="text-sm text-gray-500 dark:text-gray-400">Create workflows to automate multi-step AI processes.</span>
        </div>
        <button
          onClick={() => { setEditingWorkflow(null); setEditorOpen(true); }}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
          + New Workflow
        </button>
      </div>

      {workflows.length === 0 ? (
        <div className="text-center text-gray-400 dark:text-gray-500 py-24">
          <p className="text-lg">No workflows yet</p>
          <p className="text-sm mt-1">Click "+ New Workflow" to create your first workflow.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {workflows.map(wf => (
            <div key={wf.id}
              className={`border rounded-lg p-4 flex items-center justify-between transition-colors ${
                isDark ? 'bg-gray-800 border-gray-700 hover:bg-gray-750' : 'bg-white border-gray-200 hover:bg-gray-50'
              }`}
            >
              <div>
                <div className="flex items-center gap-2">
                  <h3 className={`font-medium text-sm ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>{wf.name}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    wf.status === 'running' ? 'bg-blue-100 text-blue-700' :
                    wf.status === 'completed' ? 'bg-green-100 text-green-700' :
                    wf.status === 'failed' ? 'bg-red-100 text-red-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>{wf.status}</span>
                </div>
                <p className={`text-xs mt-0.5 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  {wf.nodes?.length || 0} nodes &middot; {wf.edges?.length || 0} connections &middot; ID: {wf.id}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { setEditingWorkflow(wf); setEditorOpen(true); }}
                  className={`px-3 py-1 text-xs rounded border transition-colors ${isDark ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-300 text-gray-600 hover:bg-gray-100'}`}>
                  Edit
                </button>
                {wf.status === 'draft' && (
                  <button
                    onClick={() => {
                      setEditingWorkflow(wf);
                      apiFetch(`/api/factory/${wf.id}/run`, {
                        method: 'POST',
                        headers: authJsonHeaders(),
                      });
                      addToast('success', `Workflow "${wf.name}" started`);
                      setTimeout(fetchWorkflows, 2000);
                    }}
                    className="px-3 py-1 text-xs rounded bg-green-600 text-white hover:bg-green-700 transition-colors">
                    Run
                  </button>
                )}
                <button
                  onClick={() => handleDelete(wf.id)}
                  className="px-3 py-1 text-xs rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
