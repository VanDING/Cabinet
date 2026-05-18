import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';
import { useToast } from '../components/Toast';
import { ScheduledTab } from '../components/ScheduledTab';
import { apiFetch, authHeaders, authJsonHeaders } from '../utils/pin.js';

interface WorkflowItem {
  id: string;
  name: string;
  definition: Record<string, unknown>;
  status: string;
  createdAt?: string;
}

interface Props {
  onCreateChatSession: (options: { title: string; initialContext: string }) => string;
  onSwitchSession: (id: string) => void;
  onEnterChat: () => void;
}

export function FactoryPage({ onCreateChatSession, onSwitchSession, onEnterChat }: Props) {
  const { id: projectId } = useParams<{ id?: string }>();
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  const [expandedJson, setExpandedJson] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'workflows' | 'scheduled'>('workflows');
  const { addToast } = useToast();
  const { isDark } = useTheme();

  const fetchWorkflows = useCallback(() => {
    const url = projectId ? `/api/factory?projectId=${projectId}` : '/api/factory';
    apiFetch(url, { headers: authHeaders() })
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

  const toggleJson = (id: string) => {
    setExpandedJson((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleChatEdit = (wf: WorkflowItem) => {
    const defStr =
      wf.definition && Object.keys(wf.definition).length > 0
        ? JSON.stringify(wf.definition, null, 2)
        : '(empty)';

    const initialContext = [
      `[Workflow Context]`,
      `Name: ${wf.name}`,
      `ID: ${wf.id}`,
      `Status: ${wf.status}`,
      `Current definition:`,
      '```json',
      defStr,
      '```',
      '',
      'You are now editing this workflow. Use list_workflows, get_workflow, create_workflow, and update_workflow tools to help the Captain modify it.',
    ].join('\n');

    const sessionId = onCreateChatSession({
      title: `${wf.name}`,
      initialContext,
    });
    onSwitchSession(sessionId);
    onEnterChat();
    addToast('info', `Editing "${wf.name}" in chat`);
  };

  const handleNewWorkflow = () => {
    const initialContext = [
      '[Workflow Context]',
      'The Captain wants to create a new workflow. Ask clarifying questions to understand:',
      '- What process should be automated?',
      '- What steps are needed and in what order?',
      '- Which agent roles should handle each step?',
      '- What are the input/output formats and constraints?',
      '',
      'After gathering requirements, design the WorkflowDefinition and present it for confirmation. Then call create_workflow.',
    ].join('\n');

    const sessionId = onCreateChatSession({
      title: 'New Workflow',
      initialContext,
    });
    onSwitchSession(sessionId);
    onEnterChat();
    addToast('info', 'Starting workflow creation in chat');
  };

  const handleRun = async (wf: WorkflowItem) => {
    try {
      const res = await apiFetch(`/api/factory/${wf.id}/run`, {
        method: 'POST',
        headers: authJsonHeaders(),
      });
      const data = await res.json();
      if (data.status === 'failed') {
        addToast('error', `Workflow failed: ${data.error ?? 'Unknown error'}`);
      } else {
        addToast('success', `Workflow "${wf.name}" ${data.status}`);
      }
      fetchWorkflows();
    } catch {
      addToast('error', 'Failed to run workflow');
    }
  };

  const handleDelete = async (wf: WorkflowItem) => {
    if (!confirm(`Delete workflow "${wf.name}"?`)) return;
    try {
      await apiFetch(`/api/factory/${wf.id}`, { method: 'DELETE', headers: authHeaders() });
      setWorkflows((prev) => prev.filter((w) => w.id !== wf.id));
      addToast('success', 'Workflow deleted');
    } catch {
      addToast('error', 'Failed to delete workflow');
    }
  };

  const stepCount = (wf: WorkflowItem): number => {
    const def = wf.definition;
    if (!def) return 0;
    if (def.steps && Array.isArray(def.steps)) return def.steps.length;
    if (def.nodes && Array.isArray(def.nodes)) return def.nodes.length;
    return 0;
  };

  const borderClass = isDark ? 'border-gray-700' : 'border-gray-200';
  const cardBgClass = isDark ? 'bg-gray-800' : 'bg-white';
  const hoverBgClass = isDark ? 'hover:bg-gray-750' : 'hover:bg-gray-50';
  const textClass = isDark ? 'text-gray-200' : 'text-gray-800';
  const subtextClass = isDark ? 'text-gray-500' : 'text-gray-400';
  const codeBgClass = isDark ? 'bg-gray-900' : 'bg-gray-50';
  const btnGhostClass = isDark
    ? 'border-gray-600 text-gray-300 hover:bg-gray-700'
    : 'border-gray-300 text-gray-600 hover:bg-gray-100';

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Factory</h1>
          <span className={`text-sm ${subtextClass}`}>
            Create and manage automated workflows via conversation.
          </span>
        </div>
        {activeTab === 'workflows' && (
          <button
            onClick={handleNewWorkflow}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700"
          >
            + New Workflow
          </button>
        )}
      </div>

      {/* Tab bar */}
      <div className={`flex gap-4 mb-6 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
        <button
          onClick={() => setActiveTab('workflows')}
          className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'workflows'
              ? 'border-blue-500 text-blue-600 dark:text-blue-400'
              : `border-transparent ${isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'}`
          }`}
        >
          Workflows
        </button>
        <button
          onClick={() => setActiveTab('scheduled')}
          className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'scheduled'
              ? 'border-blue-500 text-blue-600 dark:text-blue-400'
              : `border-transparent ${isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'}`
          }`}
        >
          Scheduled
        </button>
      </div>

      {activeTab === 'scheduled' ? (
        <ScheduledTab isDark={isDark} />
      ) : workflows.length === 0 ? (
        <div className="py-24 text-center text-gray-400 dark:text-gray-500">
          <p className="text-lg">No workflows yet</p>
          <p className="mt-1 text-sm">
            Click "+ New Workflow" to design one conversationally with the Workflow Designer.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {workflows.map((wf) => (
            <div key={wf.id}>
              <div
                className={`flex items-center justify-between rounded-lg border p-4 transition-colors ${cardBgClass} ${borderClass} ${hoverBgClass}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className={`text-sm font-medium ${textClass}`}>{wf.name}</h3>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        wf.status === 'running'
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                          : wf.status === 'completed'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                            : wf.status === 'failed'
                              ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
                              : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                      }`}
                    >
                      {wf.status}
                    </span>
                  </div>
                  <p className={`mt-0.5 text-xs ${subtextClass}`}>
                    {stepCount(wf)} steps &middot; ID: {wf.id}
                    {wf.createdAt && <> &middot; {new Date(wf.createdAt).toLocaleDateString()}</>}
                  </p>
                </div>

                <div className="flex flex-shrink-0 gap-2">
                  <button
                    onClick={() => toggleJson(wf.id)}
                    className={`rounded border px-3 py-1 text-xs transition-colors ${btnGhostClass}`}
                  >
                    {expandedJson.has(wf.id) ? 'Hide JSON' : 'View JSON'}
                  </button>
                  <button
                    onClick={() => handleChatEdit(wf)}
                    className="rounded bg-blue-600 px-3 py-1 text-xs text-white transition-colors hover:bg-blue-700"
                  >
                    Chat Edit
                  </button>
                  {wf.status === 'draft' && (
                    <button
                      onClick={() => handleRun(wf)}
                      className="rounded bg-green-600 px-3 py-1 text-xs text-white transition-colors hover:bg-green-700"
                    >
                      Run
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(wf)}
                    className="rounded px-3 py-1 text-xs text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {/* Expanded JSON view */}
              {expandedJson.has(wf.id) && (
                <div
                  className={`mt-1 rounded-lg border p-4 font-mono text-xs ${borderClass} ${codeBgClass} ${isDark ? 'text-gray-300' : 'text-gray-700'}`}
                >
                  <pre className="whitespace-pre-wrap overflow-x-auto">
                    {JSON.stringify(wf.definition, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
