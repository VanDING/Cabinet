import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useToast } from '../components/Toast';
import { ScheduledTab } from '../components/ScheduledTab';
import { Button, Card, Tabs } from '@cabinet/ui';
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
  const [scheduledFormOpen, setScheduledFormOpen] = useState(false);
  const { addToast } = useToast();

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

  const textClass = 'text-content-primary';
  const subtextClass = 'text-content-tertiary';
  const codeBgClass = 'border border-border bg-surface-elevated';

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold text-content-primary">Factory</h1>
          <span className={`text-sm ${subtextClass}`}>
            Create and manage automated workflows via conversation.
          </span>
        </div>
        <Button
          size="md"
          onClick={() =>
            activeTab === 'workflows' ? handleNewWorkflow() : setScheduledFormOpen(true)
          }
        >
          {activeTab === 'workflows' ? '+ New Workflow' : '+ New Task'}
        </Button>
      </div>

      <Tabs
        className="mb-6"
        tabs={[
          { id: 'workflows', label: 'Workflows' },
          { id: 'scheduled', label: 'Scheduled' },
        ]}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as 'workflows' | 'scheduled')}
      />

      {activeTab === 'scheduled' ? (
        <ScheduledTab
          showForm={scheduledFormOpen}
          onFormClose={() => setScheduledFormOpen(false)}
        />
      ) : workflows.length === 0 ? (
        <div className="py-24 text-center text-content-tertiary">
          <p className="text-lg">No workflows yet</p>
          <p className="mt-1 text-sm">
            Click "+ New Workflow" to design one conversationally with the Workflow Designer.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {workflows.map((wf) => (
            <div key={wf.id}>
              <Card className="flex items-center justify-between transition-colors hover:bg-surface-elevated bg-surface-input">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className={`text-sm font-medium ${textClass}`}>{wf.name}</h3>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        wf.status === 'running'
                          ? 'bg-accent-muted text-accent'
                          : wf.status === 'completed'
                            ? 'bg-intent-success-muted text-intent-success'
                            : wf.status === 'failed'
                              ? 'bg-intent-danger-muted text-intent-danger'
                              : 'bg-surface-muted text-content-secondary'
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
                  <Button variant="ghost" size="xs" onClick={() => toggleJson(wf.id)}>
                    {expandedJson.has(wf.id) ? 'Hide JSON' : 'View JSON'}
                  </Button>
                  <Button size="xs" onClick={() => handleChatEdit(wf)}>
                    Chat Edit
                  </Button>
                  {wf.status === 'draft' && (
                    <Button size="xs" className="bg-intent-success hover:bg-intent-success" onClick={() => handleRun(wf)}>
                      Run
                    </Button>
                  )}
                  <Button variant="ghost" size="xs" className="text-intent-danger" onClick={() => handleDelete(wf)}>
                    Delete
                  </Button>
                </div>
              </Card>

              {/* Expanded JSON view */}
              {expandedJson.has(wf.id) && (
                <div
                  className={`mt-1 rounded-lg p-4 font-mono text-xs text-content-secondary ${codeBgClass}`}
                >
                  <pre className="overflow-x-auto whitespace-pre-wrap">
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
