import { useState, useEffect, useCallback } from 'react';
import { useTheme } from '../hooks/useTheme';
import { WorkflowEditor } from '../components/workflow/WorkflowEditor';
import { useToast } from '../components/Toast';
import { apiFetch, authHeaders, authJsonHeaders } from '../utils/pin.js';

interface WorkflowItem {
  id: string;
  name: string;
  definition: { nodes: any[]; edges: any[] };
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
      .then((res) => res.json())
      .then((data) => {
        if (data.workflows) setWorkflows(data.workflows);
      })
      .catch(() => {
        addToast('error', 'Failed to load workflows');
      });
  }, [addToast]);

  useEffect(() => {
    fetchWorkflows();
  }, [fetchWorkflows]);

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
      setWorkflows((prev) => prev.filter((w) => w.id !== id));
      addToast('success', 'Workflow deleted');
    } catch {
      addToast('error', 'Failed to delete workflow');
    }
  };

  if (editorOpen) {
    return (
      <div className="h-full">
        <WorkflowEditor
          initialNodes={editingWorkflow?.definition?.nodes}
          initialEdges={editingWorkflow?.definition?.edges}
          workflowName={editingWorkflow?.name}
          onSave={handleSave}
          onExecute={handleExecute}
          onExecuteRemote={async (nodes, edges) => {
            if (!editingWorkflow) {
              addToast('error', 'Save the workflow first');
              throw new Error('Not saved');
            }
            const workflowId = editingWorkflow.id;
            const def = { nodes, edges };
            // Save first
            await apiFetch(`/api/factory/${workflowId}`, {
              method: 'PUT',
              headers: authJsonHeaders(),
              body: JSON.stringify({ name: editingWorkflow.name, definition: def }),
            });
            // Then run
            const res = await apiFetch(`/api/factory/${workflowId}/run`, {
              method: 'POST',
              headers: authJsonHeaders(),
            });
            if (!res.ok) {
              const err = await res.json().catch(() => ({ error: 'Unknown error' }));
              throw new Error(err.error ?? 'Execution failed');
            }
            const data = await res.json();
            return { runId: data.runId, workflowId: data.workflowId, status: data.status, steps: data.steps ?? [] };
          }}
          isDark={isDark}
        />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Factory</h1>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            Create workflows to automate multi-step AI processes.
          </span>
        </div>
        <button
          onClick={() => {
            setEditingWorkflow(null);
            setEditorOpen(true);
          }}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
          + New Workflow
        </button>
      </div>

      {workflows.length === 0 ? (
        <div className="py-24 text-center text-gray-400 dark:text-gray-500">
          <p className="text-lg">No workflows yet</p>
          <p className="mt-1 text-sm">Click "+ New Workflow" to create your first workflow.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {workflows.map((wf) => (
            <div
              key={wf.id}
              className={`flex items-center justify-between rounded-lg border p-4 transition-colors ${
                isDark
                  ? 'hover:bg-gray-750 border-gray-700 bg-gray-800'
                  : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
            >
              <div>
                <div className="flex items-center gap-2">
                  <h3
                    className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-800'}`}
                  >
                    {wf.name}
                  </h3>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      wf.status === 'running'
                        ? 'bg-blue-100 text-blue-700'
                        : wf.status === 'completed'
                          ? 'bg-green-100 text-green-700'
                          : wf.status === 'failed'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {wf.status}
                  </span>
                </div>
                <p className={`mt-0.5 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  {wf.definition?.nodes?.length || 0} nodes &middot;{' '}
                  {wf.definition?.edges?.length || 0} connections &middot; ID: {wf.id}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setEditingWorkflow(wf);
                    setEditorOpen(true);
                  }}
                  className={`rounded border px-3 py-1 text-xs transition-colors ${isDark ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-300 text-gray-600 hover:bg-gray-100'}`}
                >
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
                    className="rounded bg-green-600 px-3 py-1 text-xs text-white transition-colors hover:bg-green-700"
                  >
                    Run
                  </button>
                )}
                <button
                  onClick={() => handleDelete(wf.id)}
                  className="rounded px-3 py-1 text-xs text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20"
                >
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
