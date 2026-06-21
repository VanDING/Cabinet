# Cabinet 外部 Agent API 参考

> 供外部 Agent 调用的 REST API 端点。

## 认证

外部 Agent 通过 `Authorization: Bearer <token>` 头认证。Token 由 Cabinet 在任务分派时生成：

- **task_token**：HMAC 签名，绑定 `task_id` + 有效期，一次性使用
- **agent_api_key**：Agent 注册时分配的永久密钥

未认证请求返回 `401 Unauthorized`。Token 不属于当前 task 返回 `403 Forbidden`。

---

## Slot API（Task 数据总线）

每个 Task 包含一个 Context Slot——用于传输项目上下文和回写中间发现。

### `GET /api/slot/:taskId/read`

读取当前 Context Slot。

**响应**：`200` 返回完整的 `ContextSlot` JSON（包含 project、memories、preferences、files、discoveries、previous_outputs、security 字段）

### `POST /api/slot/:taskId/write`

回写中间发现到 Context Slot。

**请求**：

```json
{
  "discoveries": [
    { "type": "dependency", "summary": "Login.tsx depends on AuthContext", "file": "Login.tsx" }
  ],
  "previous_outputs": ["Generated Login.tsx successfully"]
}
```

---

## A2A Task API

符合 A2A Agent Discovery 标准的端点。

### `GET /.well-known/agent-card.json`

返回 Agent 能力卡片（skills + capabilities 列表）。

### `POST /api/agents/message`

A2A 入站任务路由。Cabinet 接收外部 Agent 的 task 请求并分派给 Secretary 处理。

### `POST /api/agents/message/stream`

SSE 流式 A2A 任务执行。

### `GET /api/agents/tasks/:taskId`

查询 A2A 任务状态。

---

## Agent 管理 API

### `POST /api/agents/scan`

扫描系统 PATH 上的预定义 CLI Agent 列表（claude-code、codex、opencode、aider、gemini-cli、kimi 等）。

**响应**：`200 { results: [{ agentId, name, protocol, command, detected, version, error? }] }`

### `POST /api/agents/discover`

对指定 URL 执行 A2A Agent Discovery（读取 `/.well-known/agent.json`）。

### `POST /api/agents/import`

从 `.md`（SKILL.md frontmatter）或 `.json`（A2A card 格式）导入 Agent。

### `DELETE /api/agents/:type`

注销自定义 Agent。

---

## Task Queue API（Daemon）

外部 Agent 通过 Daemon 的 pull-mode 任务队列工作。

### `GET /api/tasks`

列出 Task Queue 中的任务（支持 status、agentId、limit 过滤）。

### `POST /api/tasks`

创建新的 Task Queue 任务（异步，返回 taskId）。

---

## Install API

### `GET /api/install`

获取可安装的 Agent 列表（含各平台安装方法）。

### `POST /api/install`

启动 Agent 安装。**请求**：`{ agentId, method }`。安装方法由 `GET /api/install` 返回。

**响应**：`200 { taskId }` — 安装异步执行。

### `POST /api/install/cancel`

取消进行中的安装。**请求**：`{ taskId }`

### `GET /api/install/:taskId`

查询安装任务状态。

---

## Decision API

### `POST /api/external/decisions`

外部 Agent 推送审批请求到 Captain。

**请求**：

```json
{
  "type": "execution",
  "title": "Delete temporary build files",
  "description": "Need to run: rm -rf ./build/temp/*",
  "urgency": "red",
  "source": { "agent_id": "claude-code-v1", "task_id": "task-456" },
  "options": [
    { "label": "Approve deletion", "value": "approve" },
    { "label": "Deny", "value": "reject" }
  ]
}
```

**响应**：`200 { "decision_id": "dec_...", "status": "pending", "callback_url": "..." }`

---

## Deliverable API

### `POST /api/external/deliverables`

提交任务交付物。

**请求**：

```json
{
  "agent_id": "claude-code-v1",
  "task_id": "task-456",
  "title": "Login page implementation",
  "type": "code",
  "content": "// Generated React component...",
  "metadata": {
    "language": "TypeScript",
    "files": ["src/pages/Login.tsx", "src/pages/Login.test.tsx"],
    "tokens_used": 3200,
    "duration_ms": 12000
  }
}
```

---

## Telemetry API

### `POST /api/telemetry/report`

上报运行时遥测数据。

**请求**：

```json
{
  "task_id": "task-456",
  "agent_id": "claude-code-v1",
  "model": "claude-sonnet-4-6",
  "tokens": { "prompt": 1500, "completion": 800 },
  "timing": { "ttft_ms": 320, "total_ms": 12000, "tool_latency_ms": [200, 450, 180] },
  "steps": 4,
  "status": "completed"
}
```

### `GET /api/telemetry/stats`

查询 Agent 遥测统计。

### `GET /api/telemetry/trends`

查询 Agent 遥测趋势数据。

## WebSocket 事件

连接 Cabinet WebSocket（`ws://localhost:3000/ws`）后发送：

**Agent → Cabinet**:

```json
{ "type": "agent_connect", "agent_id": "claude-code-v1" }
{ "type": "task_status", "task_id": "...", "status": "in_progress", "progress": 0.6 }
```

**Cabinet → Agent**:

```json
{ "type": "decision_result", "decision_id": "dec_...", "task_id": "...", "status": "approved" }
{ "type": "task_cancel", "task_id": "..." }
```
