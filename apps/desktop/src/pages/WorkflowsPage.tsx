import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useToast } from '../components/Toast';
import { apiFetch, authHeaders, authJsonHeaders } from '../utils/api.js';
import { WorkflowCard, type WorkflowItem } from '../components/WorkflowCard';

interface RunItem {
  runId: string;
  workflowId: string;
  status: string;
  steps: Array<{ nodeId?: string; type?: string; output?: string }>;
  timestamp: string;
}

export function WorkflowsPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  const [runs, setRuns] = useState<Record<string, RunItem[]>>({});
  const [loading, setLoading] = useState(false);

  const fetchWorkflows = useCallback(() => {
    setLoading(true);
    apiFetch('/api/factory', { headers: authHeaders() })
      .then((res) => res.json())
      .then((data) => {
        if (data.workflows) setWorkflows(data.workflows);
      })
      .catch(() => addToast('error', 'Failed to load workflows'))
      .finally(() => setLoading(false));
  }, [addToast]);

  useEffect(() => {
    fetchWorkflows();
  }, [fetchWorkflows]);

  const fetchRuns = useCallback(async (wfId: string) => {
    try {
      const res = await apiFetch(`/api/factory/${wfId}/runs`, { headers: authHeaders() });
      const data = await res.json();
      setRuns((prev) => ({ ...prev, [wfId]: data.runs ?? [] }));
    } catch {
      setRuns((prev) => ({ ...prev, [wfId]: [] }));
    }
  }, []);

  useEffect(() => {
    workflows.forEach((wf) => fetchRuns(wf.id));
  }, [workflows, fetchRuns]);

  const handleRun = async (id: string) => {
    const wf = workflows.find((w) => w.id === id);
    try {
      const res = await apiFetch(`/api/factory/${id}/run`, {
        method: 'POST',
        headers: authJsonHeaders(),
      });
      const data = await res.json();
      if (data.status === 'failed') {
        addToast('error', `Workflow failed: ${data.error ?? 'Unknown error'}`);
      } else {
        addToast('success', `Workflow "${wf?.name ?? id}" ${data.status}`);
      }
      fetchWorkflows();
      fetchRuns(id);
    } catch {
      addToast('error', 'Failed to run workflow');
    }
  };

  const handleEdit = (id: string) => {
    navigate(`/workflows/${id}/edit`);
  };

  const handleViewHistory = (id: string) => {
    navigate(`/workflows/${id}/edit?tab=runs`);
  };

  const handleNewWorkflow = async () => {
    try {
      const id = `wf_${Date.now()}`;
      let pid: string | undefined;
      try {
        const projRes = await apiFetch('/api/projects', { headers: authHeaders() });
        const projData = await projRes.json();
        pid = (projData.projects?.[0]?.id) as string | undefined;
        if (!pid) {
          addToast('error', 'No project found. Create a project first.');
          return;
        }
      } catch {
        addToast('error', 'Failed to resolve project');
        return;
      }
      const def = {
        nodes: [
          { id: 'start', type: 'start' },
          { id: 'end', type: 'end' },
        ],
        edges: [{ from: 'start', to: 'end' }],
      };
      const res = await apiFetch('/api/factory', {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({ name: 'New Workflow', projectId: pid, definition: def }),
      });
      if (res.ok) {
        fetchWorkflows();
        addToast('success', 'New workflow created');
      }
    } catch {
      addToast('error', 'Failed to create workflow');
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold text-content-primary">Workflows</h1>
          <span className="text-sm text-content-tertiary">
            Build and run automated pipelines
          </span>
        </div>
        <button
          onClick={handleNewWorkflow}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-content-inverse hover:bg-accent-hover"
        >
          <Plus size={16} />
          New Workflow
        </button>
      </div>

      {loading && workflows.length === 0 && (
        <div className="flex h-64 items-center justify-center">
          <div className="border-accent mx-auto h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
        </div>
      )}

      {workflows.length === 0 && !loading && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-content-tertiary">No workflows yet.</p>
          <p className="mt-1 text-sm text-content-tertiary">
            Create your first workflow to get started.
          </p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {workflows.map((wf) => (
          <WorkflowCard
            key={wf.id}
            workflow={wf}
            onRun={handleRun}
            onEdit={handleEdit}
            onViewHistory={handleViewHistory}
          />
        ))}
      </div>
    </div>
  );
}
