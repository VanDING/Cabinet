import { KanbanCard, type KanbanTask } from './KanbanCard.js';

const DOT_COLORS: Record<string, string> = {
  todo: 'var(--content-tertiary)',
  in_progress: 'var(--accent)',
  in_review: 'var(--intent-warning)',
  done: 'var(--intent-success)',
};

const LABELS: Record<string, string> = {
  todo: 'Todo',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
};

export function KanbanColumn({ tasks, column }: { tasks: KanbanTask[]; column: string }) {
  return (
    <div
      style={{
        background: 'var(--surface-elevated)',
        borderRadius: 8,
        padding: 12,
        minHeight: 160,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: DOT_COLORS[column] ?? 'var(--content-tertiary)',
          }}
        />
        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--content-primary)' }}>
          {LABELS[column] ?? column}
        </span>
        <span
          style={{
            background: 'var(--surface-muted)',
            padding: '0 6px',
            borderRadius: 6,
            fontSize: 10,
            color: 'var(--content-tertiary)',
          }}
        >
          {tasks.length}
        </span>
      </div>
      {tasks.map((task) => (
        <KanbanCard key={task.id} task={task} column={column} />
      ))}
    </div>
  );
}

export type { KanbanTask } from './KanbanCard.js';
