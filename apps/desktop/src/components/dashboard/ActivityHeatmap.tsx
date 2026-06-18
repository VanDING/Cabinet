import { useEffect, useState } from 'react';
import { apiFetch } from '../../utils/api.js';

interface TrendDay {
  date: string;
  sessions: number;
  tasks: number;
}

const LEVEL_COLORS = [
  'var(--surface-muted)',
  'rgba(16,185,129,0.2)',
  'rgba(16,185,129,0.4)',
  'rgba(16,185,129,0.6)',
  'rgba(16,185,129,0.85)',
];

function toLevel(sessions: number, tasks: number): number {
  const total = sessions + tasks;
  if (total === 0) return 0;
  if (total <= 3) return 1;
  if (total <= 8) return 2;
  if (total <= 15) return 3;
  return 4;
}

export function ActivityHeatmap() {
  const [levels, setLevels] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/api/dashboard/trends?days=84')
      .then((r) => r.json())
      .then((data) => {
        const days = (data.trends ?? []) as TrendDay[];
        setLevels(days.map((d) => toLevel(d.sessions, d.tasks)));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ padding: 20, color: 'var(--content-tertiary)', fontSize: 13 }}>Loading...</div>
    );
  }

  // Pad to 84 cells (12 weeks × 7 days)
  const cells = levels.slice(-84);
  while (cells.length < 84) cells.unshift(0);

  return (
    <div style={{ padding: '20px 24px' }}>
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
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          Activity
        </div>
        <div style={{ fontSize: 12, color: 'var(--content-tertiary)' }}>Last 12 weeks</div>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            paddingTop: 16,
            minWidth: 24,
          }}
        >
          {['Apr', 'May', 'Jun'].map((m) => (
            <div key={m} style={{ fontSize: 10, color: 'var(--content-tertiary)' }}>
              {m}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          {cells.map((level, i) => (
            <div
              key={i}
              style={{
                width: 11,
                height: 11,
                borderRadius: 2,
                background: LEVEL_COLORS[level] ?? LEVEL_COLORS[0],
              }}
            />
          ))}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          marginTop: 10,
          justifyContent: 'flex-end',
          fontSize: 10,
          color: 'var(--content-tertiary)',
        }}
      >
        <span>Less</span>
        {LEVEL_COLORS.map((c) => (
          <div key={c} style={{ width: 10, height: 10, borderRadius: 2, background: c }} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}
