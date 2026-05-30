import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useToast } from '../components/Toast';
import { Button } from '@cabinet/ui';
import { apiFetch, authHeaders, authJsonHeaders } from '../utils/pin.js';
import { WorkflowCanvas } from '../factory/WorkflowCanvas';
import { WorkflowPanel } from '../factory/WorkflowPanel';
import { definitionToCanvas, canvasToDefinition } from '../factory/converter';
import { useUndoRedo } from '../factory/useUndoRedo';
import type { CanvasNode, CanvasEdge, CanvasNodeType } from '../factory/node-types';

interface WorkflowItem {
  id: string;
  name: string;
  definition: Record<string, unknown>;
  status: string;
  cronExpression?: string | null;
  createdAt?: string;
}

interface Props {
  onCreateChatSession: (options: { title: string; initialContext: string }) => string;
  onSwitchSession: (id: string) => void;
  onEnterChat: () => void;
}

interface RunItem {
  runId: string;
  workflowId: string;
  status: string;
  steps: Array<{ nodeId?: string; type?: string; output?: string }>;
  timestamp: string;
}

function formatCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, dom, month, dow] = parts as string[];
  if (min === '*' && hour === '*' && dom === '*' && month === '*' && dow === '*') return 'Every minute';
  if (min === '0' && hour === '*' && dom === '*' && month === '*' && dow === '*') return 'Every hour';
  if (min!.startsWith('*/') && hour === '*' && dom === '*' && month === '*' && dow === '*') {
    const interval = parseInt(min!.slice(2), 10);
    if (!isNaN(interval)) return `Every ${interval} min`;
  }
  if (dom === '*' && month === '*' && dow === '*') {
    const h = parseInt(hour!, 10);
    const m = parseInt(min!, 10);
    if (!isNaN(h) && !isNaN(m)) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} daily`;
  }
  return expr;
}

export function FactoryPage({ onCreateChatSession, onSwitchSession, onEnterChat }: Props) {
  const { id: projectId } = useParams<{ id?: string }>();
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { addToast } = useToast();

  // Canvas state
  const [canvasNodes, setCanvasNodes] = useState<CanvasNode[]>([]);
  const [canvasEdges, setCanvasEdges] = useState<CanvasEdge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Panel state
  const [panelTab, setPanelTab] = useState<'canvas' | 'runs'>('canvas');
  const [runs, setRuns] = useState<RunItem[]>([]);
  const [dirty, setDirty] = useState(false);
  const undoRedo = useUndoRedo();

  // Ctrl+Z / Ctrl+Y keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!selectedId) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoRedo.undo(
          { nodes: canvasNodes, edges: canvasEdges },
          (nodes, edges) => {
            setCanvasNodes(nodes);
            setCanvasEdges(edges);
            setDirty(true);
          },
        );
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        undoRedo.redo(
          { nodes: canvasNodes, edges: canvasEdges },
          (nodes, edges) => {
            setCanvasNodes(nodes);
            setCanvasEdges(edges);
            setDirty(true);
          },
        );
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedId, canvasNodes, canvasEdges, undoRedo]);

  const selected = useMemo(
    () => workflows.find((w) => w.id === selectedId) ?? null,
    [workflows, selectedId],
  );

  const selectedNode = useMemo(
    () => canvasNodes.find((n) => n.id === selectedNodeId) ?? null,
    [canvasNodes, selectedNodeId],
  );

  // ── Fetch ──

  const fetchWorkflows = useCallback(() => {
    const url = projectId ? `/api/factory?projectId=${projectId}` : '/api/factory';
    apiFetch(url, { headers: authHeaders() })
      .then((res) => res.json())
      .then((data) => {
        if (data.workflows) setWorkflows(data.workflows);
      })
      .catch(() => addToast('error', 'Failed to load workflows'));
  }, [addToast, projectId]);

  const fetchRuns = useCallback(async (wfId: string) => {
    try {
      const res = await apiFetch(`/api/factory/${wfId}/runs`, { headers: authHeaders() });
      const data = await res.json();
      setRuns(data.runs ?? []);
    } catch {
      setRuns([]);
    }
  }, []);

  useEffect(() => {
    fetchWorkflows();
  }, [fetchWorkflows]);

  // Load canvas when selection changes
  useEffect(() => {
    if (!selected) {
      setCanvasNodes([]);
      setCanvasEdges([]);
      setSelectedNodeId(null);
      setDirty(false);
      return;
    }
    const def = selected.definition ?? {};
    const { nodes, edges } = definitionToCanvas(def);
    setCanvasNodes(nodes);
    setCanvasEdges(edges);
    setSelectedNodeId(null);
    setDirty(false);
    undoRedo.clear();
    fetchRuns(selected.id);
    setPanelTab('canvas');
  }, [selected?.id]);

  // ── Actions ──

  const handleSelectWorkflow = (wf: WorkflowItem) => {
    setSelectedId(selectedId === wf.id ? null : wf.id);
  };

  const handleSave = async () => {
    if (!selected) return;
    try {
      const def = canvasToDefinition(canvasNodes, canvasEdges);
      await apiFetch(`/api/factory/${selected.id}`, {
        method: 'PUT',
        headers: authJsonHeaders(),
        body: JSON.stringify({ name: selected.name, definition: def }),
      });
      setDirty(false);
      addToast('success', 'Workflow saved');
      fetchWorkflows();
    } catch {
      addToast('error', 'Failed to save workflow');
    }
  };

  const handleWorkflowSave = async (meta: Partial<WorkflowItem>) => {
    if (!selected) return;
    try {
      await apiFetch(`/api/factory/${selected.id}`, {
        method: 'PUT',
        headers: authJsonHeaders(),
        body: JSON.stringify({
          name: meta.name ?? selected.name,
          cronExpression: meta.cronExpression,
          definition: canvasToDefinition(canvasNodes, canvasEdges),
        }),
      });
      setDirty(false);
      addToast('success', 'Saved');
      fetchWorkflows();
    } catch {
      addToast('error', 'Failed to save');
    }
  };

  const handleRun = async () => {
    if (!selected) return;
    try {
      const res = await apiFetch(`/api/factory/${selected.id}/run`, {
        method: 'POST',
        headers: authJsonHeaders(),
      });
      const data = await res.json();
      if (data.status === 'failed') {
        addToast('error', `Workflow failed: ${data.error ?? 'Unknown error'}`);
      } else {
        addToast('success', `Workflow "${selected.name}" ${data.status}`);
      }
      fetchWorkflows();
      fetchRuns(selected.id);
      setPanelTab('runs');
    } catch {
      addToast('error', 'Failed to run workflow');
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    if (!confirm(`Delete workflow "${selected.name}"?`)) return;
    try {
      await apiFetch(`/api/factory/${selected.id}`, { method: 'DELETE', headers: authHeaders() });
      setSelectedId(null);
      fetchWorkflows();
      addToast('success', 'Workflow deleted');
    } catch {
      addToast('error', 'Failed to delete workflow');
    }
  };

  const handleNewWorkflow = async () => {
    try {
      const id = `wf_${Date.now()}`;
      // Resolve valid project ID: use URL param, or fetch first available project
      let pid = projectId;
      if (!pid) {
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
        // Find the newly created workflow in the refreshed list
        setTimeout(() => {
          setSelectedId(id);
        }, 100);
        addToast('success', 'New workflow created');
      }
    } catch {
      addToast('error', 'Failed to create workflow');
    }
  };

  const handleChatEdit = () => {
    if (!selected) return;
    const defStr = JSON.stringify(selected.definition, null, 2);
    const initialContext = [
      '[Workflow Context]',
      `Name: ${selected.name}`,
      `ID: ${selected.id}`,
      `Status: ${selected.status}`,
      selected.cronExpression ? `Schedule: ${selected.cronExpression}` : '',
      'Current definition:',
      '```json', defStr, '```',
      '',
      'You are editing this workflow. Use workflow tools to modify it.',
    ].join('\n');
    const sessionId = onCreateChatSession({ title: selected.name, initialContext });
    onSwitchSession(sessionId);
    onEnterChat();
    addToast('info', `Editing "${selected.name}" in chat`);
  };

  // Node handlers
  const handleNodesChange = useCallback((nodes: CanvasNode[]) => {
    setCanvasNodes(nodes);
    setDirty(true);
  }, []);

  const handleEdgesChange = useCallback((edges: CanvasEdge[]) => {
    setCanvasEdges(edges);
    setDirty(true);
  }, []);

  // Record undo snapshot after each meaningful change
  const recordUndo = useCallback(
    (nodes: CanvasNode[], edges: CanvasEdge[]) => {
      undoRedo.record(nodes, edges);
    },
    [undoRedo],
  );

  const handleNodeUpdate = (nodeId: string, data: Record<string, unknown>) => {
    setCanvasNodes((prev) => {
      const updated = prev.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n));
      recordUndo(updated, canvasEdges);
      return updated;
    });
    setDirty(true);
  };

  const handleNodeDelete = (nodeId: string) => {
    setCanvasNodes((prev) => {
      const updated = prev.filter((n) => n.id !== nodeId);
      recordUndo(updated, canvasEdges);
      return updated;
    });
    setCanvasEdges((prev) => {
      const updated = prev.filter((e) => e.source !== nodeId && e.target !== nodeId);
      return updated;
    });
    setSelectedNodeId(null);
    setDirty(true);
  };

  const handleNodeAdd = (type: CanvasNodeType, position?: { x: number; y: number }) => {
    const id = `${type}_${Date.now()}`;
    const pos = position ?? { x: 250, y: 250 };
    const newNode: CanvasNode = {
      id,
      type,
      position: pos,
      data: { title: type },
    };
    setCanvasNodes((prev) => {
      const updated = [...prev, newNode];
      recordUndo(updated, canvasEdges);
      return updated;
    });
    setDirty(true);
  };

  const handleGroupNodes = useCallback(
    (childIds: string[], groupId: string) => {
      const children = canvasNodes.filter((n) => childIds.includes(n.id));
      if (children.length === 0) return;
      const minX = Math.min(...children.map((n) => n.position.x));
      const minY = Math.min(...children.map((n) => n.position.y));
      const pad = 60;
      const groupNode: CanvasNode = {
        id: groupId, type: 'agentGroup',
        position: { x: minX - pad, y: minY - pad - 30 },
        data: { title: 'Agent Group', role: 'secretary' },
      };
      setCanvasNodes((prev) => {
        const updated = prev.map((n) => {
          if (childIds.includes(n.id)) {
            return { ...n, parentId: groupId, extent: 'parent' as const, position: { x: n.position.x - minX + pad, y: n.position.y - minY + pad } };
          }
          return n;
        });
        updated.push(groupNode);
        recordUndo(updated, canvasEdges);
        return updated;
      });
      setDirty(true);
    },
    [canvasNodes, canvasEdges, recordUndo],
  );

  const stepCount = (wf: WorkflowItem): number => {
    const def = wf.definition;
    if (!def) return 0;
    if (def.steps && Array.isArray(def.steps)) return def.steps.length;
    if (def.nodes && Array.isArray(def.nodes)) return def.nodes.length;
    return 0;
  };

  const textClass = 'text-content-primary';
  const subtextClass = 'text-content-tertiary';

  return (
    <div className="flex h-full">
      {/* ── Left panel: Workflow list ── */}
      <div className="flex w-[340px] flex-shrink-0 flex-col overflow-y-auto border-r border-border p-4">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-bold text-content-primary">Factory</h1>
          <Button size="sm" onClick={handleNewWorkflow}>
            + New
          </Button>
        </div>

        {workflows.length === 0 ? (
          <div className="py-16 text-center text-content-tertiary">
            <p className="text-sm">No workflows yet</p>
            <p className="mt-1 text-xs">Click "+ New" to create one.</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {workflows.map((wf) => (
              <div
                key={wf.id}
                onClick={() => handleSelectWorkflow(wf)}
                className={`cursor-pointer rounded-lg border px-3 py-2.5 transition-colors ${
                  selectedId === wf.id
                    ? 'border-accent bg-accent-muted/20'
                    : 'border-border bg-surface-input hover:bg-surface-elevated'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <h3 className={`text-sm font-medium truncate ${textClass}`}>
                    {wf.name}
                  </h3>
                  {wf.cronExpression && (
                    <span className="flex-shrink-0 rounded-full bg-intent-info-muted px-1.5 py-0.5 text-[10px] text-intent-info leading-none">
                      ⏱
                    </span>
                  )}
                </div>
                <p className={`mt-0.5 text-xs ${subtextClass}`}>
                  {stepCount(wf)} steps &middot; <StatusBadge status={wf.status} />
                  {wf.cronExpression && <> &middot; {formatCron(wf.cronExpression)}</>}
                  {wf.createdAt && (
                    <> &middot; {new Date(wf.createdAt).toLocaleDateString()}</>
                  )}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Right panel: Canvas / Empty state ── */}
      <div className="flex flex-1 flex-col">
        {!selected ? (
          <div className="flex h-full items-center justify-center text-content-tertiary">
            <div className="text-center">
              <p className="text-lg">Select a workflow</p>
              <p className="mt-1 text-sm">Click a workflow in the list or create a new one.</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-1">
            {/* Canvas area */}
            <div className="flex flex-1 flex-col">
              {/* Toolbar */}
              <div className="flex items-center justify-between border-b border-border px-4 py-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-content-primary">{selected.name}</h2>
                  <StatusBadge status={selected.status} />
                  {dirty && (
                    <span className="rounded bg-intent-warning-muted px-1.5 py-0.5 text-[10px] text-intent-warning">
                      Unsaved
                    </span>
                  )}
                </div>
                <div className="flex gap-1.5 items-center">
                  <button
                    onClick={() =>
                      undoRedo.undo({ nodes: canvasNodes, edges: canvasEdges }, (n, e) => {
                        setCanvasNodes(n);
                        setCanvasEdges(e);
                        setDirty(true);
                      })
                    }
                    disabled={!undoRedo.canUndo}
                    title="Undo (Ctrl+Z)"
                    className="rounded p-1 text-xs text-content-tertiary hover:text-content-primary disabled:opacity-30"
                  >
                    ↩
                  </button>
                  <button
                    onClick={() =>
                      undoRedo.redo({ nodes: canvasNodes, edges: canvasEdges }, (n, e) => {
                        setCanvasNodes(n);
                        setCanvasEdges(e);
                        setDirty(true);
                      })
                    }
                    disabled={!undoRedo.canRedo}
                    title="Redo (Ctrl+Y)"
                    className="rounded p-1 text-xs text-content-tertiary hover:text-content-primary disabled:opacity-30"
                  >
                    ↪
                  </button>
                  <Button size="xs" variant="ghost" onClick={handleSave} disabled={!dirty}>
                    Save
                  </Button>
                  <Button size="xs" variant="ghost" onClick={handleChatEdit}>
                    Chat Edit
                  </Button>
                  <Button size="xs" variant="ghost" className="text-intent-danger" onClick={handleDelete}>
                    Delete
                  </Button>
                </div>
              </div>

              {/* Canvas */}
              <div className="flex-1">
                <WorkflowCanvas
                  nodes={canvasNodes}
                  edges={canvasEdges}
                  editable
                  onNodesChange={handleNodesChange}
                  onEdgesChange={handleEdgesChange}
                  onNodeClick={(nodeId) => {
                    setSelectedNodeId(nodeId);
                    if (nodeId) setPanelTab('canvas');
                  }}
                  onNodeAdd={handleNodeAdd}
                  onGroupNodes={handleGroupNodes}
                />
              </div>
            </div>

            {/* Side panel */}
            <div className="w-[320px] flex-shrink-0">
              <WorkflowPanel
                tab={panelTab}
                onTabChange={setPanelTab}
                onClose={() => setSelectedId(null)}
                workflow={selected}
                selectedNode={selectedNode}
                onNodeUpdate={handleNodeUpdate}
                onNodeDelete={handleNodeDelete}
                onNodeAdd={handleNodeAdd}
                onWorkflowSave={handleWorkflowSave}
                onRunWorkflow={handleRun}
                runs={runs}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
        status === 'running'
          ? 'bg-accent-muted text-accent'
          : status === 'completed'
            ? 'bg-intent-success-muted text-intent-success'
            : status === 'failed'
              ? 'bg-intent-danger-muted text-intent-danger'
              : 'bg-surface-muted text-content-secondary'
      }`}
    >
      {status}
    </span>
  );
}
