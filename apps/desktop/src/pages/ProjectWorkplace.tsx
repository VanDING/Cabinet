import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { FolderOpen, ClipboardList, Package, Brain, Workflow, ChevronRight, X } from 'lucide-react';
import { ProjectExplorer } from '../components/ProjectExplorer';
import { useToast } from '../components/Toast';
import { apiFetch, authHeaders } from '../utils/api.js';
import { DecisionCard } from '@cabinet/ui';
import { DeliverableCard } from '@cabinet/ui';
import { GraphTab } from '../components/GraphTab';
import { KnowledgeTab } from '../components/KnowledgeTab';
import { WorkflowCard, type WorkflowItem } from '../components/WorkflowCard';
import type { Decision, StructuredOutput } from '@cabinet/types';

type Section = 'files' | 'decisions' | 'deliverables' | 'graph' | 'workflows';

interface FileInfo {
  path: string;
  name: string;
  content: string;
  encoding: 'utf-8' | 'base64';
  mimeType?: string;
}

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
}

const IMAGE_MIMES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/bmp',
];

function safeBtoa(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

const navItems: { id: Section; label: string; icon: typeof FolderOpen }[] = [
  { id: 'files', label: 'Files', icon: FolderOpen },
  { id: 'decisions', label: 'Decisions', icon: ClipboardList },
  { id: 'deliverables', label: 'Deliverables', icon: Package },
  { id: 'graph', label: 'Knowledge Graph', icon: Brain },
  { id: 'workflows', label: 'Workflows', icon: Workflow },
];

export function ProjectWorkplace() {
  const { id: projectId } = useParams<{ id: string }>();
  const { addToast } = useToast();
  const [activeSection, setActiveSection] = useState<Section>('files');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [rightPanelVisible, setRightPanelVisible] = useState(true);

  // Data states
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [deliverables, setDeliverables] = useState<StructuredOutput[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  const [filePreview, setFilePreview] = useState<FileInfo | null>(null);
  const [fileLoading, setFileLoading] = useState(false);

  // Counts
  const decisionCount = decisions.filter((d) => d.status === 'pending').length;
  const deliverableCount = deliverables.length;
  const workflowCount = workflows.length;

  const counts: Record<Section, number | undefined> = {
    files: undefined,
    decisions: decisionCount > 0 ? decisionCount : undefined,
    deliverables: deliverableCount > 0 ? deliverableCount : undefined,
    graph: undefined,
    workflows: workflowCount > 0 ? workflowCount : undefined,
  };

  // Fetch data
  useEffect(() => {
    if (!projectId) return;
    // Decisions
    const params = new URLSearchParams({ status: 'all', projectId });
    apiFetch(`/api/decisions?${params.toString()}`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setDecisions(d.decisions ?? []))
      .catch(() => setDecisions([]));
    // Deliverables
    apiFetch(`/api/projects/${projectId}/deliverables`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setDeliverables(d.deliverables ?? []))
      .catch(() => setDeliverables([]));
    // Workflows
    apiFetch(`/api/factory?projectId=${projectId}`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setWorkflows(d.workflows ?? []))
      .catch(() => setWorkflows([]));
  }, [projectId]);

  const fetchFileContent = useCallback(
    async (path: string, name: string) => {
      if (!projectId) return;
      setFileLoading(true);
      try {
        const url = `/api/files/read?path=${encodeURIComponent(path)}&projectId=${encodeURIComponent(projectId)}`;
        const res = await apiFetch(url);
        if (res.ok) {
          const data = await res.json();
          setFilePreview({
            path,
            name,
            content: data.content,
            encoding: data.encoding ?? 'utf-8',
            mimeType: data.mimeType,
          });
          setSelectedItemId(path);
        }
      } catch {
        addToast('error', 'Failed to load file');
      } finally {
        setFileLoading(false);
      }
    },
    [projectId, addToast],
  );

  const handleFileSelect = useCallback(
    (node: FileNode) => {
      if (node.type === 'file') {
        fetchFileContent(node.path, node.name);
      }
    },
    [fetchFileContent],
  );

  const handleRunWorkflow = async (id: string) => {
    // Handled by navigation or parent
    addToast('info', 'Run workflow from Workflows page');
  };

  const handleEditWorkflow = (id: string) => {
    window.location.href = `/workflows/${id}/edit`;
  };

  const handleViewHistory = (id: string) => {
    window.location.href = `/workflows/${id}/edit?tab=runs`;
  };

  const isImage = filePreview?.mimeType && IMAGE_MIMES.includes(filePreview.mimeType);

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left Panel ── */}
      <div className="border-border bg-surface-primary flex w-[280px] shrink-0 flex-col border-r">
        {/* Nav items */}
        <div className="border-border shrink-0 space-y-0.5 border-b p-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveSection(item.id);
                  setSelectedItemId(null);
                  setFilePreview(null);
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                  active
                    ? 'bg-accent-muted text-accent'
                    : 'text-content-secondary hover:bg-surface-muted hover:text-content-primary'
                }`}
              >
                <Icon size={16} />
                <span className="flex-1">{item.label}</span>
                {counts[item.id] !== undefined && counts[item.id]! > 0 && (
                  <span className="bg-accent rounded-full px-1.5 py-0 text-[10px] text-white">
                    {counts[item.id]}
                  </span>
                )}
                <ChevronRight
                  size={14}
                  className={`transition-transform ${active ? 'rotate-90' : 'text-content-tertiary'}`}
                />
              </button>
            );
          })}
        </div>

        {/* File tree in files mode */}
        {activeSection === 'files' && projectId && (
          <div className="flex-1 overflow-hidden">
            <ProjectExplorer
              projectId={projectId}
              onAddFile={() => {}}
              className="w-full border-0"
              onFileSelect={handleFileSelect}
            />
          </div>
        )}
      </div>

      {/* ── Center Panel ── */}
      <div className="bg-surface-primary flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* files */}
        {activeSection === 'files' && (
          <div className="flex h-full flex-col">
            {fileLoading ? (
              <div className="flex flex-1 items-center justify-center">
                <div className="border-accent h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
              </div>
            ) : filePreview ? (
              <div className="flex flex-1 flex-col overflow-hidden">
                <div className="border-border flex items-center justify-between border-b px-4 py-2">
                  <div className="text-content-primary flex items-center gap-2 text-sm">
                    <FolderOpen size={14} className="text-content-tertiary" />
                    <span className="font-medium">{filePreview.name}</span>
                    {filePreview.mimeType && (
                      <span className="text-content-tertiary text-[10px]">
                        {filePreview.mimeType}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      setFilePreview(null);
                      setSelectedItemId(null);
                    }}
                    className="text-content-tertiary hover:bg-surface-muted hover:text-content-primary rounded-sm p-1"
                  >
                    <X size={14} />
                  </button>
                </div>
                <div className="flex-1 overflow-auto">
                  {isImage ? (
                    <div className="flex h-full items-center justify-center p-4">
                      <img
                        src={`data:${filePreview.mimeType};base64,${filePreview.encoding === 'base64' ? filePreview.content : safeBtoa(filePreview.content)}`}
                        alt={filePreview.name}
                        className="max-h-full max-w-full object-contain"
                      />
                    </div>
                  ) : (
                    <pre className="text-content-primary p-4 font-mono text-sm break-all whitespace-pre-wrap">
                      {filePreview.content || '(empty)'}
                    </pre>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-content-tertiary flex flex-1 items-center justify-center">
                <div className="text-center">
                  <FolderOpen size={32} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Select a file from the sidebar to preview</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* decisions */}
        {activeSection === 'decisions' && (
          <div className="h-full overflow-y-auto p-4">
            {decisions.length === 0 ? (
              <div className="text-content-tertiary flex h-64 items-center justify-center">
                <p className="text-sm">No decisions yet</p>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {decisions.map((d) => (
                  <div
                    key={d.id}
                    onClick={() => setSelectedItemId(d.id)}
                    className={`cursor-pointer transition-all ${selectedItemId === d.id ? 'ring-accent ring-2' : ''}`}
                  >
                    <DecisionCard
                      decision={d}
                      variant="compact"
                      onViewDetails={() => setSelectedItemId(d.id)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* deliverables */}
        {activeSection === 'deliverables' && (
          <div className="h-full overflow-y-auto p-4">
            {deliverables.length === 0 ? (
              <div className="text-content-tertiary flex h-64 items-center justify-center">
                <p className="text-sm">No deliverables yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {deliverables.map((d) => (
                  <div
                    key={d.id}
                    onClick={() => setSelectedItemId(d.id)}
                    className={`cursor-pointer transition-all ${selectedItemId === d.id ? 'ring-accent ring-2' : ''}`}
                  >
                    <DeliverableCard output={d} variant="compact" />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* graph */}
        {activeSection === 'graph' && (
          <div className="h-full overflow-hidden">
            <GraphTab />
          </div>
        )}

        {/* workflows */}
        {activeSection === 'workflows' && (
          <div className="h-full overflow-y-auto p-4">
            {workflows.length === 0 ? (
              <div className="text-content-tertiary flex h-64 items-center justify-center">
                <p className="text-sm">No workflows yet</p>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {workflows.map((wf) => (
                  <WorkflowCard
                    key={wf.id}
                    workflow={wf}
                    onRun={handleRunWorkflow}
                    onEdit={handleEditWorkflow}
                    onViewHistory={handleViewHistory}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Right Panel ── */}
      {rightPanelVisible && (
        <div className="border-border bg-surface-primary flex w-[320px] shrink-0 flex-col border-l">
          <div className="border-border flex items-center justify-between border-b px-3 py-2">
            <span className="text-content-secondary text-xs font-medium">Context</span>
            <button
              onClick={() => setRightPanelVisible(false)}
              className="text-content-tertiary hover:bg-surface-muted hover:text-content-primary rounded-sm p-1"
              title="Collapse"
            >
              <X size={14} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {activeSection === 'files' && selectedItemId && filePreview && (
              <div className="text-content-secondary space-y-2 text-xs">
                <div className="border-border bg-surface-muted rounded-lg border p-3">
                  <p className="text-content-primary mb-1 font-medium">File Info</p>
                  <p className="break-all">{filePreview.path}</p>
                  {filePreview.mimeType && (
                    <p className="text-content-tertiary mt-1">{filePreview.mimeType}</p>
                  )}
                </div>
              </div>
            )}
            {activeSection === 'decisions' && selectedItemId && (
              <DecisionContext decision={decisions.find((d) => d.id === selectedItemId)} />
            )}
            {activeSection === 'deliverables' && selectedItemId && (
              <DeliverableContext deliverable={deliverables.find((d) => d.id === selectedItemId)} />
            )}
            {activeSection === 'workflows' && selectedItemId && (
              <WorkflowContext workflow={workflows.find((w) => w.id === selectedItemId)} />
            )}
            {activeSection === 'graph' && (
              <div className="text-content-tertiary text-xs">
                Select a node in the graph to see details.
              </div>
            )}
            {!selectedItemId && activeSection !== 'graph' && (
              <div className="text-content-tertiary text-xs">
                Select an item to see context details.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Collapsed right panel toggle */}
      {!rightPanelVisible && (
        <button
          onClick={() => setRightPanelVisible(true)}
          className="border-border bg-surface-primary text-content-tertiary hover:bg-surface-muted hover:text-content-primary flex w-8 shrink-0 items-center justify-center border-l"
          title="Expand context panel"
        >
          <ChevronRight size={14} className="-rotate-180" />
        </button>
      )}
    </div>
  );
}

function DecisionContext({ decision }: { decision?: Decision }) {
  if (!decision) return <p className="text-content-tertiary text-xs">Decision not found</p>;
  return (
    <div className="space-y-3 text-xs">
      <div className="border-border bg-surface-muted rounded-lg border p-3">
        <p className="text-content-primary mb-1 font-medium">{decision.title}</p>
        <p className="text-content-secondary">{decision.description}</p>
      </div>
      <div>
        <p className="text-content-secondary mb-1 font-medium">Status</p>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
            decision.status === 'pending'
              ? 'bg-accent-muted text-accent'
              : decision.status === 'approved'
                ? 'bg-intent-success-muted text-intent-success'
                : 'bg-intent-danger-muted text-intent-danger'
          }`}
        >
          {decision.status}
        </span>
      </div>
      <div>
        <p className="text-content-secondary mb-1 font-medium">Level</p>
        <p className="text-content-tertiary">{decision.level}</p>
      </div>
      {decision.options.length > 0 && (
        <div>
          <p className="text-content-secondary mb-1 font-medium">Options</p>
          <div className="space-y-1">
            {decision.options.map((opt) => (
              <div key={opt.id} className="border-border rounded border p-2">
                <p className="text-content-primary font-medium">{opt.label}</p>
                <p className="text-content-tertiary">{opt.impact}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DeliverableContext({ deliverable }: { deliverable?: StructuredOutput }) {
  if (!deliverable) return <p className="text-content-tertiary text-xs">Deliverable not found</p>;
  const data = (deliverable.data ?? {}) as Record<string, unknown>;
  return (
    <div className="space-y-3 text-xs">
      <div className="border-border bg-surface-muted rounded-lg border p-3">
        <p className="text-content-primary mb-1 font-medium">
          {String(data.title ?? deliverable.id)}
        </p>
        <p className="text-content-secondary">{String(data.summary ?? '')}</p>
      </div>
      <div>
        <p className="text-content-secondary mb-1 font-medium">Status</p>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
            deliverable.status === 'accepted'
              ? 'bg-intent-success-muted text-intent-success'
              : deliverable.status === 'rejected'
                ? 'bg-intent-danger-muted text-intent-danger'
                : 'bg-accent-muted text-accent'
          }`}
        >
          {deliverable.status}
        </span>
      </div>
    </div>
  );
}

function WorkflowContext({ workflow }: { workflow?: WorkflowItem }) {
  if (!workflow) return <p className="text-content-tertiary text-xs">Workflow not found</p>;
  return (
    <div className="space-y-3 text-xs">
      <div className="border-border bg-surface-muted rounded-lg border p-3">
        <p className="text-content-primary mb-1 font-medium">{workflow.name}</p>
        <p className="text-content-secondary">ID: {workflow.id}</p>
      </div>
      <div>
        <p className="text-content-secondary mb-1 font-medium">Status</p>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
            workflow.status === 'running'
              ? 'bg-accent-muted text-accent'
              : workflow.status === 'completed'
                ? 'bg-intent-success-muted text-intent-success'
                : workflow.status === 'failed'
                  ? 'bg-intent-danger-muted text-intent-danger'
                  : 'bg-surface-muted text-content-secondary'
          }`}
        >
          {workflow.status}
        </span>
      </div>
      {workflow.cronExpression && (
        <div>
          <p className="text-content-secondary mb-1 font-medium">Schedule</p>
          <p className="text-content-tertiary">{workflow.cronExpression}</p>
        </div>
      )}
    </div>
  );
}
