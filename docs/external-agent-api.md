# Cabinet 外部 Agent API 参考

> 供外部 Agent 调用的 REST API 端点。

## 认证

外部 Agent 通过 `Authorization: Bearer <token>` 头认证。Token 由 Cabinet 在任务分派时生成：

- **task_token**：HMAC 签名，绑定 `task_id` + 有效期，一次性使用
- **agent_api_key**：Agent 注册时分配的永久密钥

未认证请求返回 `401 Unauthorized`。Token 不属于当前 task 返回 `403 Forbidden`。

---

## Slot API

### `POST /api/slot/:taskId/write`

回写中间发现或输出到 Context Slot。

**请求**：
```json
{
  "discoveries": [
    { "type": "dependency", "summary": "Login.tsx depends on AuthContext", "file": "Login.tsx" }
  ],
  "previous_outputs": ["Generated Login.tsx successfully"]
}
```

**响应**：`200 { "ok": true, "taskId": "..." }`

---

## Decision API

### `POST /api/external/decisions`

推送审批请求到 Captain。

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

审批结果通过 WebSocket（`decision_result` 事件）或 HTTP callback 通知 Agent。

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

**响应**：`200 { "deliverable_id": "d_...", "ok": true }`

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
  "timing": {
    "ttft_ms": 320,
    "total_ms": 12000,
    "tool_latency_ms": [200, 450, 180]
  },
  "steps": 4,
  "status": "completed"
}
```

**响应**：`200 { "ok": true }`

TelemetryStore 持久化后，CostTracker 自动同步 token 消耗。

---

## WebSocket 事件

A2A Agent 连接 Cabinet WebSocket（`ws://localhost:3000/ws`）后发送：

```json
{ "type": "agent_connect", "agent_id": "claude-code-v1" }
```

### Agent → Cabinet

```json
{ "type": "task_status", "task_id": "...", "status": "in_progress", "progress": 0.6 }
{ "type": "telemetry", "task_id": "...", "agent_id": "...", "tokens": {...}, "timing": {...} }
```

### Cabinet → Agent

```json
{ "type": "decision_result", "decision_id": "dec_...", "task_id": "...", "status": "approved" }
{ "type": "task_cancel", "task_id": "..." }
```
