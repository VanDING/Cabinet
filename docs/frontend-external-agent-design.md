# Cabinet 前端外部 Agent 设计方案 v1.0

> 配套方案：[external-agent-integration-v3.md](external-agent-integration-v3.md)

---

## 一，总体决策

**外部 Agent 不单独建概念。** 它们就是 Employee——`kind: 'ai'`, `source: 'external_cli' | 'external_a2a'`。前端不区分"Agent 管理"和"Employee 管理"，共用一个页面、一个编辑弹窗。

### Employee 模型扩展

```typescript
interface EmployeeItem {
  // 现有字段
  id, name, role, kind: 'ai' | 'human', model?, expertise[],
  permissionLevel, status, projectId, allowedTools?, systemPrompt?,
  temperature?, maxTokens?

  // 新增
  source: 'builtin' | 'custom' | 'external_cli' | 'external_a2a'
  external?: ExternalAgentConfig
}
```

### 结构变更总览

```
保留（扩展）:
  EmployeesPage.tsx       — 集成外部 Agent 列表 + 扫描
  EmployeeEditModal.tsx   — 新增 External Tab
  ChatPanel.tsx           — @agent 下拉包含外部 Agent
  SettingsPage.tsx        — API Keys 简化 + External Agents Tab
  FactoryPage             — Agent 节点 role 下拉扩展

新增:
  ExternalAgentConfigForm.tsx — 外部 Agent 配置表单（复用组件）
  TelemetryWidget.tsx         — 遥测大组件

废弃:
  AgentManagerPage.tsx    — 融入 EmployeesPage
  RuntimeDashboard.tsx    — 融入 OfficePage Widgets
  'agent' WorkflowNodeType — 回退，复用 agentGroup
```

---

## 二，EmployeesPage — 统一管理

### 列表

```
┌─ Employees ───────────────────────────────────── [+ Add ▼] ─┐
│ ┌─ Secretary ───── ● active ── [builtin] ──────────────────┐ │
│ └─ Claude Code ──── ● online ── [external_cli] ───────────┘ │
│ └─ Cursor AI ────── ● online ── [external_a2a] ───────────┘ │
│ └─ 张三 ─────────── ◐ idle ──── [human] ──────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### 添加按钮

```
[+ Add ▼]
  ├── Add Human Employee
  ├── Add Custom AI Agent
  ├── Scan for CLI Agents    ← 调用 POST /api/agents/scan
  └── Register A2A Agent     ← 手动填写 baseUrl
```

### 自动扫描

- 后端 `POST /api/agents/scan` 执行预定义 CLI 检测列表
- 返回已安装但未注册的 Agent，用户一键注册

---

## 三，EmployeeEditModal — External Tab

当 `source === 'external_*'` 时显示。CLI / A2A 两种模式表单切换。

包含：protocol 选择、configSource 选择、command/args/env（CLI）或 baseUrl/auth（A2A）、detectCommand/installCommand、超时/重试、Detect CLI / Install CLI 按钮。

`ExternalAgentConfigForm` 抽取为独立组件，EmployeeEditModal 和 SettingsPage 共用。

---

## 四，ChatPanel — @agent 切换

已有 `@secretary` 下拉框。改动：
1. 数据源从硬编码 → `/api/employees?kind=ai`
2. 移除 meeting_chair
3. 外部 Agent 标注协议类型 + 在线状态

**不需要独立终端。** 切换到 @claude-code 后底层自动路由，对话体验一致。

---

## 五，SettingsPage

### API Keys Tab
去掉 tier 选择器。Provider + Key + Model 三字段。保留多 provider。

### External Agents Tab
列出所有 `source: 'external_*'` 的 Employee。点击编辑弹出 ExternalAgentConfigForm。和 EmployeeEditModal 共用表单组件。

---

## 六，FactoryPage — Agent 节点

### 回退
从 `WorkflowNodeType` 移除多余的 `'agent'`。`node-types.ts` 移除对应映射。

### role 下拉扩展
数据源从硬编码 → 所有 `kind: 'ai'` 的 Employee。外部 Agent 标注协议类型。节点视觉上显示 CLI/A2A 标签。

---

## 七，OfficePage Widgets

### WIDGET_POOL 新增

```typescript
{ type: 'telemetry-dashboard', label: 'Telemetry',     w: 12, h: 8 },
{ type: 'activity-feed',       label: 'Activity Feed', w: 8,  h: 6 },
```

### TelemetryWidget

复合组件，内部 CSS grid：4 个统计卡片 + Token Trend（面积图）+ TTFT Latency（折线图）+ Agent Latency（横向柱状图）。

图表库：**Recharts**。数据源：`GET /api/telemetry/trends`。顶部 Agent 选择器 + 时间范围选择器联动所有子图表。

### ActivityFeedWidget

实时事件流：任务完成 / Slot 发现 / 审批请求 / 遥测摘要。WebSocket 推送。审批按钮内联操作。时间自动分组。

---

## 八，侧边栏

不新增导航项。Telemetry 和 ActivityFeed 通过 OfficePage "Add Widget" 添加。

废弃路由：`/agents`、`/telemetry`。

---

## 九，后端新增端点

```
POST /api/agents/scan        — 扫描已安装 CLI Agent
GET  /api/telemetry/trends   — 遥测趋势数据
```

---

## 十，实施顺序

| # | 任务 | 依赖 |
|:---|:---|:---|
| 1 | Employee 模型 + API 扩展 | — |
| 2 | EmployeesPage 集成 + 扫描 | 1 |
| 3 | EmployeeEditModal External Tab + 表单组件 | 1 |
| 4 | ChatPanel @agent 下拉扩展 | 1 |
| 5 | SettingsPage API Keys + External Agents | 1, 3 |
| 6 | FactoryPage role 扩展 + 回退 'agent' | 1 |
| 7 | TelemetryWidget + ActivityFeedWidget | 后端 trends API |
| 8 | 废弃清理 | 2, 7 |
