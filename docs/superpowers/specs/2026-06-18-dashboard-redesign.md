# Dashboard 重新设计方案

> 定稿日期：2026-06-18
> 状态：已批准

---

## 一、布局结构

```
┌──────────────────────────────────────────────────────────┐
│  🟣 Good morning, Captain                                │
│     Select a project or start a new task...               │
│  [+ New Project]  [Quick Task]  [Open Recent]            │
├──────────────────────────────────────────────────────────┤
│  📊 Activity              │  💰 Cost                     │
│  [GitHub-style heatmap]   │  [Bar chart]                  │
│  窄长，等宽                │  D/W/M 切换                  │
│                            │  ¥24.50 / ¥168.30 / ¥682.10 │
├──────────────────────────────────────────────────────────┤
│  📁 Projects                          [+ New] [Filter]   │
│  ┌──────┬────────────┬──────────┬──────┐                 │
│  │ Todo │ In Progress│In Review │ Done │                 │
│  │  ⚪   │    🔵      │   🟡    │  🟢  │                 │
│  └──────┴────────────┴──────────┴──────┘                 │
└──────────────────────────────────────────────────────────┘
```

### 三块区域

| 区域   | 占比 | 内容                                                 |
| ------ | ---- | ---------------------------------------------------- |
| 欢迎区 | ~25% | SecretaryOrb 头像 + 问候语 + 快捷操作按钮            |
| 中间区 | ~30% | 左侧热力图 + 右侧费用分析（等宽 1:1）                |
| 看板区 | ~45% | 四栏 Kanban（Todo / In Progress / In Review / Done） |

---

## 二、各区域详细设计

### 2.1 欢迎区

- **头像**：使用 SecretaryOrb 风格的渐变圆形图标（`--accent` → `--intent-purple` 渐变），SVG 脸部表情
- **标题**：`Good morning/afternoon/evening, Captain`（根据时间动态）
- **副标题**：`Select a project or start a new task to begin working with your agents.`
- **快捷操作**：三个按钮
  - `+ New Project` — 带 Plus 图标，实心按钮风格（--surface-elevated + border）
  - `Quick Task` — 带 FileText 图标，文字按钮风格
  - `Open Recent` — 带 FolderOpen 图标，文字按钮风格
- **无统计卡片**、无渐变背景、无过多装饰

### 2.2 热力图

- **标题**：Activity（带 Activity 图标）
- **副标题**："Last 12 weeks"
- **数据**：12 周 × 7 天网格 = 84 个格子
- **颜色**：5 级灰度（从 `--surface-muted` 到 `rgba(16,185,129,0.85)`）
- **左侧**：月份标签（Apr / May / Jun）
- **底部**：Less / More 图例
- **后端 API**：`GET /api/dashboard/trends?days=84`
  - 返回每日 `{ sessions, tasks, decisions, workflows, errors }` 计数
  - 前端按 `sessions + tasks` 总和映射 activity level（0=0, 1-3=1, 4-8=2, 9-15=3, 16+=4）
  - 无需新建后端表
- **数据表**：`session_metrics`（已有）

### 2.3 费用分析

- **标题**：Cost（带 DollarSign 图标）
- **周期切换**：D / W / M 三个标签（当前选中 D，使用 --surface-elevated 背景）
- **图表**：柱状图，14 天数据
- **颜色**：`--accent`（indigo），透明度根据高度变化
- **底部**：三个金额汇总
  - `¥24.50 today`（大号突出）
  - `¥168.30 week`
  - `¥682.10 month`
- **后端 API**：`GET /api/dashboard/cost-history?days=14`
  - 返回 `{ history: [{date, cost, calls, tokens}], dailyCost, budgetStatus, limits }`
- **数据表**：`cost_history`（已有，CostTracker 已接入）

### 2.4 项目管理看板

- **标题**：Projects（带 FolderOpen 图标）
- **操作**：`+ New` 按钮（带 Plus 图标）、Filter 按钮（带 Filter 图标）
- **后端 API**：新增 `GET /api/tasks/kanban?projectId=<id>`
  - 基于 `agent_task_queue` 表
  - 返回分组数据：`{ todo: [], in_progress: [], in_review: [], done: [] }`
- **数据表**：`agent_task_queue`（已有，扩展 task types 覆盖看板场景）
- **四栏**：

| 列          | 圆点颜色             | 说明                                                    |
| ----------- | -------------------- | ------------------------------------------------------- |
| Todo        | `--content-tertiary` | 灰色                                                    |
| In Progress | `--accent`           | 蓝色（indigo），卡片带左侧 accent 色条，显示 Agent 标签 |
| In Review   | `--intent-warning`   | 琥珀色，卡片带左侧 warning 色条                         |
| Done        | `--intent-success`   | 绿色，卡片文字颜色使用 `--content-tertiary` 淡化        |

- **卡片样式**：圆角 6px，1px border（`--surface-muted`），10px padding
- **拖拽**：后续实现（@dnd-kit 或 react-beautiful-dnd）

---

## 三、设计约束

### 3.1 主题一致性

- 全部颜色使用项目 CSS 变量（`--surface-primary`、`--accent`、`--content-secondary` 等）
- 不引入新的颜色变量
- 卡片/按钮样式与现有 `Card`/`Button` 组件一致

### 3.2 图标

- 全部使用 `lucide-react` 图标
- 不使用 emoji 作为装饰元素
- 图标风格统一为 14-16px stroke 图标

### 3.3 Orb 行为

- 在 Dashboard 页面时，Orb 作为欢迎区头像展示（静态 SVG 图形）
- 导航到其他页面后，Orb 以当前 SecretaryOrb 组件形式出现在右下角
- 切换回 Dashboard 时，Orb 回到头像位置

### 3.4 响应式

- 看板在窄屏时改为垂直堆叠（单列）
- 热力图 + 费用在窄屏时上下排列

---

## 四、后端 API

### 4.1 热力图 — 复用已有 API

```
GET /api/dashboard/trends?days=84
```

返回每日计数，前端映射到 5 级颜色：

```typescript
// 前端映射逻辑
function toActivityLevel(sessions: number, tasks: number): 0 | 1 | 2 | 3 | 4 {
  const total = sessions + tasks;
  if (total === 0) return 0;
  if (total <= 3) return 1;
  if (total <= 8) return 2;
  if (total <= 15) return 3;
  return 4;
}
```

### 4.2 费用分析 — 复用已有 API

```
GET /api/dashboard/cost-history?days=14
```

### 4.3 看板 — 新建 API

新建 `apps/server/src/routes/tasks.ts` 路由文件：

```
GET /api/tasks/kanban?projectId=<id>&status=<status>
```

基于 `agent_task_queue` 表扩展。该表已有字段：

| 字段       | 类型    | 说明                                                |
| ---------- | ------- | --------------------------------------------------- |
| id         | TEXT PK | 任务 ID                                             |
| project_id | TEXT    | 所属项目                                            |
| agent_id   | TEXT    | 分配的 Agent                                        |
| task_type  | TEXT    | 任务类型（扩展为 kanban_task）                      |
| status     | TEXT    | queued / running / completed / failed（映射到四栏） |
| title      | TEXT    | 任务标题（新增）                                    |
| priority   | TEXT    | P0/P1/P2（新增）                                    |
| created_at | TEXT    | 创建时间                                            |

新建 `TaskRepository`（或扩展 `AgentTaskQueueRepository`）提供 kanban 查询。
在 `apps/server/src/index.ts` 注册路由。

---

## 五、实现计划

### Phase 1: 后端 API

1. 扩展 `agent_task_queue` 表：新增 `title`、`priority` 字段（migration）
2. 新建 `apps/server/src/routes/tasks.ts`：`GET /api/tasks/kanban` 路由
3. 在 `apps/server/src/index.ts` 注册路由
4. 扩展 `AgentTaskQueueRepository` 支持 kanban 分组查询

### Phase 2: 前端组件

5. 创建 `WelcomeHeader` 组件 — 欢迎区
6. 创建 `ActivityHeatmap` 组件 — 热力图（基于 trends API 映射）
7. 复用 `CostChart` 组件 — 费用分析（已有）
8. 创建 `KanbanBoard` + `KanbanColumn` + `KanbanCard` 组件

### Phase 3: 页面组装

9. 重写 `OfficePage.tsx` — 组装三个区域，连接 API
10. 实现 Orb 头像 ↔ 悬浮球切换逻辑
11. 实现 D/W/M 周期切换

---

## 六、文件变更清单

| 操作 | 文件                                                        | 说明                              |
| ---- | ----------------------------------------------------------- | --------------------------------- |
| 新建 | `apps/server/src/routes/tasks.ts`                           | 看板 API 路由                     |
| 修改 | `apps/server/src/index.ts`                                  | 注册 tasks 路由                   |
| 修改 | `packages/storage/src/migrations/`                          | 扩展 agent_task_queue 表          |
| 新建 | `apps/desktop/src/components/dashboard/WelcomeHeader.tsx`   | 欢迎区组件                        |
| 新建 | `apps/desktop/src/components/dashboard/ActivityHeatmap.tsx` | 热力图组件                        |
| 新建 | `apps/desktop/src/components/dashboard/KanbanBoard.tsx`     | 看板组件                          |
| 新建 | `apps/desktop/src/components/dashboard/KanbanColumn.tsx`    | 看板列                            |
| 新建 | `apps/desktop/src/components/dashboard/KanbanCard.tsx`      | 看板卡片                          |
| 重写 | `apps/desktop/src/pages/OfficePage.tsx`                     | 页面组装                          |
| 复用 | `apps/desktop/src/components/office/CostChart.tsx`          | 费用分析（已有）                  |
| 复用 | `apps/server/src/routes/dashboard.ts`                       | trends + cost-history API（已有） |
