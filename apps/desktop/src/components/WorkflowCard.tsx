import { useMemo } from 'react';
import { ReactFlow, Background, type Node, type Edge, BackgroundVariant } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Play, Pause, Pencil, History } from 'lucide-react';
import { definitionToCanvas } from '../factory/converter';
import { NODE_COLORS } from '../factory/node-types';
import type { CanvasNode, CanvasNodeType } from '../factory/node-types';

export interface WorkflowItem {
  id: string;
  name: string;
  definition: Record<string, unknown>;
  status: string;
  cronExpression?: string | null;
  createdAt?: string;
  lastRunAt?: string;
}

interface WorkflowCardProps {
  workflow: WorkflowItem;
  onRun: (id: string) => void;
  onEdit: (id: string) => void;
  onViewHistory: (id: string) => void;
  onPause?: (id: string) => void;
}

const miniNodeTypes = {
  start: MiniNode,
  end: MiniNode,
  ifElse: MiniNode,
  loop: MiniNode,
  parallel: MiniNode,
  merge: MiniNode,
  pass: MiniNode,
  agentGroup: MiniNode,
  llm: MiniNode,
  skill: MiniNode,
  tool: MiniNode,
  code: MiniNode,
  workflow: MiniNode,
  intentClassify: MiniNode,
  knowledgeBase: MiniNode,
  approval: MiniNode,
  human: MiniNode,
  externalAgent: MiniNode,
  manager: MiniNode,
} as const;

function MiniNode({ data, type }: { data?: Record<string, unknown>; type?: string }) {
  const colorClass =
    NODE_COLORS[(type as CanvasNodeType) ?? 'pass'] ?? 'bg-surface-muted border-border';
  return (
    <div
      className={`flex h-6 w-6 items-center justify-center rounded-full border ${colorClass}`}
      title={String(data?.title ?? type)}
    >
      <span className="text-[8px]">{(type?.charAt(0) ?? '').toUpperCase()}</span>
    </div>
  );
}

function formatRelativeTime(dateStr?: string): string {
  if (!dateStr) return 'never';
  const d = new Date(dateStr);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

function formatCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour] = parts as string[];
  if (min === '*' && hour === '*') return 'Every minute';
  if (min === '0' && hour === '*') return 'Every hour';
  if (min!.startsWith('*/')) {
    const interval = parseInt(min!.slice(2), 10);
    if (!isNaN(interval)) return `Every ${interval} min`;
  }
  const h = parseInt(hour!, 10);
  const m = parseInt(min!, 10);
  if (!isNaN(h) && !isNaN(m))
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} daily`;
  return expr;
}

export function WorkflowCard({
  workflow,
  onRun,
  onEdit,
  onViewHistory,
  onPause,
}: WorkflowCardProps) {
  const { nodes, edges } = useMemo(() => {
    try {
      return definitionToCanvas(workflow.definition as any);
    } catch {
      return { nodes: [], edges: [] };
    }
  }, [workflow.definition]);

  const triggerLabel = workflow.cronExpression ? formatCron(workflow.cronExpression) : 'Manual';

  const isRunning = workflow.status === 'running';

  return (
    <div className="border-border bg-surface-primary flex flex-col rounded-xl border p-4 shadow-xs transition-shadow hover:shadow-md">
      {/* Top: name + status + trigger + last run */}
      <div className="mb-3 flex items-start justify-between">
        <div className="min-w-0">
          <h3 className="text-content-primary truncate text-sm font-semibold">{workflow.name}</h3>
          <div className="text-content-tertiary mt-0.5 flex items-center gap-2 text-xs">
            <StatusBadge status={workflow.status} />
            <span>·</span>
            <span>{triggerLabel}</span>
            {workflow.lastRunAt && (
              <>
                <span>·</span>
                <span>Last: {formatRelativeTime(workflow.lastRunAt)}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Middle: mini read-only flow */}
      {nodes.length > 0 && (
        <div className="border-border bg-surface-muted mb-3 h-[180px] w-full overflow-hidden rounded-lg border">
          <ReactFlow
            nodes={nodes as Node[]}
            edges={edges as Edge[]}
            nodeTypes={miniNodeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            panOnDrag={false}
            zoomOnScroll={false}
            zoomOnPinch={false}
            zoomOnDoubleClick={false}
            selectionOnDrag={false}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.05}
            maxZoom={1}
            className="!bg-surface-muted"
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1}
              color="var(--graph-bg-grid, #ccc)"
            />
          </ReactFlow>
        </div>
      )}

      {/* Bottom: actions */}
      <div className="mt-auto flex items-center gap-2">
        <button
          onClick={() => onRun(workflow.id)}
          disabled={isRunning}
          className="bg-accent text-content-inverse hover:bg-accent-hover inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          <Play size={12} />
          {isRunning ? 'Running…' : 'Run'}
        </button>
        {isRunning && onPause && (
          <button
            onClick={() => onPause(workflow.id)}
            className="border-border text-content-secondary hover:bg-surface-elevated inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs"
          >
            <Pause size={12} />
            Pause
          </button>
        )}
        <button
          onClick={() => onEdit(workflow.id)}
          className="border-border text-content-secondary hover:bg-surface-elevated inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs"
        >
          <Pencil size={12} />
          Edit
        </button>
        <button
          onClick={() => onViewHistory(workflow.id)}
          className="border-border text-content-secondary hover:bg-surface-elevated inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs"
        >
          <History size={12} />
          History
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'running'
      ? 'bg-accent-muted text-accent'
      : status === 'completed'
        ? 'bg-intent-success-muted text-intent-success'
        : status === 'failed'
          ? 'bg-intent-danger-muted text-intent-danger'
          : status === 'paused'
            ? 'bg-intent-warning-muted text-intent-warning'
            : 'bg-surface-muted text-content-secondary';
  return (
    <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>
      {status}
    </span>
  );
}
