import { useEffect, useState, useMemo } from 'react';
import { apiFetch } from '../../utils/api.js';

interface TrendDay {
  date: string;
  sessions: number;
  tasks: number;
}

const LEVEL_COLORS = [
  'var(--surface-muted)',
  'color-mix(in srgb, var(--accent) 20%, transparent)',
  'color-mix(in srgb, var(--accent) 40%, transparent)',
  'color-mix(in srgb, var(--accent) 60%, transparent)',
  'color-mix(in srgb, var(--accent) 85%, transparent)',
];

function toLevel(sessions: number, tasks: number): number {
  const total = sessions + tasks;
  if (total === 0) return 0;
  if (total <= 3) return 1;
  if (total <= 8) return 2;
  if (total <= 15) return 3;
  return 4;
}

/** Map JS day-of-week (0=Sun) to GitHub row index (0=Mon). */
function gitHubRow(jsDay: number): number {
  return jsDay === 0 ? 6 : jsDay - 1;
}

const DAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', ''];

export function ActivityHeatmap() {
  const [levels, setLevels] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/api/dashboard/trends?days=365')
      .then((r) => r.json())
      .then((data) => {
        const days = (data.trends ?? []) as TrendDay[];
        setLevels(days.map((d) => toLevel(d.sessions, d.tasks)));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const { weeks, monthLabels } = useMemo(() => {
    if (levels.length === 0)
      return { weeks: [], monthLabels: [] as { week: number; label: string }[] };

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const levelMap = new Map<string, number>();
    for (let i = levels.length - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - (levels.length - 1 - i));
      levelMap.set(d.toISOString().slice(0, 10), levels[i] ?? 0);
    }

    // Start 364 days ago, walk back to preceding Monday
    const start = new Date(today);
    start.setDate(start.getDate() - 364);
    start.setDate(start.getDate() - gitHubRow(start.getDay()));

    const cols: { level: number; date: Date }[][] = [];
    const labels: { week: number; label: string }[] = [];
    const cursor = new Date(start);

    for (let w = 0; w < 53; w++) {
      const col: { level: number; date: Date }[] = [];
      for (let r = 0; r < 7; r++) {
        const date = new Date(cursor);
        const dateStr = date.toISOString().slice(0, 10);
        col.push({ level: levelMap.get(dateStr) ?? 0, date });
        if (date.getDate() === 1) {
          labels.push({ week: w, label: date.toLocaleDateString('en-US', { month: 'short' }) });
        }
        cursor.setDate(cursor.getDate() + 1);
      }
      cols.push(col);
    }

    return { weeks: cols, monthLabels: labels };
  }, [levels]);

  if (loading) {
    return (
      <div style={{ padding: '20px 24px', color: 'var(--content-tertiary)', fontSize: 13 }}>
        Loading...
      </div>
    );
  }

  return (
    <div style={{ padding: '20px 24px' }}>
      {/* Title row */}
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
        <div style={{ fontSize: 12, color: 'var(--content-tertiary)' }}>Last 12 months</div>
      </div>

      {/* Month labels row — flex columns match the grid below */}
      <div style={{ display: 'flex', marginLeft: 26, marginBottom: 2 }}>
        {weeks.map((_col, wi) => {
          const ml = monthLabels.find((m) => m.week === wi);
          return (
            <div
              key={wi}
              style={{
                flex: 1,
                fontSize: 9,
                color: 'var(--content-tertiary)',
                lineHeight: 1,
                textAlign: 'left',
              }}
            >
              {ml ? ml.label : ''}
            </div>
          );
        })}
      </div>

      {/* Grid area: day labels + week columns */}
      <div style={{ display: 'flex', gap: 0 }}>
        {/* Day labels */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            minWidth: 22,
            paddingRight: 4,
          }}
        >
          {DAY_LABELS.map((label, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                fontSize: 9,
                color: 'var(--content-tertiary)',
                visibility: label ? 'visible' : 'hidden',
              }}
            >
              {label || '.'}
            </div>
          ))}
        </div>

        {/* Cells grid — columns fill remaining width, cells are square */}
        <div style={{ flex: 1, display: 'flex', gap: 3 }}>
          {weeks.map((col, wi) => (
            <div key={wi} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {col.map((cell, ri) => (
                <div
                  key={ri}
                  style={{
                    flex: 1,
                    aspectRatio: '1',
                    borderRadius: 2,
                    background: LEVEL_COLORS[cell.level] ?? LEVEL_COLORS[0],
                  }}
                  title={`${cell.date.toLocaleDateString('en-US', {
                    weekday: 'short',
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
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
