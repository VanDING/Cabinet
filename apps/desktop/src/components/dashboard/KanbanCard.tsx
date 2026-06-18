export interface KanbanTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  agent_id: string;
  task_type: string;
}

export function KanbanCard({ task, column }: { task: KanbanTask; column: string }) {
  const isDone = column === 'done';

  return (
    <div
      style={{
        background: 'var(--surface-primary)',
        borderRadius: 6,
        padding: 10,
        marginBottom: 6,
        border: '1px solid var(--surface-muted)',
        ...(column !== 'todo' && column !== 'done'
          ? {
              borderLeft: `3px solid ${
                column === 'in_progress'
                  ? 'var(--accent)'
                  : column === 'in_review'
                    ? 'var(--intent-warning)'
                    : 'var(--content-tertiary)'
              }`,
            }
          : {}),
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: isDone ? 'var(--content-tertiary)' : 'var(--content-primary)',
          ...(isDone ? { textDecoration: 'line-through' } : {}),
        }}
      >
        {task.title}
      </div>
      <div style={{ fontSize: 10, color: 'var(--content-tertiary)', marginTop: 4 }}>
        {task.task_type} · {task.priority}
      </div>
      {task.agent_id && column === 'in_progress' && (
        <div style={{ marginTop: 6 }}>
          <span
            style={{
              background: 'var(--accent-muted)',
              color: 'var(--accent)',
              padding: '1px 6px',
              borderRadius: 3,
              fontSize: 9,
            }}
          >
            Agent: {task.agent_id}
          </span>
        </div>
      )}
    </div>
  );
}
