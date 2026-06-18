# Dashboard Redesign 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 将 OfficePage 从旧 widget 系统重写为三区布局（欢迎区 + 热力图/费用 + 看板）

**架构：** 前端 4 个新组件（WelcomeHeader / ActivityHeatmap / KanbanBoard+Column+Card），后端 1 个新路由（tasks kanban API），复用已有 CostChart 和 trends/cost-history API

**技术栈：** React + lucide-react + Hono + better-sqlite3

---

## 文件结构

```
新建:
  apps/server/src/routes/tasks.ts          — 看板 API
  apps/desktop/src/components/dashboard/
    WelcomeHeader.tsx                       — 欢迎区
    ActivityHeatmap.tsx                     — 热力图
    KanbanBoard.tsx                         — 看板容器
    KanbanColumn.tsx                        — 看板列
    KanbanCard.tsx                          — 看板卡片

修改:
  apps/server/src/index.ts                  — 注册 /api/tasks 路由
  apps/desktop/src/pages/OfficePage.tsx     — 重写页面

复用（不修改）:
  apps/desktop/src/components/office/CostChart.tsx  — 费用分析
  apps/server/src/routes/dashboard.ts               — trends + cost-history API
```

---

### Task 1: 扩展 agent_task_queue 表 — migration

**Files:**

- Create: `packages/storage/src/migrations/028_task_kanban_fields.ts`
- Modify: `packages/storage/src/migrations/runner.ts`

- [ ] **Step 1: 创建 migration 文件**

```typescript
// packages/storage/src/migrations/028_task_kanban_fields.ts
import type Database from 'better-sqlite3';

export function runMigration028(db: Database.Database): void {
  // Add title and priority columns to agent_task_queue
  const tableInfo = db.prepare("PRAGMA table_info('agent_task_queue')").all() as Array<{
    name: string;
  }>;
  const columns = tableInfo.map((r) => r.name);

  if (!columns.includes('title')) {
    db.prepare("ALTER TABLE agent_task_queue ADD COLUMN title TEXT NOT NULL DEFAULT ''").run();
  }
  if (!columns.includes('priority')) {
    db.prepare("ALTER TABLE agent_task_queue ADD COLUMN priority TEXT NOT NULL DEFAULT 'P2'").run();
  }
}
```

- [ ] **Step 2: 注册到 runner**

```typescript
// packages/storage/src/migrations/runner.ts — 追加到 MIGRATIONS 数组
import { runMigration028 } from './028_task_kanban_fields.js';

// 在数组末尾添加:
{ version: 28, name: '028_task_kanban_fields', up: runMigration028 },
```

- [ ] **Step 3: 导出**

```typescript
// packages/storage/src/index.ts — 追加
export { runMigration028 } from './migrations/028_task_kanban_fields.js';
```

- [ ] **Step 4: 提交**

```bash
git add packages/storage/src/migrations/028_task_kanban_fields.ts packages/storage/src/index.ts
git commit -m "feat: add kanban fields to agent_task_queue (title, priority)"
```

---

### Task 2: 看板 API 路由

**Files:**

- Create: `apps/server/src/routes/tasks.ts`
- Modify: `apps/server/src/index.ts`

- [ ] **Step 1: 创建 tasks.ts 路由文件**

```typescript
// apps/server/src/routes/tasks.ts
import { Hono } from 'hono';
import { getServerContext } from '../context.js';

export const tasksRouter = new Hono();

tasksRouter.get('/kanban', (c) => {
  const { db, logger } = getServerContext();
  const projectId = c.req.query('projectId');

  try {
    let rows: Array<{
      id: string;
      title: string;
      status: string;
      priority: string;
      agent_id: string;
      task_type: string;
      created_at: string;
    }>;

    if (projectId) {
      rows = db
        .prepare(
          `
        SELECT id, title, status, priority, agent_id, task_type, created_at
        FROM agent_task_queue
        WHERE project_id = ?
        ORDER BY created_at DESC
      `,
        )
        .all(projectId) as typeof rows;
    } else {
      rows = db
        .prepare(
          `
        SELECT id, title, status, priority, agent_id, task_type, created_at
        FROM agent_task_queue
        ORDER BY created_at DESC
        LIMIT 50
      `,
        )
        .all() as typeof rows;
    }

    const kanban: Record<string, typeof rows> = {
      todo: [],
      in_progress: [],
      in_review: [],
      done: [],
    };

    const STATUS_MAP: Record<string, string> = {
      queued: 'todo',
      running: 'in_progress',
      completed: 'done',
      failed: 'done',
      reviewed: 'in_review',
    };

    for (const row of rows) {
      const col = STATUS_MAP[row.status] ?? 'todo';
      if (kanban[col]) {
        kanban[col].push(row);
      }
    }

    return c.json({ kanban });
  } catch (err) {
    logger.warn('Failed to load kanban tasks', { error: (err as Error).message });
    return c.json({
      kanban: { todo: [], in_progress: [], in_review: [], done: [] },
    });
  }
});
```

- [ ] **Step 2: 注册路由**

```typescript
// apps/server/src/index.ts — 追加 import 和 route
import { tasksRouter } from './routes/tasks.js';

// 在 app.route(...) 区域追加
app.route('/api/tasks', tasksRouter);
```

- [ ] **Step 3: 提交**

```bash
git add apps/server/src/routes/tasks.ts apps/server/src/index.ts
git commit -m "feat: add kanban API endpoint (GET /api/tasks/kanban)"
```

---

### Task 3: WelcomeHeader 组件

**Files:**

- Create: `apps/desktop/src/components/dashboard/WelcomeHeader.tsx`

- [ ] **Step 1: 实现组件**

```typescript
// apps/desktop/src/components/dashboard/WelcomeHeader.tsx
import { useMemo } from 'react';

const GREETINGS = ['Good morning', 'Good afternoon', 'Good evening'];

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return GREETINGS[0]!;
  if (h < 18) return GREETINGS[1]!;
  return GREETINGS[2]!;
}

export function WelcomeHeader() {
  const greeting = useMemo(() => getGreeting(), []);

  return (
    <div style={{ padding: '32px 32px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {/* SecretaryOrb-style avatar */}
        <div style={{
          width: 48, height: 48, borderRadius: 12,
          background: 'linear-gradient(135deg, var(--accent), var(--intent-purple))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 16px rgba(79,70,229,0.25)',
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
            stroke="var(--accent-foreground)" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <circle cx="9" cy="10" r="1.5" fill="var(--accent-foreground)"/>
            <circle cx="15" cy="10" r="1.5" fill="var(--accent-foreground)"/>
            <path d="M8 16c0 0 1.5 2 4 2s4-2 4-2"/>
          </svg>
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--content-primary)' }}>
            {greeting}, Captain
          </div>
          <div style={{ fontSize: 13, color: 'var(--content-secondary)', marginTop: 2 }}>
            Select a project or start a new task to begin working with your agents.
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
        {[
          { icon: 'plus', label: 'New Project' },
          { icon: 'file', label: 'Quick Task' },
          { icon: 'folder', label: 'Open Recent' },
        ].map((action) => (
          <div key={action.label} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 16px', borderRadius: 8, fontSize: 13,
            fontWeight: 500, cursor: 'default', color: 'var(--content-secondary)',
            ...(action.label === 'New Project'
              ? { border: '1px solid var(--border-color)', background: 'var(--surface-elevated)', color: 'var(--content-primary)' }
              : {}),
          }}>
            {action.label}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add apps/desktop/src/components/dashboard/WelcomeHeader.tsx
git commit -m "feat: add WelcomeHeader dashboard component"
```

---

### Task 4: ActivityHeatmap 组件

**Files:**

- Create: `apps/desktop/src/components/dashboard/ActivityHeatmap.tsx`

- [ ] **Step 1: 实现组件**

```typescript
// apps/desktop/src/components/dashboard/ActivityHeatmap.tsx
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
    return <div style={{ padding: 20, color: 'var(--content-tertiary)', fontSize: 13 }}>Loading...</div>;
  }

  // Pad to 84 cells (12 weeks × 7 days)
  const cells = levels.slice(-84);
  while (cells.length < 84) cells.unshift(0);

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 600, color: 'var(--content-primary)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          Activity
        </div>
        <div style={{ fontSize: 12, color: 'var(--content-tertiary)' }}>Last 12 weeks</div>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 16, minWidth: 24 }}>
          {['Apr', 'May', 'Jun'].map((m) => (
            <div key={m} style={{ fontSize: 10, color: 'var(--content-tertiary)' }}>{m}</div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          {cells.map((level, i) => (
            <div key={i} style={{
              width: 11, height: 11, borderRadius: 2,
              background: LEVEL_COLORS[level] ?? LEVEL_COLORS[0],
            }} />
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 10, justifyContent: 'flex-end', fontSize: 10, color: 'var(--content-tertiary)' }}>
        <span>Less</span>
        {LEVEL_COLORS.map((c) => (
          <div key={c} style={{ width: 10, height: 10, borderRadius: 2, background: c }} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add apps/desktop/src/components/dashboard/ActivityHeatmap.tsx
git commit -m "feat: add ActivityHeatmap dashboard component (GitHub-style)"
```

---

### Task 5: KanbanBoard / KanbanColumn / KanbanCard 组件

**Files:**

- Create: `apps/desktop/src/components/dashboard/KanbanCard.tsx`
- Create: `apps/desktop/src/components/dashboard/KanbanColumn.tsx`
- Create: `apps/desktop/src/components/dashboard/KanbanBoard.tsx`

- [ ] **Step 1: KanbanCard**

```typescript
// apps/desktop/src/components/dashboard/KanbanCard.tsx
export interface KanbanTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  agent_id: string;
  task_type: string;
}

const COLORS: Record<string, string> = {
  todo: 'var(--content-tertiary)',
  in_progress: 'var(--accent)',
  in_review: 'var(--intent-warning)',
  done: 'var(--intent-success)',
};

export function KanbanCard({ task, column }: { task: KanbanTask; column: string }) {
  const isDone = column === 'done';
  return (
    <div style={{
      background: 'var(--surface-primary)', borderRadius: 6, padding: 10, marginBottom: 6,
      border: '1px solid var(--surface-muted)',
      ...(column !== 'todo' && column !== 'done'
        ? { borderLeft: `3px solid ${COLORS[column] ?? 'var(--content-tertiary)'}` }
        : {}),
    }}>
      <div style={{
        fontSize: 12, fontWeight: 500,
        color: isDone ? 'var(--content-tertiary)' : 'var(--content-primary)',
        ...(isDone ? { textDecoration: 'line-through' } : {}),
      }}>
        {task.title}
      </div>
      <div style={{ fontSize: 10, color: 'var(--content-tertiary)', marginTop: 4 }}>
        {task.task_type} · {task.priority}
      </div>
      {task.agent_id && column === 'in_progress' && (
        <div style={{ marginTop: 6 }}>
          <span style={{
            background: 'var(--accent-muted)', color: 'var(--accent)',
            padding: '1px 6px', borderRadius: 3, fontSize: 9,
          }}>
            Agent: {task.agent_id}
          </span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: KanbanColumn**

```typescript
// apps/desktop/src/components/dashboard/KanbanColumn.tsx
import { KanbanCard, type KanbanTask } from './KanbanCard.js';

const COLORS: Record<string, string> = {
  todo: 'var(--content-tertiary)',
  in_progress: 'var(--accent)',
  in_review: 'var(--intent-warning)',
  done: 'var(--intent-success)',
};

export function KanbanColumn({
  title, tasks, column,
}: {
  title: string; tasks: KanbanTask[]; column: string;
}) {
  const dotColor = COLORS[column] ?? 'var(--content-tertiary)';

  return (
    <div style={{ background: 'var(--surface-elevated)', borderRadius: 8, padding: 12, minHeight: 160 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor }} />
        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--content-primary)' }}>{title}</span>
        <span style={{ background: 'var(--surface-muted)', padding: '0 6px', borderRadius: 6, fontSize: 10, color: 'var(--content-tertiary)' }}>
          {tasks.length}
        </span>
      </div>
      {tasks.map((task) => (
        <KanbanCard key={task.id} task={task} column={column} />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: KanbanBoard**

```typescript
// apps/desktop/src/components/dashboard/KanbanBoard.tsx
import { useEffect, useState } from 'react';
import { apiFetch } from '../../utils/api.js';
import { KanbanColumn, type KanbanTask } from './KanbanColumn.js';

type KanbanData = Record<string, KanbanTask[]>;

const COLUMNS = [
  { key: 'todo', label: 'Todo' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'in_review', label: 'In Review' },
  { key: 'done', label: 'Done' },
];

export function KanbanBoard({ projectId }: { projectId?: string }) {
  const [board, setBoard] = useState<KanbanData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = projectId ? `?projectId=${projectId}` : '';
    apiFetch(`/api/tasks/kanban${params}`)
      .then((r) => r.json())
      .then((data) => { setBoard(data.kanban); setLoading(false); })
      .catch(() => setLoading(false));
  }, [projectId]);

  if (loading) {
    return <div style={{ padding: 20, color: 'var(--content-tertiary)', fontSize: 13 }}>Loading...</div>;
  }

  return (
    <div style={{ padding: '20px 24px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 600, color: 'var(--content-primary)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          Projects
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
        {COLUMNS.map((col) => (
          <KanbanColumn
            key={col.key}
            title={col.label}
            column={col.key}
            tasks={board?.[col.key] ?? []}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 提交**

```bash
git add apps/desktop/src/components/dashboard/KanbanCard.tsx apps/desktop/src/components/dashboard/KanbanColumn.tsx apps/desktop/src/components/dashboard/KanbanBoard.tsx
git commit -m "feat: add KanbanBoard component (Todo/InProgress/Review/Done)"
```

---

### Task 6: 重写 OfficePage

**Files:**

- Rewrite: `apps/desktop/src/pages/OfficePage.tsx`

- [ ] **Step 1: 重写页面**

```typescript
// apps/desktop/src/pages/OfficePage.tsx
import { WelcomeHeader } from '../components/dashboard/WelcomeHeader.js';
import { ActivityHeatmap } from '../components/dashboard/ActivityHeatmap.js';
import { CostChart } from '../components/office/CostChart.js';
import { KanbanBoard } from '../components/dashboard/KanbanBoard.js';

export function OfficePage() {
  return (
    <div style={{
      maxWidth: 1200, margin: '0 auto', padding: '0 24px',
      display: 'flex', flexDirection: 'column', gap: 0,
    }}>
      {/* ── Welcome ── */}
      <WelcomeHeader />

      {/* ── Divider ── */}
      <div style={{ height: 1, background: 'var(--surface-muted)', margin: '0 32px' }} />

      {/* ── Heatmap + Cost (equal width) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
        <ActivityHeatmap />
        <div style={{ width: 1, background: 'var(--surface-muted)' }} />
        <CostChart />
      </div>

      {/* ── Divider ── */}
      <div style={{ height: 1, background: 'var(--surface-muted)', margin: '0 32px' }} />

      {/* ── Kanban ── */}
      <KanbanBoard />
    </div>
  );
}
```

- [ ] **Step 2: 构建验证**

```bash
pnpm -F @cabinet/desktop build
# 预期: Standalone server ready (0 errors)
```

- [ ] **Step 3: 提交**

```bash
git add apps/desktop/src/pages/OfficePage.tsx
git commit -m "feat: rewrite OfficePage with new dashboard layout"
```
