# Cabinet 外部 Agent 开发者指南

> 如何创建一个兼容 Cabinet 的外部 Agent——ACP 方式、CLI 方式、或使用 Agent SDK。

## 概述

Cabinet 是一个 Agent 操作系统。外部 Agent 通过标准协议接入，成为平台上的"一等公民"——可以被 Secretary 路由、被 Workflow 编排、被 Dashboard 监控。

## 接入方式选择

| 方式              | 适用场景             | 要求                                    |
| :---------------- | :------------------- | :-------------------------------------- |
| **ACP（推荐）**   | Agent 作为子进程运行 | 实现 JSON-RPC 2.0 over stdin/stdout     |
| **Headless CLI**  | Agent 是命令行工具   | 支持 stdin/stdout，输出作为 deliverable |
| **Terminal-only** | 终端交互式 agent     | 直接终端透传，无结构化输出              |

## ACP 方式

ACP（Agent Communication Protocol）是基于 JSON-RPC 2.0 的双向通信协议，支持流式交互、会话管理、任务取消。

### 1. 实现 ACP 端点

ACP 通过子进程的 stdin/stdout 通信，每行一个 JSON 消息：

**请求** (Cabinet → Agent):

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"0.1.0"}}
{"jsonrpc":"2.0","id":2,"method":"cabinet/newSession","params":{"sessionId":"sess_123","cwd":"/project"}}
{"jsonrpc":"2.0","method":"cabinet/prompt","params":{"sessionId":"sess_123","message":"Hello"}}
```

**响应** (Agent → Cabinet):

```json
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"0.1.0","capabilities":{}}}
{"jsonrpc":"2.0","id":2,"result":{"sessionId":"sess_123"}}
```

**通知** (Agent → Cabinet):

```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": { "sessionId": "sess_123", "type": "content", "text": "Thinking..." }
}
```

### 2. 创建 Scanner Recipe

Cabinet 通过 Recipe 自动发现和安装外部 Agent。创建文件 `packages/agent/src/discovery/scanner-recipe.ts`：

```typescript
{
  recipeId: 'my-agent',
  name: 'My Agent',
  command: 'my-agent',
  dispatchProtocol: 'acp',     // 或 'headless'、'terminal-only'
  projector: 'my-agent',       // Projector ID for config projection
  installMethods: {
    darwin: [{ type: 'brew', name: 'my-agent', args: [] }],
    linux: [{ type: 'npm', name: '@my/agent', global: true, args: [] }],
    win32: [{ type: 'winget', name: 'My.Agent', args: [] }],
  },
  nativeConfigPaths: {
    darwin: ['~/Library/Application Support/my-agent/config.json'],
    linux: ['~/.config/my-agent/config.json'],
  },
  detectCommands: [{ command: 'my-agent', args: ['--version'] }],
}
```

### 3. 配置 Projection

Agent 注册后，Cabinet 通过 `Projector` 将配置投射到 Agent 的原生配置文件：

```typescript
class MyAgentProjector implements Projector {
  async project(agentId: string, config: UnifiedConfig): Promise<void> {
    // 将 API key、MCP servers、skills 写入 agent 原生配置
  }
}
```

参见 `packages/agent/src/projector/` 中的参考实现（claude-code.ts、codex.ts、opencode.ts 等）。

## CLI 方式（Headless）

### 1. Agent 声明

Agent 通过 stdout 输出执行结果。Cabinet 将整个 stdout 视为 deliverable（不解析结构化输出）。

检测命令：`my-agent --version`（exit code 0 即认为已安装）。

## Context Slot

每个 Task 包含一个 Context Slot——共享数据总线：

```typescript
interface ContextSlot {
  project: { name, tech_stack, goals };
  memories: string[];         // 相关历史记忆
  preferences: { ... };       // Captain 的风格偏好
  files: string[];            // 最近操作的文件
  discoveries: Array<{ type, summary }>;  // Agent 可写入
  previous_outputs: string[];  // 前序 Agent 输出
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
