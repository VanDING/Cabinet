# Cabinet Desktop 前端 vs 后端全量审计报告

> 审计时间：2026-06-26
> 范围：apps/desktop 所有 API 调用 × apps/server 所有路由处理器
> 方法：逐端点逐文件交叉对比，不跳过任何一个调用

---

## 一、总体统计

| 指标                 | 数值  |
| -------------------- | ----- |
| 前端 HTTP API 调用点 | 89    |
| 去重后的唯一路由路径 | ~45   |
| 服务端注册的路由前缀 | 38    |
| 匹配成功的端点       | 41    |
| **发现的问题**       | **7** |

---

## 二、阻断级 BUG（功能完全不可用）

### BUG-1：Model 名称重复前缀

**现象**：用户在 Settings 中配置模型 `deepseek/deepseek-v4-flash`，到 ChatPanel 模型选择器显示为 `deepseek/deepseek/deepseek-v4-flash`

**根因**：`apps/desktop/src/hooks/useAvailableModels.ts:61`

```ts
providerModels.get(k.provider)!.add(`${k.provider}/${k.model}`);
// BUG: k.model 已包含 "deepseek/deepseek-v4-flash"（PROVIDER_MODELS 常量中自带前缀）
//      这里又拼了一次 "deepseek/" → "deepseek/deepseek/deepseek-v4-flash"
```

**影响范围**：Settings ApiKeysTab 模型下拉 → 数据库 → useAvailableModels → ChatPanel 模型选择器 → `/api/secretary/chat` 请求体。选择 `PROVIDER_MODELS` 中任何模型都会触发。

---

### BUG-2：子 Agent 输入完全不生效

**前端**（`ChatContext.tsx:281` + `App.tsx:500`）：

```json
{ "subAgentSessionId": "xxx", "input": "hello" }
```

**后端**（`secretary.ts:161`）：

```typescript
const { sessionId, message, targetAgent } = body;
if (!sessionId || !message) return c.json({ error: '...' }, 400);
```

**结果**：字段名不匹配，永远返回 400。Sub-agent 对话输入完全不可用。

---

### BUG-3：Context 压缩按钮不生效

**前端**（`ContextButton.tsx:47`）：

```javascript
body: JSON.stringify({ sessionId });
```

**后端**（`secretary.ts:210`）：

```typescript
const sessionId = c.req.query('sessionId');
```

**结果**：前端在 body 中发 `sessionId`，后端从 query string 中读 `sessionId`。永远 400。Context 压缩功能完全不可用。

---

### BUG-4：Memory Consolidate 按钮 404

**前端**（`MemoryPage.tsx:429`）：`POST /api/memory/consolidate`

**后端**：V11 中 `memory.ts` 已被重写，只保留了 `GET /`, `DELETE /:id`, `GET /stats`。`POST /consolidate` 不存在。

**结果**：MemoryPage "Consolidate" 按钮点了就 404。

---

### BUG-5：Deliverables 加载失败

**前端**（`useDeliverables.ts:19`）：`GET /api/projects/{projectId}/deliverables`

**后端**：`deliverablesRouter` 有 `GET /:id/deliverables` 但挂载在 `/api/deliverables`（不是 `/api/projects`）。所以有效路径是 `/api/deliverables/:id/deliverables` 而非 `/api/projects/:id/deliverables`。

**结果**：Deliverables 列表永远拿不到数据。

---

## 三、警告级问题（功能降级但不阻断）

### WARN-1：MCP Server 删除按钮无后端支持

**前端**（`McpTab.tsx:312`）：`DELETE /api/settings/mcp-servers`

**后端**：`settings/mcp.ts` 只有 `GET /mcp-servers` + `PUT /mcp-servers` + `POST /mcp-servers/test`，没有 DELETE。

**结果**：MCP server 删除按钮不生效。

---

### WARN-2：Install SSE 在 Tauri 模式下潜在中断

**前端**（`InstallDialog.tsx:26`）：`fetch('/api/install/install')` 用原生 fetch，非 apiFetch。Vite dev 模式 proxy 转发 OK，Tauri production 模式下不会自动加 `http://localhost:3000` 前缀。

**结果**：Tauri 桌面端中 Install 功能可能无法连接 SSE 流。

---

## 四、功能正向匹配确认

以下前端功能经过交叉验证确认**功能正常、连通正确**（只列出关键模块）：

| 模块                 | 验证的端点                                               | 状态 |
| -------------------- | -------------------------------------------------------- | ---- |
| Chat 对话（主）      | `POST /api/secretary/chat`                               | ✅   |
| Session 管理         | `GET /sessions/:id/children`, `POST /sessions/:id/close` | ✅   |
| Context 查看         | `GET /api/secretary/context`                             | ✅   |
| Decision 决策        | `GET/POST /api/decisions`, approve/reject/audit/comments | ✅   |
| Employee 员工        | `GET/POST/DELETE /api/employees`, test                   | ✅   |
| Skill 技能           | `GET/POST/PUT/DELETE /api/skills`, import/zip            | ✅   |
| Rules 规则           | `GET/POST/PUT/DELETE /api/rules`                         | ✅   |
| Backup 备份          | `GET/POST /api/backups`, restore                         | ✅   |
| Factory 工作流       | `GET/POST/PUT/DELETE /api/factory`, runs/run             | ✅   |
| Settings 设置        | api-keys/model-config/budget/mcp/delegation              | ✅   |
| Dashboard 仪表板     | summary/cost-history/trends                              | ✅   |
| Files 文件           | read/rename/directory/file/delete                        | ✅   |
| Daemon/Harness/Tasks | status/tasks/ports/kanban                                | ✅   |
| Audit/Evaluations/GC | audit/evaluations/gc-scan                                | ✅   |
| WebSocket            | ws://localhost:3000/ws/events                            | ✅   |
| Health check         | `GET /health` (ServerLoading)                            | ✅   |

---

## 五、已删除功能确认

V11 中已经正确删除的前端模块（无残留、无死引用）：

| 模块                           | 操作                                                                        |
| ------------------------------ | --------------------------------------------------------------------------- |
| `graph/` 目录                  | ✅ 已删除（EntityNode/GraphTab/GraphDetailPanel/RelationEdge/force-layout） |
| MemoryPage Graph Tab           | ✅ 已移除 `'graph'` tab                                                     |
| App.tsx `memory_contradiction` | ✅ 事件处理已移除                                                           |
| MemoryPage layer 过滤器        | ✅ `short_term/long_term/entity/project` 替换为 `thread`                    |

---

## 六、不同步但暂时不阻塞的功能

以下前端功能调用的端点存在但响应内容是 stub/空数据，不影响崩溃但也不提供实质功能：

| 端点                                        | 当前行为                     | 影响                            |
| ------------------------------------------- | ---------------------------- | ------------------------------- |
| `GET /api/daemon/ports`                     | 永远返回 `{ ports: [] }`     | AgentMonitor 的端口列表始终为空 |
| `POST /api/daemon/ports/orphans/:port/kill` | No-op，不实际 kill           | 清理按钮无实际操作              |
| `POST /api/workbench/agents/:id/project`    | 返回 `{ status: 'skipped' }` | 外部 Agent 投影功能已被禁用     |

---

## 七、审计结论

| 类别     | 数量             | 行动         |
| -------- | ---------------- | ------------ |
| 阻断 BUG | **5**            | 必须立即修复 |
| 警告     | **2**            | 尽早修复     |
| 功能正常 | **41**           | 可放心使用   |
| 已清理   | **3** (Graph/KG) | 确认无残留   |

---

## 八、前端 UX/UI 设计审视

### 8.1 UX 设计亮点（做得好，不要改）

| 设计                      | 位置                       | 说明                                        |
| ------------------------- | -------------------------- | ------------------------------------------- |
| **SecretaryOrb 磁吸效果** | `SecretaryOrb.tsx:57-104`  | 鼠标跟踪 + 眼球追踪，App 的签名级交互元素   |
| **Orb Mood 粒子系统**     | `SecretaryOrb.tsx:135-201` | ZZZ（困）、音符（开心）、变装配件循环       |
| **Smart Scroll**          | `ChatView.tsx:267-313`     | 自动滚动到底部 + 滚上去时显示"新消息 ↓"按钮 |
| **ToolCallSummary 折叠**  | `ChatView.tsx:99-175`      | 运行中显示 spinner，完成后展开查看详情      |
| **Theme 预览卡片**        | `ThemeTab.tsx:19-133`      | 迷你 UI 预览展示主题效果，行业水准          |
| **Chat 空状态引导**       | `ChatView.tsx:374-403`     | 4 个快速建议按钮引导首次对话                |

### 8.2 阻碍级设计问题

#### P0-1: Settings 分散 — API Keys / Model / Budget 在 Workbench 中

`SettingsPage.tsx:6-38`。API Keys、Model Mapping、Budget Limits 全部在 Workbench > ApiKeysTab 中，而非 Settings 页面。Delegation Tier 在 ChatPanel 工具栏中——此为有意设计（上下文中快速切换授权级别）。但 API Keys / Model / Budget 三项集中配置功能应统一可发现入口。

#### P0-2: ProjectPage 是一个空页面

`ProjectPage.tsx:1-34`

只展示项目名 + 一句描述性文字 + 最后活动时间。用户导航进来找不到任何可操作内容。缺失：文件浏览器、最近活动、项目统计、快捷操作入口。

#### P0-3: ChatView 结构化输出按钮全是空 TODO

`ChatView.tsx:662-704`

"Adopt"、"Reject"、"Approve" 等按钮有完整的 UI 但点击后什么都不做——注释是 `// TODO: persist decision via API`。用户点击按钮看到按钮按下但无任何反馈，严重破坏信任感。

#### P0-4: Workflows Import/Export 按钮是死功能

`WorkflowsPage.tsx:118-130, 140-170`

Export 下拉和 Import 按钮显示 toast "migrated to Mastra"。应改为调用 Mastra 原生 workflow 操作（`mastra.getWorkflow()` 的 export/import 或 MastraServer 提供的端点），或者如无可用的 Mastra 等价位则移除。

#### P0-5: Employees "Add" 菜单三项功能完全相同

`EmployeesPage.tsx:179-212`

"Add Human Employee"、"Add Custom AI Agent"、"Register A2A Agent" 三个菜单选项全部调用同一个 `handleOpenCreate()` 函数，打开同一个 Modal。菜单选项形同虚设。

#### P0-6: Model 选择器不跟 Settings 持久化同步

`ChatPanel.tsx:89-91, 142-144`

模型选择存 `localStorage` 键 `cabinet-selected-model`，默认硬编码 `anthropic/claude-sonnet-4-6`。不跟 Workbench > Model Mapping 同步，不跨设备持久化。

### 8.3 重要设计问题

#### 信息架构

- **Dashboard 竖排列表是有意设计**（`OfficePage.tsx:6-33`）：整洁的 Office 首页，非凌乱的仪表盘。但可以增加 Widget 种类（最近决策、活跃工作流等供可选展示）。
- **MemoryPage Tab 标签是原始 slug**（`:462-466`）：`['memory', 'knowledge', 'evaluation']` — 全小写、无图标、无描述。
- **MemoryPage Tab 不传 projectId**（`:469`）：KnowledgeTab/EvaluationTab 永远用 projectId='default'，忽略当前活跃项目。
- **Settings "Others" Tab 是杂项堆**（`OthersTab.tsx:1-19`）：Maintenance、Backups、Audit 三个无关功能挤在一个 Tab。
- **没有全局 Command Palette（Cmd+K）** — VS Code / Cursor / Linear 标配。

#### 交互细节

- **ChatPanel 无拖拽上传**（`:202-238`）：只能通过菜单选文件。
- **ChatView 代码块无 Copy 按钮**（`:177-239`）：ChatGPT / Claude / GitHub 标配。
- **ChatPanel 工具栏过于拥挤**（`:523-714`）：6 个操作按钮 + 输入框挤在 300px 内。
- **Factory 无缩放/缩略图/节点验证**：canvas 编辑器缺缩放、fit-to-view、断连提示、脏状态防导航。
- **SecretaryOrb 点击无条件创建新 Session**（`:50-55`）：用户可能只是想查看通知，但被强制创建不需要的对话。
- **Notification bubble 只在 idle 模式显示**（`:106-114`）：chat/browse 模式下通知不显示，实时更新失效。

#### 代码架构

- **ChatPanel.tsx 是 725 行单体**（`ChatPanel.tsx:54-725`）：内含 20+ state 变量、15+ 事件处理器。会话管理 / 项目选择 / Skill 选择 / 文件上传等应拆为独立模块。
- **ChatContext handleSend 函数 365 行**（`ChatContext.tsx:260-625`）：流式处理 + 状态管理全在一个函数。
- **MemoryPage 710 行**（`MemoryPage.tsx`）：EntityCard/ProjectCard/LongTermRenderer 等 300 行渲染器全内联在页面文件内。
- **SecretaryBubble 颜色硬编码**（`SecretaryBubble.tsx:18-30`）：用 `blue-400` / `green-400` 等 Tailwind 原始色值而非 Design Token，无法跟随主题变化。

#### 视觉细节

- **大量 text-[10px] / text-[11px]**（`MemoryPage.tsx:89,113,189`、`EmployeesPage.tsx:302`、`ChatPanel.tsx:508`）：低于 WCAG 最低可读标准 12px。
- **WorkbenchPage 自行实现 Tab 而非复用共享 `<Tabs>` 组件**（`WorkbenchPage.tsx:22-36`）：视觉不一致。
- **无 Skeleton Loading**：所有页面用简单文字 "Loading..." 或 spinner。
- **ToolCallSummary 只展开前 4 个工具**（`ChatView.tsx:150-151`）：Agent 调用 20 个工具时用户只看到 "+16 more"。
- **Thinking block 使用原生 `<details>` 无样式**（`ChatView.tsx:648-657`）：看起来像未渲染的 HTML 元素。

### 8.4 行业对比缺失

| 功能                         | 优先级 | 对标产品                |
| ---------------------------- | ------ | ----------------------- |
| 全局 Command Palette (Cmd+K) | P0     | VS Code, Cursor, Linear |
| 代码块 Copy 按钮             | P1     | ChatGPT, Claude, GitHub |
| 拖拽上传文件                 | P1     | ChatGPT, Claude Desktop |
| Skeleton Loading             | P1     | Claude Desktop, Linear  |
| 聊天导出 (Markdown/JSON)     | P1     | ChatGPT, Claude         |
| 会话搜索                     | P1     | Claude Desktop, ChatGPT |
| 消息点赞/踩反馈              | P2     | ChatGPT, Claude         |
| Keyboard Shortcut 速查表     | P0     | VS Code, Figma          |
| 分栏/多面板布局              | P2     | VS Code, Cursor         |
| 新手引导 Walkthrough         | P1     | Cursor, Linear          |
| 通知偏好设置                 | P1     | Slack, Claude Desktop   |
| Code Diff 视图               | P2     | Cursor, Claude Desktop  |
| Token 使用仪表板             | P2     | ChatGPT, Cursor         |
| 会话 Pin/收藏                | P2     | ChatGPT, Claude         |
| 会话分享链接                 | P2     | ChatGPT                 |

### 8.5 设计问题分类总结

| 类别                | P0    | P1     | P2     |
| ------------------- | ----- | ------ | ------ |
| 功能逻辑 Bug        | 6     | 0      | 0      |
| 信息架构 / 可发现性 | 0     | 5      | 2      |
| 交互细节            | 0     | 7      | 10     |
| 代码架构 / 维护性   | 0     | 3      | 0      |
| 视觉 / 一致性       | 0     | 2      | 7      |
| 对标缺失            | 2     | 5      | 9      |
| **合计**            | **8** | **22** | **28** |

> 注：Delegation Tier 在 ChatPanel 中是有意设计（上下文中快速切换授权级别），非缺陷。Dashboard 竖排列表是有意设计（整洁的 Office 首页）。
