# Cabinet 外部 Agent 开发者指南

> 如何创建一个兼容 Cabinet 的外部 Agent——A2A 方式、CLI 方式、或使用 Agent SDK。

## 概述

Cabinet 是一个 Agent 操作系统。外部 Agent 通过标准协议接入，成为平台上的"一等公民"——可以被 Secretary 路由、被 Workflow 编排、被 Dashboard 监控。

## 接入方式选择

| 方式 | 适用场景 | 要求 |
|:---|:---|:---|
| **A2A（推荐）** | Agent 作为长期运行的服务 | 实现 HTTP 端点 + 可选 WebSocket |
| **CLI** | Agent 作为命令行工具 | 支持 stdin/stdout 通信 |

## A2A 方式

### 1. 创建 agent.json

```json
{
  "agent_id": "my-agent-v1",
  "display_name": "My Custom Agent",
  "version": "1.0.0",
  "description": "Does something useful.",
  "protocol": "a2a",
  "capabilities": [
    {
      "name": "code-generation",
      "description": "Generate code from requirements.",
      "security_level": "moderate"
    }
  ],
  "connection": {
    "base_url": "http://localhost:3002"
  }
}
```

### 2. 实现端点

```
GET  /.well-known/agent.json  → 返回 agent.json
POST /a2a/tasks               → 接收任务
GET  /a2a/tasks/{id}          → 返回任务状态
POST /a2a/tasks/{id}/cancel   → 取消任务
```

### 3. 集成 Agent SDK

```typescript
import { createAgentCard, parseTask, connectToCabinet, SlotClient } from '@cabinet/agent-sdk';

// Serve agent card
app.get('/.well-known/agent.json', (req, res) => {
  const card = createAgentCard({
    agent_id: 'my-agent-v1',
    display_name: 'My Agent',
    base_url: 'http://localhost:3002',
    capabilities: [/* ... */],
  });
  res.json(card);
});

// Handle incoming tasks
app.post('/a2a/tasks', async (req, res) => {
  const task = parseTask(req.body);
  const slot = new SlotClient({
    baseUrl: 'http://localhost:3000',
    taskToken: req.body.configuration?.task_token,
    taskId: task.task_id,
  });

  // Read context from Slot
  const ctx = await slot.readSlot();

  // Execute your agent logic...
  const result = await myAgent.run(task.input, ctx);

  // Write discoveries back to Slot
  await slot.writeDiscoveries([{ type: 'finding', summary: 'Found something' }]);

  // Report telemetry
  await slot.reportTelemetry('my-agent-v1', {
    model: 'my-model',
    tokens: { prompt: 1000, completion: 500 },
    timing: { ttft_ms: 200, total_ms: 5000, tool_latency_ms: [] },
    steps: 3,
  });

  res.json({ status: 'completed', output: result });
});
```

## CLI 方式

### 1. 创建 agent.json

```json
{
  "agent_id": "my-cli-agent",
  "display_name": "My CLI Agent",
  "version": "1.0.0",
  "protocol": "cli",
  "configSource": "agent_native",
  "capabilities": [
    { "name": "code-review", "description": "Review code quality." }
  ],
  "connection": {
    "command": "my-agent",
    "args": ["--print"],
    "detect_command": "which my-agent",
    "timeout_ms": 120000
  }
}
```

### 2. 遵守分隔符协议

Cabinet 通过 stdin 发送格式化的 prompt（含项目上下文、记忆、偏好）。Agent **必须**在 stdout 中使用以下分隔符标记输出：

```
===CABINET_DISCOVERY===
{"type": "finding", "summary": "Your discovery"}
===END_DISCOVERY===

===CABINET_DELIVERABLE===
<Your final output here>
===END_DELIVERABLE===
```

分隔符是**可选的**——如果 Agent 不使用分隔符，整个 stdout 将被视为交付物。

### 3. 注册

将 `agent.json` 放入 `~/.cabinet/agents/my-cli-agent/agent.json`，重启 Cabinet 即可自动发现。或在 Dashboard Agent 管理页面手动注册。

## 双模式配置源

| 模式 | 说明 |
|:---|:---|
| `cabinet_managed` | Cabinet 统一管理 API key 和模型，映射到 Agent |
| `agent_native` | Agent 使用自己的 CLI 配置和 API key（推荐 CLI Agent 使用） |

## Context Slot

每个任务包含一个 Context Slot——共享数据总线：

```typescript
interface ContextSlot {
  project: { name, tech_stack, goals };
  memories: string[];         // 相关历史记忆
  preferences: { ... };       // Captain 的风格偏好
  files: string[];            // 最近操作的文件
  discoveries: Array<{ type, summary }>;  // Agent 可写入
  previous_outputs: string[];  // 前序 Agent 输出（Workflow 场景）
  security: { level, maxRetries };
}
```

Agent 通过 `POST /api/slot/{task_id}/write` 回写中间发现。

## 遥测上报

```typescript
POST /api/telemetry/report
{
  task_id, agent_id, model,
  tokens: { prompt, completion },
  timing: { ttft_ms, total_ms, tool_latency_ms },
  steps, status
}
```

## 安全

- 所有 Agent 操作经过 LevelClassifier → SafetyChecker → PolicyEngine 检查链
- 外部 Agent 默认受限（`external_agent_sandbox` mission）
- 高风险命令和 L2+ 操作需 Captain 审批
- 高信任度 Agent（`agentTrustLevel ≥ 0.8`）可降一级
