import { useState, useEffect, useCallback, useRef } from 'react';
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
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        pid = projData.projects?.[0]?.id as string | undefined;
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

  const handleExport = async (workflowId: string) => {
    const wf = workflows.find((w) => w.id === workflowId);
    try {
      const res = await apiFetch('/api/workflows/export', {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({ workflowId }),
      });
      const blueprint = await res.json();
      const blob = new Blob([JSON.stringify(blueprint, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${wf?.name ?? 'workflow'}.cabinet.json`;
      a.click();
      URL.revokeObjectURL(url);
      addToast('success', `Workflow "${wf?.name ?? workflowId}" exported`);
    } catch {
      addToast('error', 'Failed to export workflow');
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const blueprint = JSON.parse(text);
      const projRes = await apiFetch('/api/projects', { headers: authHeaders() });
      const projData = await projRes.json();
      const pid = (projData.projects?.[0]?.id as string) ?? 'default';
      const res = await apiFetch('/api/workflows/import', {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({ blueprint, projectId: pid }),
      });
      const data = await res.json();
      const nodeCount = data.nodes?.length ?? 0;
      const missing = data.missingAgents?.length ?? 0;
      const summary = `Imported workflow with ${nodeCount} nodes${missing ? ` (${missing} missing agents)` : ''}`;
      addToast('success', summary);
      fetchWorkflows();
    } catch {
      addToast('error', 'Failed to import workflow');
    }
    e.target.value = '';
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h1 className="text-content-primary text-2xl font-bold">Workflows</h1>
          <span className="text-content-tertiary text-sm">Build and run automated pipelines</span>
        </div>
        <div className="flex items-center gap-2">
          {workflows.length > 0 && (
            <select
              defaultValue=""
              onChange={(e) => {
                const val = e.target.value;
                e.target.value = '';
                if (val) handleExport(val);
              }}
              className="border-border bg-surface-input text-content-primary rounded-lg border px-3 py-2 text-sm"
            >
              <option value="">Export…</option>
              {workflows.map((wf) => (
                <option key={wf.id} value={wf.id}>
                  {wf.name}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="border-border text-content-tertiary hover:text-content-primary rounded-lg border px-3 py-2 text-sm"
          >
            Import
          </button>
          <input
            type="file"
            accept=".json"
            ref={fileInputRef}
            className="hidden"
            onChange={handleImportFile}
          />
          <button
            onClick={handleNewWorkflow}
            className="bg-accent text-content-inverse hover:bg-accent-hover inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium"
          >
            <Plus size={16} />
            New Workflow
          </button>
        </div>
      </div>

      {loading && workflows.length === 0 && (
        <div className="flex h-64 items-center justify-center">
          <div className="border-accent mx-auto h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
        </div>
      )}

      {workflows.length === 0 && !loading && (
        <div className="border-border rounded-lg border border-dashed p-8 text-center">
          <p className="text-content-tertiary">No workflows yet.</p>
          <p className="text-content-tertiary mt-1 text-sm">
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
