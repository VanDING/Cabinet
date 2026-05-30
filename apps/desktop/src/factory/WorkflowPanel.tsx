import { useState, useEffect } from 'react';
import type { CanvasNode, CanvasNodeType } from './node-types';
import { CANVAS_NODE_TYPES, NODE_LABELS } from './node-types';

interface WorkflowMeta {
  id: string;
  name: string;
  status: string;
  cronExpression?: string | null;
  createdAt?: string;
}

interface RunItem {
  runId: string;
  workflowId: string;
  status: string;
  steps: Array<{ nodeId?: string; type?: string; output?: string }>;
  timestamp: string;
}

interface WorkflowPanelProps {
  tab: 'canvas' | 'runs';
  onTabChange: (tab: 'canvas' | 'runs') => void;
  onClose: () => void;
  workflow?: WorkflowMeta;
  selectedNode: CanvasNode | null;
  onNodeUpdate?: (nodeId: string, data: Record<string, unknown>) => void;
  onNodeDelete?: (nodeId: string) => void;
  onNodeAdd?: (type: CanvasNodeType, position?: { x: number; y: number }) => void;
  onWorkflowSave?: (meta: Partial<WorkflowMeta>) => void;
  onRunWorkflow?: () => void;
  runs?: RunItem[];
}

export function WorkflowPanel({
  tab,
  onTabChange,
  onClose,
  workflow,
  selectedNode,
  onNodeUpdate,
  onNodeDelete,
  onNodeAdd,
  onWorkflowSave,
  onRunWorkflow,
  runs = [],
}: WorkflowPanelProps) {
  // Workflow meta editing
  const [editName, setEditName] = useState(workflow?.name ?? '');
  const [editCron, setEditCron] = useState(workflow?.cronExpression ?? '');

  useEffect(() => {
    setEditName(workflow?.name ?? '');
    setEditCron(workflow?.cronExpression ?? '');
  }, [workflow?.id]);

  // Node editing
  const [nodeData, setNodeData] = useState<Record<string, unknown>>({});
  useEffect(() => {
    if (selectedNode) setNodeData({ ...selectedNode.data });
    else setNodeData({});
  }, [selectedNode?.id]);

  const handleSaveNode = () => {
    if (selectedNode && onNodeUpdate) {
      onNodeUpdate(selectedNode.id, nodeData);
    }
  };

  // Workflow settings
  const handleSaveWorkflow = () => {
    onWorkflowSave?.({ name: editName, cronExpression: editCron || null });
  };

  const inputClasses = 'rounded border border-border bg-surface-input px-3 py-1.5 text-sm text-content-primary w-full';
  const labelClasses = 'text-xs font-medium text-content-secondary mb-0.5 block';

  return (
    <div className="flex h-full flex-col border-l border-border bg-surface-primary">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex gap-1">
          <button
            onClick={() => onTabChange('canvas')}
            className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
              tab === 'canvas'
                ? 'bg-accent-muted text-accent'
                : 'text-content-tertiary hover:text-content-primary'
            }`}
          >
            Canvas
          </button>
          <button
            onClick={() => onTabChange('runs')}
            className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
              tab === 'runs'
                ? 'bg-accent-muted text-accent'
                : 'text-content-tertiary hover:text-content-primary'
            }`}
          >
            Run History
          </button>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-content-tertiary hover:text-content-primary"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4.646 4.646a.5.5 0 01.708 0L8 7.293l2.646-2.647a.5.5 0 01.708.708L8.707 8l2.647 2.646a.5.5 0 01-.708.708L8 8.707l-2.646 2.647a.5.5 0 01-.708-.708L7.293 8 4.646 5.354a.5.5 0 010-.708z" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {tab === 'canvas' && (
          <div className="space-y-4">
            {/* Workflow meta */}
            {workflow && (
              <section className="rounded-lg border border-border bg-surface-elevated p-3">
                <h3 className="mb-2 text-xs font-semibold text-content-primary">Workflow Settings</h3>
                <div className="space-y-2">
                  <div>
                    <label className={labelClasses}>Name</label>
                    <input
                      className={inputClasses}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={labelClasses}>Schedule (cron)</label>
                    <input
                      className={inputClasses}
                      value={editCron}
                      onChange={(e) => setEditCron(e.target.value)}
                      placeholder="e.g. 0 9 * * 1-5"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveWorkflow}
                      className="rounded bg-accent px-3 py-1 text-xs text-content-inverse hover:bg-accent-hover"
                    >
                      Save
                    </button>
                    {onRunWorkflow && (
                      <button
                        onClick={onRunWorkflow}
                        className="rounded bg-intent-success px-3 py-1 text-xs text-content-inverse hover:bg-intent-success"
                      >
                        Run
                      </button>
                    )}
                  </div>
                </div>
              </section>
            )}

            {/* Node editor */}
            {selectedNode ? (
              <NodeEditor
                node={selectedNode}
                data={nodeData}
                onChange={setNodeData}
                onSave={handleSaveNode}
                onDelete={onNodeDelete ? () => onNodeDelete(selectedNode.id) : undefined}
              />
            ) : (
              <AddNodeSection onAdd={onNodeAdd} />
            )}
          </div>
        )}

        {tab === 'runs' && <RunHistory runs={runs} />}
      </div>
    </div>
  );
}

// ─── Node Editor ──────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] font-medium text-content-secondary mb-0.5 block">{label}</label>
      {children}
    </div>
  );
}

const inputCls = 'rounded border border-border bg-surface-input px-2 py-1 text-xs text-content-primary w-full';

function NodeEditor({
  node, data, onChange, onSave, onDelete,
}: {
  node: CanvasNode;
  data: Record<string, unknown>;
  onChange: (d: Record<string, unknown>) => void;
  onSave: () => void;
  onDelete?: () => void;
}) {
  const t = node.type!;
  const set = (k: string, v: unknown) => onChange({ ...data, [k]: v });

  return (
    <section className="rounded-lg border border-border bg-surface-elevated p-3">
      <h3 className="mb-3 text-xs font-semibold text-content-primary">
        {NODE_LABELS[t] ?? t}
      </h3>

      <div className="space-y-2">
        {/* Common: Title */}
        {t !== 'start' && t !== 'end' && (
          <Field label="Title">
            <input className={inputCls} value={(data.title as string) ?? ''} onChange={(e) => set('title', e.target.value)} />
          </Field>
        )}

        {/* ── LLM ── */}
        {t === 'llm' && (
          <>
            <Field label="Prompt">
              <textarea className={inputCls} rows={3} value={(data.prompt as string) ?? ''} onChange={(e) => set('prompt', e.target.value)} />
            </Field>
            <Field label="Model">
              <input className={inputCls} value={(data.model as string) ?? ''} onChange={(e) => set('model', e.target.value)} placeholder="default" />
            </Field>
            <Field label="Temperature">
              <input className={inputCls} type="number" step="0.1" min="0" max="2" value={(data.temperature as number) ?? ''} onChange={(e) => set('temperature', parseFloat(e.target.value) || undefined)} placeholder="0.7" />
            </Field>
            <Field label="Max Tokens">
              <input className={inputCls} type="number" value={(data.maxTokens as number) ?? ''} onChange={(e) => set('maxTokens', parseInt(e.target.value, 10) || undefined)} placeholder="4096" />
            </Field>
            <Field label="Output Format">
              <select className={inputCls} value={(data.outputFormat as string) ?? 'text'} onChange={(e) => set('outputFormat', e.target.value)}>
                <option value="text">Text</option>
                <option value="json">JSON</option>
                <option value="markdown">Markdown</option>
              </select>
            </Field>
          </>
        )}

        {/* ── Skill ── */}
        {t === 'skill' && (
          <>
            <Field label="Skill ID">
              <input className={inputCls} value={(data.skillId as string) ?? ''} onChange={(e) => set('skillId', e.target.value)} placeholder="Registered skill name" />
            </Field>
            <Field label="Input Mapping (JSON)">
              <textarea className={inputCls} rows={2} value={data.inputMapping ? JSON.stringify(data.inputMapping, null, 2) : ''} onChange={(e) => { try { set('inputMapping', JSON.parse(e.target.value)); } catch { set('inputMapping', e.target.value); } }} placeholder='{"field": "{{steps.prev.output}}"}' />
            </Field>
          </>
        )}

        {/* ── Tool ── */}
        {t === 'tool' && (
          <>
            <Field label="Tool ID">
              <input className={inputCls} value={(data.toolId as string) ?? ''} onChange={(e) => set('toolId', e.target.value)} placeholder="readFile / execCommand / httpRequest" />
            </Field>
            <Field label="Params (JSON)">
              <textarea className={inputCls} rows={2} value={data.inputMapping ? JSON.stringify(data.inputMapping, null, 2) : ''} onChange={(e) => { try { set('inputMapping', JSON.parse(e.target.value)); } catch { set('inputMapping', e.target.value); } }} placeholder='{"path": "{{steps.prev.output}}"}' />
            </Field>
          </>
        )}

        {/* ── Code ── */}
        {t === 'code' && (
          <>
            <Field label="Code">
              <textarea className={`${inputCls} font-mono`} rows={5} value={(data.code as string) ?? ''} onChange={(e) => set('code', e.target.value)} placeholder="function main(input) { return input; }" />
            </Field>
            <Field label="Timeout (ms)">
              <input className={inputCls} type="number" value={(data.codeTimeout as number) ?? 5000} onChange={(e) => set('codeTimeout', parseInt(e.target.value, 10) || 5000)} />
            </Field>
          </>
        )}

        {/* ── Workflow ── */}
        {t === 'workflow' && (
          <>
            <Field label="Workflow ID">
              <input className={inputCls} value={(data.workflowId as string) ?? ''} onChange={(e) => set('workflowId', e.target.value)} placeholder="wf_xxx" />
            </Field>
            <Field label="Input Mapping (JSON)">
              <textarea className={inputCls} rows={2} value={data.inputMapping ? JSON.stringify(data.inputMapping, null, 2) : ''} onChange={(e) => { try { set('inputMapping', JSON.parse(e.target.value)); } catch { set('inputMapping', e.target.value); } }} placeholder='{"param": "{{steps.prev.output}}"}' />
            </Field>
          </>
        )}

        {/* ── AgentGroup ── */}
        {t === 'agentGroup' && (
          <>
            <Field label="Role">
              <input className={inputCls} value={(data.role as string) ?? ''} onChange={(e) => set('role', e.target.value)} placeholder="secretary / curator / custom" />
            </Field>
            <Field label="Model">
              <input className={inputCls} value={(data.model as string) ?? ''} onChange={(e) => set('model', e.target.value)} placeholder="default" />
            </Field>
            <Field label="System Prompt Override">
              <textarea className={inputCls} rows={2} value={(data.systemPrompt as string) ?? ''} onChange={(e) => set('systemPrompt', e.target.value)} placeholder="Override the role's default system prompt" />
            </Field>
            <Field label="Allowed Tools (comma-separated)">
              <input className={inputCls} value={((data.allowedTools as string[]) ?? []).join(', ')} onChange={(e) => set('allowedTools', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} placeholder="web, skills, memory" />
            </Field>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={(data.persistent as boolean) ?? false} onChange={(e) => set('persistent', e.target.checked)} />
              <span className="text-content-secondary">Persistent (keep context across workflow runs)</span>
            </label>
          </>
        )}

        {/* ── If-Else ── */}
        {t === 'ifElse' && (
          <>
            <Field label="Condition Expression">
              <input className={inputCls} value={(data.loopCondition as string) ?? ''} onChange={(e) => set('loopCondition', e.target.value)} placeholder="e.g. {{steps.prev.output}} === 'approved'" />
            </Field>
            <Field label="Branches (JSON)">
              <textarea className={inputCls} rows={3} value={data.branches ? JSON.stringify(data.branches, null, 2) : ''} onChange={(e) => { try { set('branches', JSON.parse(e.target.value)); } catch { set('branches', e.target.value); } }} placeholder='[{"label":"success","conditions":[{"field":"status","operator":"==","value":"ok","logic":"AND"}],"priority":0}]' />
            </Field>
          </>
        )}

        {/* ── Loop ── */}
        {t === 'loop' && (
          <>
            <Field label="Loop Type">
              <select className={inputCls} value={(data.loopType as string) ?? 'count'} onChange={(e) => set('loopType', e.target.value)}>
                <option value="count">Count</option>
                <option value="condition">Condition</option>
              </select>
            </Field>
            {(data.loopType as string) !== 'condition' ? (
              <Field label="Loop Count">
                <input className={inputCls} type="number" value={(data.loopCount as number) ?? 1} onChange={(e) => set('loopCount', parseInt(e.target.value, 10) || 1)} />
              </Field>
            ) : (
              <Field label="Loop Condition">
                <input className={inputCls} value={(data.loopCondition as string) ?? ''} onChange={(e) => set('loopCondition', e.target.value)} placeholder="e.g. {{output}}.length < 10" />
              </Field>
            )}
            <Field label="Max Iterations">
              <input className={inputCls} type="number" value={(data.loopMaxIterations as number) ?? 1000} onChange={(e) => set('loopMaxIterations', parseInt(e.target.value, 10) || 1000)} />
            </Field>
          </>
        )}

        {/* ── Parallel ── */}
        {t === 'parallel' && (
          <>
            <Field label="Wait Strategy">
              <select className={inputCls} value={(data.waitStrategy as string) ?? 'all'} onChange={(e) => set('waitStrategy', e.target.value)}>
                <option value="all">All complete</option>
                <option value="first">First complete</option>
              </select>
            </Field>
            <Field label="Fail Strategy">
              <select className={inputCls} value={(data.failStrategy as string) ?? 'failAll'} onChange={(e) => set('failStrategy', e.target.value)}>
                <option value="failAll">Fail all</option>
                <option value="continue">Continue</option>
              </select>
            </Field>
          </>
        )}

        {/* ── Merge ── */}
        {t === 'merge' && (
          <Field label="Merge Strategy">
            <select className={inputCls} value={(data.mergeStrategy as string) ?? 'object'} onChange={(e) => set('mergeStrategy', e.target.value)}>
              <option value="object">Object</option>
              <option value="array">Array</option>
              <option value="concat">Concat</option>
              <option value="firstNotNull">First Not Null</option>
            </select>
          </Field>
        )}

        {/* ── Intent Classify ── */}
        {t === 'intentClassify' && (
          <>
            <Field label="Intents (JSON)">
              <textarea className={inputCls} rows={3} value={data.intents ? JSON.stringify(data.intents, null, 2) : ''} onChange={(e) => { try { set('intents', JSON.parse(e.target.value)); } catch { set('intents', e.target.value); } }} placeholder='[{"name":"order_query","description":"User asks about order status","examples":["where is my order"]}]' />
            </Field>
            <Field label="Confidence Threshold">
              <input className={inputCls} type="number" step="0.1" min="0" max="1" value={(data.intentThreshold as number) ?? 0.7} onChange={(e) => set('intentThreshold', parseFloat(e.target.value) || 0.7)} />
            </Field>
          </>
        )}

        {/* ── Knowledge Base ── */}
        {t === 'knowledgeBase' && (
          <>
            <Field label="KB ID">
              <input className={inputCls} value={(data.kbId as string) ?? ''} onChange={(e) => set('kbId', e.target.value)} placeholder="Knowledge base name" />
            </Field>
            <Field label="Query Template">
              <input className={inputCls} value={(data.queryTemplate as string) ?? ''} onChange={(e) => set('queryTemplate', e.target.value)} placeholder="{{input}}" />
            </Field>
            <Field label="Top-K">
              <input className={inputCls} type="number" value={(data.topK as number) ?? 5} onChange={(e) => set('topK', parseInt(e.target.value, 10) || 5)} />
            </Field>
            <Field label="Score Threshold">
              <input className={inputCls} type="number" step="0.1" min="0" max="1" value={(data.scoreThreshold as number) ?? 0.7} onChange={(e) => set('scoreThreshold', parseFloat(e.target.value) || 0.7)} />
            </Field>
          </>
        )}

        {/* ── Approval ── */}
        {t === 'approval' && (
          <>
            <Field label="Approval Title">
              <input className={inputCls} value={(data.approvalTitle as string) ?? ''} onChange={(e) => set('approvalTitle', e.target.value)} placeholder="Approval required" />
            </Field>
            <Field label="Description">
              <textarea className={inputCls} rows={2} value={(data.description as string) ?? ''} onChange={(e) => set('description', e.target.value)} />
            </Field>
            <Field label="Options (comma-separated)">
              <input className={inputCls} value={((data.options as string[]) ?? ['approve', 'reject']).join(', ')} onChange={(e) => set('options', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />
            </Field>
          </>
        )}

        {/* ── Human ── */}
        {t === 'human' && (
          <>
            <Field label="Task Title">
              <input className={inputCls} value={(data.title as string) ?? ''} onChange={(e) => set('title', e.target.value)} placeholder="Human task name" />
            </Field>
            <Field label="Description">
              <textarea className={inputCls} rows={2} value={(data.description as string) ?? ''} onChange={(e) => set('description', e.target.value)} />
            </Field>
            <Field label="Output Schema (JSON Schema)">
              <textarea className={`${inputCls} font-mono`} rows={3} value={data.outputSchema ? JSON.stringify(data.outputSchema, null, 2) : ''} onChange={(e) => { try { set('outputSchema', JSON.parse(e.target.value)); } catch { set('outputSchema', e.target.value); } }} placeholder='{"type":"object","properties":{"checked":{"type":"number"},"fixed":{"type":"boolean"}}}' />
            </Field>
            <Field label="Deadline (ISO string)">
              <input className={inputCls} value={(data.humanDeadline as string) ?? ''} onChange={(e) => set('humanDeadline', e.target.value)} placeholder="2026-06-01T12:00:00Z" />
            </Field>
          </>
        )}

        {/* ── Start / End ── */}
        {(t === 'start' || t === 'end') && (
          <Field label="Label">
            <input className={inputCls} value={(data.title as string) ?? ''} onChange={(e) => set('title', e.target.value)} placeholder={t === 'start' ? 'Start' : 'End'} />
          </Field>
        )}
        {t === 'end' && (
          <Field label="Output Variable Name">
            <input className={inputCls} value={(data.outputAs as string) ?? ''} onChange={(e) => set('outputAs', e.target.value)} placeholder="result" />
          </Field>
        )}

        {/* Pass / Merge / Parallel - just title */}
      </div>

      <div className="mt-3 flex gap-2">
        <button onClick={onSave} className="rounded bg-accent px-3 py-1 text-xs text-content-inverse hover:bg-accent-hover">Apply</button>
        {onDelete && (
          <button onClick={onDelete} className="rounded px-3 py-1 text-xs text-intent-danger hover:bg-intent-danger-muted">Delete</button>
        )}
      </div>
    </section>
  );
}

// ─── Add Node ─────────────────────────────────────────────────

function AddNodeSection({ onAdd }: { onAdd?: (type: CanvasNodeType, position?: {x:number;y:number}) => void }) {
  if (!onAdd) return null;

  const handleDragStart = (event: React.DragEvent, type: CanvasNodeType) => {
    event.dataTransfer.setData('application/reactflow-type', type);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <section className="rounded-lg border border-dashed border-border bg-surface-input p-3">
      <h3 className="mb-2 text-xs font-semibold text-content-secondary">
        Node Palette <span className="font-normal text-content-tertiary">(drag to canvas)</span>
      </h3>
      <div className="grid grid-cols-2 gap-1.5">
        {CANVAS_NODE_TYPES.map((type) => (
          <div
            key={type}
            draggable
            onDragStart={(e) => handleDragStart(e, type)}
            onClick={() => onAdd(type)}
            className="cursor-grab active:cursor-grabbing rounded border border-border bg-surface-primary px-2 py-1.5 text-xs text-content-secondary hover:bg-surface-elevated hover:text-content-primary transition-colors select-none"
          >
            + {NODE_LABELS[type]}
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Run History ──────────────────────────────────────────────

function RunHistory({ runs }: { runs: RunItem[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (runs.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-content-tertiary">No run history yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {runs.map((run) => (
        <div
          key={run.runId}
          className="rounded-lg border border-border bg-surface-elevated p-3"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  run.status === 'completed' ? 'bg-intent-success' : run.status === 'failed' ? 'bg-intent-danger' : 'bg-accent'
                }`}
              />
              <span className="text-xs font-medium text-content-primary">{run.status}</span>
              <span className="text-[11px] text-content-tertiary">
                {new Date(run.timestamp).toLocaleString()}
              </span>
            </div>
            <button
              onClick={() => setExpanded(expanded === run.runId ? null : run.runId)}
              className="text-xs text-accent hover:underline"
            >
              {expanded === run.runId ? 'Hide' : 'Steps'} ({run.steps.length})
            </button>
          </div>

          {expanded === run.runId && (
            <div className="mt-2 space-y-1 border-t border-border pt-2">
              {run.steps.map((step, i) => (
                <div key={i} className="text-[11px]">
                  <span className="text-content-tertiary font-mono">{step.nodeId ?? step.type ?? `step_${i}`}</span>
                  {step.output && (
                    <p className="mt-0.5 text-content-secondary truncate max-w-[300px]">
                      {step.output.slice(0, 120)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
