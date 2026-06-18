import { useEffect, useState } from 'react';
import { apiFetch } from '../../utils/api.js';
import { KanbanColumn, type KanbanTask } from './KanbanColumn.js';

type KanbanData = Record<string, KanbanTask[]>;

const COLUMNS = ['todo', 'in_progress', 'in_review', 'done'];

export function KanbanBoard() {
  const [board, setBoard] = useState<KanbanData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/api/tasks/kanban')
      .then((r) => r.json())
      .then((data) => {
        setBoard(data.kanban);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ padding: 20, color: 'var(--content-tertiary)', fontSize: 13 }}>Loading...</div>
    );
  }

  return (
    <div style={{ padding: '20px 24px 24px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 14,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--content-primary)',
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          Projects
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
        {COLUMNS.map((col) => (
          <KanbanColumn key={col} column={col} tasks={board?.[col] ?? []} />
        ))}
      </div>
    </div>
  );
}
