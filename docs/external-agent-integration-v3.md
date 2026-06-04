# Cabinet 外部 Agent 平台化方案 v3.2

> **版本**：3.2
> **关联产品**：Cabinet v2.0
> **设计参考**：WeSight（Agent 桌面工作台）、LiteFlow（组件编排引擎）
> **目标**：让 Cabinet 成为 Agent 的操作系统——在统一平台上注册、调度、编排、对话和管理外部 Agent（Claude Code、Cursor、Codex 等）。

---

## 〇，愿景与范围

### 0.1 Cabinet 的定位

**Cabinet 不做最好的 Agent，而是做最好的 Agent 组织者。**

外部 Agent 不是"接入"到 Cabinet——它们是 Cabinet 平台上的**一等公民**。如同操作系统管理进程，Cabinet 管理 Agent 的注册、调度、通信、安全和生命周期。

### 0.2 五个核心能力

| # | 能力 | 用户能做什么 |
|:---|:---|:---|
| 1 | **Agent 管理 + 任务分派** | 在一个平台上注册、管理多个外部 Agent，向它们下发任务 |
| 2 | **通信 + 信息聚合** | 与外部 Agent 双向通信，聚合决策、交付物和遥测数据到 Cabinet |
| 3 | **Workflow 编排** | 将 Agent（不论内部/外部）作为标准节点，编排复杂自动化流程 |
| 4 | **嵌入式对话** | 在 Cabinet 界面内打开窗口，直接与外部 Agent 对话（类似 VS Code 的 Claude Code 插件体验） |
| 5 | **统一权限/配置** | 将 Cabinet 的权限策略应用于所有 Agent，支持双模式配置源 |

### 0.3 协议策略：各司其职

| 协议 | 定位 | 解决什么问题 | 在 Cabinet 中的角色 |
|:---|:---|:---|:---|
| **A2A**（Agent-to-Agent） | Agent 协作标准 | Agent 之间如何发现、通信、协作 | Cabinet **向**外部 Agent 分派任务 + 接收状态同步（标准路径） |
| **REST API** | 数据推送 | Agent 单向推送数据给平台 | 外部 Agent **向** Cabinet 推送决策、交付物、遥测上报 |
| **MCP**（Model Context Protocol） | 工具调用标准 | LLM 如何调用外部工具 | **仅内部使用**——连接外部工具给 Secretary/Curator 用 |

A2A 已有主流框架支持（LangGraph、CrewAI、Google ADK），与 CLI Adapter **并行开发**。

### 0.4 设计参考

本方案的设计决策受益于两个开源项目的实践验证：

| 项目 | 定位 | 核心启示 |
|:---|:---|:---|
| **WeSight** | Agent 桌面工作台——管理 Claude Code、Codex 等 10 个 CLI Agent | ① 配置驱动薄 Adapter（不需要工厂模式）② 双模式配置源（平台管理 vs Agent 原生）③ CLI 自动检测/安装 ④ 运行时遥测 |
| **LiteFlow** | 组件编排引擎——"所有逻辑皆为组件，能编排 LiteFlow 就能编排 AI Agent" | ① **Slot 双向共享数据总线**② Agent 是标准节点，不特殊化 ③ 极简 EL DSL（THEN/WHEN/IF/FOR）④ 规则热加载 |

**核心启示**：这两个项目分别验证了"Agent 管理"和"Agent 编排"两个维度的最佳实践。Cabinet 的独特定位是**同时做到两者**，外加 Decision 系统和记忆体系。

---

## 一，Cabinet 自身的最小核心

### 1.1 只保留三个系统级 Agent

```
┌─────────────────────────────────────────────────────────┐
│  Cabinet 核心（平台层）                                  │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │Secretary │  │ Curator  │  │ Organize │              │
│  │ 主动聚合  │  │ 记忆洞察  │  │ 编排规划  │              │
│  │ 对话界面  │  │ 知识整理  │  │ 蓝图部署  │              │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘              │
│       │             │             │                     │
│       └─────────────┼─────────────┘                     │
│                     │                                   │
│  ┌──────────────────▼──────────────────────────────┐   │
│  │              平台基础设施                         │   │
│  │  AgentEventBus │ DecisionService │ WorkflowEngine│   │
│  │  SessionManager│ PolicyEngine    │ CostTracker   │   │
│  │  AgentRegistry │ DeliverableRepo │ IntentParser  │   │
│  │  ContextSlot   │ TelemetryStore  │               │   │
│  └──────────────────┬──────────────────────────────┘   │
│                     │                                   │
│                     │ A2A / CLI Adapter                 │
└─────────────────────┼───────────────────────────────────┘
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
   ┌─────────┐  ┌─────────┐  ┌─────────┐
   │ Claude  │  │ Cursor  │  │ Codex   │  ...
   │  Code   │  │         │  │         │
   └─────────┘  └─────────┘  └─────────┘
```

### 1.2 三个 Agent 的职责边界

**Secretary** — 对话界面 + 路由 + 信息聚合中心

Captain 的主要对话对象。职责：
- 意图解析（IntentParser）：这个需求谁来做？
- 路由决策：→ Claude Code / Cursor / Organize / Curator
- **初始化 Context Slot**：在派发任务前，将相关记忆、项目上下文、Captain 偏好写入共享数据槽
- 结果合成：多个 Agent 的输出 → 统一回复
- 决策聚合：Agent 推送的 Decision → 展示给 Captain
- 交付物通知：Agent 完成了什么 → 告知 Captain

**不做的**：代码生成、审查、调试——这些路由给 Agent 节点。

**Curator** — 记忆 + 洞察 + 知识整理

后台运行，不直接面对 Captain。职责：
- 会话关闭时 → 提取知识 → LongTermMemory
- **消费 Context Slot 中 Agent 写回的中间发现** → 长期记忆
- 决策审批后 → 学习偏好 → EntityMemory
- 定时任务 → 跨会话模式提取（4h）、知识图谱维护 + 记忆衰减（1h）
- 会话创建时 → 准备上下文 Brief（30s 延迟）
- 会话压缩 → 超限时生成摘要

**Organize** — 编排 + 蓝图 → Workflow

将组织设计翻译为可执行的 Workflow。职责：
- BlueprintParser：解析蓝图（YAML / EL 表达式）
- BlueprintValidator：验证合法性
- BlueprintDeployer：部署为 Workflow + Agent 注册

### 1.3 移除的组件

| 组件 | 原因 |
|:---|:---|
| **Meeting Agent** | 被 Secretary 多 Agent 路由 + 结果合成吸收 |
| **内部 Specialist Agent** | 执行层全部移交 Agent 节点（不论来源） |
| **ModelRouter** | 只有一个模型，不需要多模型路由 |
| **ToolPruner** | 工具集固定且小，不需要动态修剪 |
| **AutoAdjuster 模型切换** | 没有备选模型可切换，只保留 budget 检查 |

### 1.4 LLM Gateway 简化

保留多 Provider 支持（用户可能用 Anthropic、DeepSeek、Ollama 等），但废弃 tier 分层：

```typescript
// 简化后: 每个 provider 只配 1 个默认轻量模型
const PROVIDER_DEFAULT_MODEL: Record<string, string> = {
  anthropic: 'claude-haiku-4-5',
  openai:    'gpt-4o-mini',
  google:    'gemini-2.5-flash',
  deepseek:  'deepseek-v4-flash',
  // ...
};
// 用户可在 settings.json 覆盖
```

| 维度 | 当前 | 简化后 |
|:---|:---|:---|
| Provider 数量 | 8 | 8（不变） |
| 每 Provider 模型数 | 3（分 tier） | 1（默认轻量） |
| ModelRouter / RateLimitTracker | 需要 | **可废弃** |
| ApiKeyRepo / ApiSwitcher | 需要 | **保留** |
| PROVIDER_PREFERENCE fallback 链 | 需要 | **保留** |


## 二，现有基础设施盘点

### 2.1 可直接复用的组件

| 组件 | 位置 | 角色 |
|:---|:---|:---|
| `AgentRoleRegistry` | `packages/agent/` | **需扩展**：增加 `external_a2a` / `external_cli` 类型 |
| `AgentEventBus` | `packages/events/src/agent-event-bus.ts` | **直接复用**：三通道分发（WebSocket + SQLite + 父 Session 通知） |
| `WorkflowEngine` | `packages/workflow/src/engine.ts` | **直接复用**：所有 Agent 都是统一的 Agent 节点 |
| `SessionManager` | `packages/secretary/src/session-manager.ts` | **直接复用**：子会话树 + **新增 Context Slot 字段** |
| `DecisionService` | `packages/decision/src/decision-service.ts` | **直接复用** |
| `DeliverableRepo` | `packages/storage/` | **直接复用** |
| `IntentParser` | `packages/secretary/` | **需扩展**：路由表感知外部 Agent 能力 |
| `SafetyChecker` | `packages/agent/` | **需扩展**：覆盖外部 Agent 操作 |
| `PolicyEngine` | `packages/decision/src/policy-engine.ts` | **直接复用** |
| `LevelClassifier` | `packages/decision/src/level-classifier.ts` | **直接复用** |
| `BudgetGuard` + `CostTracker` | `packages/gateway/` | **需扩展**：接收外部 Agent 遥测上报 |

### 2.2 不使用的组件

| 组件 | 原因 |
|:---|:---|
| `AgentLoop` | 外部 Agent 有自己的执行循环 |
| `Meeting Agent` | 被 Secretary 路由 + 合成吸收 |

### 2.3 新增组件

| 组件 | 用途 |
|:---|:---|
| `ContextSlot` | 任务级共享数据总线，Agent 可双向读写（借鉴 LiteFlow Slot） |
| `TelemetryStore` | 运行时遥测持久化（借鉴 WeSight Runtime Dashboard） |

### 2.4 关键代码引用

- `AgentEventBus.publish(sessionId, parentSessionId, event)` — [agent-event-bus.ts:42-56](packages/events/src/agent-event-bus.ts#L42-L56)
- `Session` 支持 `parentId`, `agentType`, `events`, `deliverable` — [session-manager.ts:54-68](packages/secretary/src/session-manager.ts#L54-L68)
- `WorkflowEngine.startRun()` — [engine.ts:75-109](packages/workflow/src/engine.ts#L75-L109)
- `DecisionService.create()` → `LevelClassifier.classify()` → `PolicyEngine.checkDecision()` → `EscalationService.escalate()`


## 三，统一 Agent 模型

### 3.1 核心原则

**编排层不关心 Agent 从哪来。** 一个 Agent 节点可以是内置 Secretary，可以是用户自定义角色，也可以是外部 Claude Code。它们共享同一套注册、路由、事件和会话体系。

这个设计直接借鉴 LiteFlow 的理念——"Agent 不再是一个独立的系统，而是编排链路中的一个节点"。

### 3.2 Agent 类型扩展

```typescript
type AgentSource = 'builtin' | 'custom' | 'external_a2a' | 'external_cli';
```

`AgentRole` 接口：

```typescript
interface AgentRole {
  type: AgentSource;
  name: string;
  description: string;
  // ... 现有字段 ...

  // 外部 Agent 配置（仅 external_a2a / external_cli 时有效）
  external?: {
    protocol: 'a2a' | 'cli';
    // 配置源（借鉴 WeSight）
    configSource: 'cabinet_managed' | 'agent_native';
    // A2A 特有
    baseUrl?: string;
    healthCheckUrl?: string;
    authConfig?: { type: 'api_key' | 'oauth'; header?: string; envVar?: string };
    // CLI 特有
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    permissionMode?: 'auto' | 'conservative';
    detectCommand?: string;   // 自动检测 CLI 是否已安装
    installCommand?: string;  // 一键安装命令
    // 通用
    timeoutMs?: number;
    maxRetries?: number;
  };
}
```

### 3.3 注册流程

```
方式 1: A2A 自动发现 → GET /.well-known/agent.json
方式 2: 手动注册 → Dashboard UI
方式 3: 目录扫描 → ~/.cabinet/agents/{name}/agent.json
方式 4: CLI 自动检测 → 执行 detectCommand，发现已安装的 Agent
```

### 3.4 Agent 节点统一化

Workflow 编排层**不区分** Agent 来源。一个 Agent 节点引用任意 Agent（内部或外部）：

```typescript
// 编排层：所有 Agent 都是同一个节点类型
WorkflowNodeType = 'agent' | 'skill' | 'code' | 'human' | 'condition' | 'start' | 'end'

// Agent 节点引用任意 Agent
interface AgentNodeDef {
  type: 'agent';
  agentId: string;  // 'secretary' | 'curator' | 'claude-code-v1' | 'cursor-v1' | ...
  input: unknown;   // 从 Context Slot 读取或直接指定
}
```

能力声明到路由的映射保持不变——外部 Agent 的 capabilities 注册为 Skill 到 SkillRegistry，IntentParser 统一查询。

**关键决策**：`type: 'agent'` 而不是 `type: 'external_agent'`。编排层不需要知道 Agent 从哪来。


## 四，Context Slot：双向共享数据总线

### 4.1 设计来源

借鉴 LiteFlow 的 Slot 机制。LiteFlow 的核心设计：

> "不同的组件之间是不传递参数的，所有的数据交互都是通过数据上下文来实现的。组件不用关心此数据是由谁提供的。"

Cabinet 的 Context Slot 是这个理念的 Agent 版本——**Agent 不直接传递参数，所有数据交互通过共享 Context Slot 完成**。

### 4.2 Slot 模型

```
┌─────────────────────────────────────────────────────┐
│  Context Slot（任务级共享数据总线）                  │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │Secretary │  │ Agent A  │  │   Agent B        │  │
│  │ 写入初始  │  │ 读取+写入 │  │ 读取前序输出     │  │
│  │ 上下文    │  │ 中间发现  │  │ 写入最终交付物   │  │
│  └────┬─────┘  └────┬─────┘  └────────┬─────────┘  │
│       │             │                 │             │
│       ▼             ▼                 ▼             │
│  ┌──────────────────────────────────────────────┐   │
│  │              Context Slot                     │   │
│  │  {                                           │   │
│  │    project:    { name, tech_stack, goals },   │   │
│  │    memories:   [...],        // Secretary 写  │   │
│  │    preferences: {...},       // Secretary 写  │   │
│  │    files:      [...],        // Secretary 写  │   │
│  │    discoveries: [...],       // Agent A 写回  │   │
│  │    previous_outputs: [...],  // 前序 Agent 输出│   │
│  │    deliverable: {...}        // 最终交付物     │   │
│  │  }                                           │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  隔离保证：每个任务（子 Session）独立的 Slot 实例     │
└─────────────────────────────────────────────────────┘
```

### 4.3 与"Secretary 单向打包"的区别

| | v3.0（单向打包） | v3.1（双向 Slot） |
|:---|:---|:---|
| **数据流** | Secretary → Agent（只读） | Secretary → Agent → Agent（读写） |
| **Agent 写回** | ❌ 只有完成后的交付物 | ✅ 执行过程中可写回中间发现 |
| **后续消费** | 无 | Curator 消费发现 → 长期记忆；下一个 Agent 读前序发现 |
| **解耦程度** | Secretary 需要预判所有上下文 | Agent 按需从 Slot 读取，按需写入 |

### 4.4 Secretary 初始化 Slot

```typescript
// Secretary 在派发任务前初始化 Slot
const slot: ContextSlot = {
  project: await projectMemory.get(projectId),
  memories: await longTermMemory.search(task.keywords, 5),
  preferences: await entityMemory.getPreferences(captainId),
  recent_files: fileTracker.getRecent(sessionId),
  security: { level: classifyLevel(task), tier: delegationTier },
  // Agent 可写区域（初始为空）
  discoveries: [],
  previous_outputs: [],
};

// Slot 挂载到子 Session
sessionManager.setContextSlot(childSessionId, slot);
```

### 4.5 Agent 读写 Slot

```
外部 Agent 执行过程中:

1. 启动时 → 从 A2A task context 获取完整 Slot
2. 执行中 → 发现新信息时回写:
   POST /api/slot/{task_id}/write
   {
     "discoveries": [
       { "type": "dependency", "file": "Login.tsx", "depends_on": "AuthContext" }
     ]
   }

3. 需要更多上下文时 → 从 Slot 读取（无需回连 Cabinet 查询）

4. 完成时 → 交付物写入 Slot.deliverable
```

### 4.6 并发安全：Slot 分叉与合并

问题：在 `WHEN(AgentA, AgentB)` 并行场景中，多个 Agent 可能同时操作同一个 Slot 的 `discoveries` 和 `previous_outputs` 字段。Cabinet 的外部 Agent 是**多进程**的，不能依赖 JVM 级的内存可见性。

解决方案：**分叉——合并**（Fork-Merge）。每个并行分支的 Agent 获得 Slot 的独立副本，完成后合并回主 Slot：

```typescript
// 分叉：每个并行 Agent 获得独立副本
function forkSlot(parentSlot: ContextSlot): ContextSlot {
  return {
    ...parentSlot,
    // 浅拷贝可写区域——每个分支独立修改，不互相干扰
    discoveries: [...parentSlot.discoveries],
    previous_outputs: [...parentSlot.previous_outputs],
  };
}

// 合并：并行分支全部完成后合并回主 Slot
function mergeSlots(main: ContextSlot, forks: ContextSlot[]): ContextSlot {
  const allDiscoveries = [
    ...main.discoveries,
    ...forks.flatMap(f => f.discoveries),
  ];
  const allOutputs = [
    ...main.previous_outputs,
    ...forks.flatMap(f => f.previous_outputs),
  ];
  return {
    ...main,
    discoveries: dedupeById(allDiscoveries),
    previous_outputs: allOutputs,
    // deliverable 保持不变——最终的 deliverable 由后续节点或 Secretary 确定
  };
}
```

工作流中的并行节点执行流程：

```
WHEN(AgentA, AgentB)
  ├── forkSlot(mainSlot) → slotA → AgentA → 完成后回传 slotA
  ├── forkSlot(mainSlot) → slotB → AgentB → 完成后回传 slotB
  └── mergeSlots(mainSlot, [slotA, slotB]) → 继续后续节点
```

**关键保证**：
- 每个 Agent 看到的 Slot 是**隔离的快照**——自己的写入不影响并行分支
- 合并是**追加**（append），不是覆盖——所有分支的发现都保留
- 如果 Agent 直接通过 REST API 回写 Slot（§4.5），写入的是**分叉后的副本**，不是主 Slot

### 4.7 Curator 消费 Slot

```
子 Session 关闭时:
  Curator 读取 Slot.discoveries
    → 筛选有价值的新发现
    → 写入 LongTermMemory
    → 更新 KnowledgeGraph
```


## 五，Agent 管理 + 任务分派

### 5.1 平台管理界面

```
┌─ Agent 管理 ─────────────────────────────────────────┐
│ 已注册 Agent (6)                        [+ 注册 Agent] │
│                                                        │
│ ┌─ Claude Code ── ● online ── [external_cli] ────────┐ │
│ │ 配置源: agent_native  权限: auto  遥测: 12.4k tokens│ │
│ │ 能力: code-generation, debug                        │ │
│ │ [打开终端] [分配任务] [查看遥测] [配置]              │ │
│ └────────────────────────────────────────────────────┘ │
│                                                        │
│ ┌─ Cursor AI ──── ● online ── [external_a2a] ────────┐ │
│ │ 端点: localhost:3002  配置源: cabinet_managed        │ │
│ │ [查看详情] [分配任务] [配置]                         │ │
│ └────────────────────────────────────────────────────┘ │
│                                                        │
│ ┌─ LangGraph Agent ◐ busy ── [external_a2a] ─────────┐ │
│ │ 端点: localhost:3003                                 │ │
│ │ [查看任务进度] [配置]                                │ │
│ └────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
```

### 5.2 A2A 任务分派

```typescript
// Cabinet → External Agent
POST {agent_base_url}/a2a/tasks
{
  task_id: string;
  session_id: string;
  capability: string;
  input: unknown;
  slot: ContextSlot;             // 完整的共享数据总线（Secretary 已初始化）
  configuration: {
    max_retries: number;
    timeout_ms: number;
    slot_write_url: string;      // Agent 回写 Slot 的端点
  };
}

// External Agent → Cabinet WebSocket
{
  type: "task_status",
  task_id: "task-456",
  status: "in_progress" | "completed" | "failed",
  progress: 0.6,
  telemetry: {                   // 借鉴 WeSight 的遥测设计
    tokens: { prompt: 1500, completion: 800 },
    timing: { ttft_ms: 320, total_ms: 12000, tool_latency_ms: [200, 450] },
    steps: 4,
    model: "claude-sonnet-4-6"
  }
}
```

### 5.3 CLI Agent 适配器（简化设计）

借鉴 WeSight——不需要工厂模式，配置驱动：

```typescript
// 所有 CLI Agent 共用一个 Adapter
class CliAdapter implements ExternalAgentAdapter {
  constructor(private config: CliAgentConfig) {}

  // 自动检测 CLI 是否已安装
  async detect(): Promise<boolean> {
    if (!this.config.detectCommand) return false;
    try {
      await exec(this.config.detectCommand);
      return true;
    } catch {
      return false;
    }
  }

  // 一键安装
  async install(): Promise<void> {
    if (this.config.installCommand) {
      await exec(this.config.installCommand);
    }
  }

  // 模式 A: 单次请求-响应（--print）
  async dispatchTask(task: ExternalTask): Promise<ExternalTaskResult> {
    // spawn: command + args + Slot 注入到 stdin prompt
    // stdout → parse → ExternalTaskResult
  }

  // 模式 B: 嵌入式终端（xterm.js + PTY，详见第七章）
  // 模式 C: Hooks 异步（未来）
}
```

与 v3.0 的区别：
- ❌ 删除了 `abstract class CliAgentAdapter` + 每个 Agent 一个子类
- ❌ 删除了 `AdapterFactory`
- ✅ 一个通用 `CliAdapter`，靠 `CliAgentConfig` 区分不同 Agent
- ✅ 增加了 `detect()` / `install()` 自动检测和安装
- ✅ 增加了 `configSource: 'cabinet_managed' | 'agent_native'` 双模式配置源

#### 5.3.1 Prompt 渲染：Slot → CLI stdin

CLI Agent 通过 **stdin 管道**接收 prompt（不受命令行长度限制，Agent 无需访问 Cabinet 文件系统）：

```typescript
function renderPrompt(slot: ContextSlot, task: ExternalTask): string {
  return [
    `## 任务`,
    task.input.requirement,
    '',
    `## 项目上下文`,
    `- 项目: ${slot.project.name}`,
    `- 技术栈: ${slot.project.tech_stack}`,
    `- 目标: ${slot.project.goals.join(', ')}`,
    '',
    `## 相关记忆`,
    ...slot.memories.map(m => `- ${m}`),
    '',
    `## 最近文件`,
    ...slot.files.map(f => `- ${f}`),
    '',
    `## Captain 偏好`,
    `- 风险容忍度: ${slot.preferences.riskTolerance}`,
    `- 决策风格: ${slot.preferences.preferredDecisionStyle}`,
    '',
    `## 安全约束`,
    `- 安全级别: ${slot.security.level}`,
    `- 最大重试次数: ${slot.security.maxRetries}`,
    '',
    `## 输出协议（严格遵守）`,
    `执行过程中如有中间发现，用分隔符标记：`,
    `===CABINET_DISCOVERY===`,
    `{"type": "...", "summary": "..."}`,
    `===END_DISCOVERY===`,
    '',
    `任务完成时，用分隔符标记最终交付物：`,
    `===CABINET_DELIVERABLE===`,
    `<最终代码/报告/结果>`,
    `===END_DELIVERABLE===`,
  ].join('\n');
}

// spawn CLI Agent，通过 stdin 传入 prompt
async dispatchTask(task: ExternalTask): Promise<ExternalTaskResult> {
  const prompt = renderPrompt(task.slot, task);
  const proc = spawn(this.config.command, this.config.args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...this.config.env },
  });
  proc.stdin.write(prompt);
  proc.stdin.end();

  const stdout = await readStream(proc.stdout);
  return parseOutput(stdout, task.task_id);
}
```

#### 5.3.2 输出解析：stdout → 结构化结果

分隔符协议让 CLI Agent 的非结构化文本输出可被机器解析：

```typescript
interface ParsedOutput {
  discoveries: Array<{ type: string; summary: string }>;
  deliverable: string;
}

function parseOutput(stdout: string, taskId: string): ExternalTaskResult {
  const discoveries = extractTaggedSections(stdout, 'CABINET_DISCOVERY');
  const deliverable = extractTaggedSection(stdout, 'CABINET_DELIVERABLE');

  return {
    task_id: taskId,
    status: 'completed',
    output: deliverable ?? stdout,  // 降级：没找到分隔符就用完整输出
    discoveries: discoveries.map(d => {
      try { return JSON.parse(d); }
      catch { return { type: 'text', summary: d.trim() }; }
    }),
    audit: {
      started_at: new Date().toISOString(),  // 由 Adapter 记录
      completed_at: new Date().toISOString(),
    },
  };
}
```

**协议约束**：Agent 不需要原生支持 JSONL 或结构化输出。只需在关键位置插入人类可读的分隔符。如果 Agent 完全忽略了分隔符，`output` 降级为完整 stdout 文本。

### 5.4 双模式配置源（借鉴 WeSight）

| 模式 | 说明 | 示例 |
|:---|:---|:---|
| `cabinet_managed` | Cabinet 统一管理 provider + model，映射到 Agent | 用户在 Cabinet Settings 配好 Anthropic key，所有 Agent 共享 |
| `agent_native` | Agent 使用自己的 CLI 配置和 API key | Claude Code 用自己 `~/.claude/` 的配置；Codex 用 `CODEX_API_KEY` |

### 5.5 遥测上报（借鉴 WeSight Runtime Dashboard）

```typescript
// Agent 任务完成时上报
POST /api/telemetry/report
{
  task_id: string;
  agent_id: string;
  model: string;
  tokens: { prompt: number; completion: number };
  timing: {
    ttft_ms: number;           // Time To First Token
    total_ms: number;
    tool_latency_ms: number[]; // 每个 tool call 的耗时
  };
  steps: number;               // Agent 工具调用次数
  status: 'completed' | 'failed';
}

// Cabinet 侧存储到 TelemetryStore
// Dashboard Runtime Dashboard 展示:
//   - 各 Agent 的调用次数、模型分布、成功率
//   - 按引擎/模型/来源/状态的消耗统计
//   - TTFT、TPS、工具延迟趋势
```


## 六，通信与信息聚合

### 6.1 通信架构

```
┌──────────────────────────────────────────────────────────┐
│  Cabinet → Agent（任务分派 + 审批通知）                   │
│  ├── A2A: 标准化任务分派（含完整 Context Slot）           │
│  ├── CLI stdin: 兼容路径                                 │
│  └── WebSocket / HTTP callback: 审批结果通知              │
├──────────────────────────────────────────────────────────┤
│  Agent → Cabinet（数据推送）                              │
│  ├── POST /api/slot/{task_id}/write  : Slot 回写（新增）  │
│  ├── POST /api/decisions             : 推送审批请求       │
│  ├── POST /api/deliverables          : 提交交付物         │
│  ├── POST /api/telemetry/report      : 遥测上报（扩展）   │
│  └── WebSocket                       : 实时状态同步       │
└──────────────────────────────────────────────────────────┘
```

**A2A 与 WebSocket 的关系**（澄清二者不重叠）：

A2A 协议（Google 定义）是**纯 HTTP** 的，核心通信模式为：

```
POST /a2a/tasks          → 创建任务（同步返回 accepted/rejected）
GET  /a2a/tasks/{id}     → 轮询任务状态
POST /a2a/tasks/{id}/cancel → 取消任务
```

A2A 不包含 WebSocket 通道，也没有事件推送机制。Cabinet 的 WebSocket 是**平台自建的补充通道**，分层如下：

| 层 | 协议 | 职责 |
|:---|:---|:---|
| **任务生命周期** | A2A（HTTP） | 创建、查询、取消任务——遵循 A2A 标准 |
| **实时事件流** | WebSocket（平台自建） | 状态推送、审批通知、遥测流——A2A 未覆盖的部分 |
| **数据推送** | REST API（平台自建） | Slot 回写、Decision 推送、Deliverable 提交——Agent 主动推送 |

为什么不用 A2A polling 替代 WebSocket：
- **审批延迟不可接受**：Captain 可能几分钟后才审批，polling 间隔短浪费资源，间隔长延迟不可控
- **遥测流**：实时推送 TTFT / TPS / 工具延迟，polling 不合适
- **双向通知**：Cabinet 需要主动通知 Agent 审批结果，A2A 没有 server-push 机制

### 6.2 完整任务生命周期

```
阶段 0: 注册 + 检测
  Adapter.detect() → 发现已安装的 Agent
  或 Adapter.install() → 一键安装
  或 A2A 自动发现 /.well-known/agent.json
  → AgentRoleRegistry.register()

阶段 1: 路由 + Slot 初始化
  Captain → Secretary → IntentParser → 路由决策
  Secretary → Memory 体系 → 收集上下文
  Secretary → SessionManager → 创建子 Session + 初始化 Context Slot
  AgentEventBus → 子 Session 创建事件

阶段 2: 分派
  Adapter → Agent: 派发任务 { task_id, session_id, capability, input, slot }

阶段 3: 执行中（双向 Slot 读写）
  Agent → Slot: 读取 project, memories, preferences
  Agent → Slot: 写入 discoveries（中间发现）
  Agent → POST /api/decisions: 推送审批请求
  Captain → DecisionService → WebSocket → Agent: 审批结果
  Agent → WebSocket: 实时状态 + 遥测流

阶段 4: 完成
  Agent → Slot: 写入 deliverable
  Agent → POST /api/deliverables
  Agent → POST /api/telemetry/report
  AgentEventBus → Session: 交付物注入父 Session
  SessionManager: 子 Session 关闭
  Curator → Slot.discoveries → LongTermMemory（消费 Agent 写回的发现）

阶段 5: 异常
  定期 health check → Agent 超时/断连 → error → 通知 Captain
  任务超时 → 根据 maxRetries 重试
  重连 → 查询未完成任务 → 幂等恢复
```

### 6.3 Activity Feed

```
┌─ Activity ───────────────────────────────────────────┐
│ 14:30  Claude Code 完成 "创建登录页面"                │
│        └─ 交付物: Login.tsx  │ 遥测: 2.3k tokens, 12s │
│ 14:25  Claude Code 回写发现 (1 条)                    │
│        └─ "Login.tsx 依赖 AuthContext" → 长期记忆     │
│ 14:20  Curator 消费 Slot 发现 → 更新知识图谱          │
└──────────────────────────────────────────────────────┘
```


## 七，Workflow 编排

### 7.1 Agent 节点统一化

所有 Agent（不论内部/外部）都是统一的 Agent 节点类型。编排层不区分来源：

```
┌──────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────┐
│  Start   │───▶│  Agent       │───▶│  Agent       │───▶│   End    │
│          │    │ claude-code  │    │ cursor-v1    │    │          │
└──────────┘    └──────┬───────┘    └──────────────┘    └──────────┘
                       │
         ┌─────────────┼─────────────┐
         ▼             ▼             ▼
    Context Slot    Decision      Telemetry
    (读写共享)      (审批推送)     (自动上报)
```

### 7.2 DSL 扩展：支持 EL 表达式（借鉴 LiteFlow）

在现有蓝图 YAML 基础上，增加 EL（Expression Language）表达式模式作为高级用法：

```yaml
# 基础模式（保持兼容）: YAML 定义
workflows:
  - name: "代码审查流水线"
    nodes:
      - id: gen
        type: agent
        agentId: claude-code-v1
      - id: review
        type: agent
        agentId: cursor-v1
    edges:
      - from: start
        to: gen
      - from: gen
        to: review
      - from: review
        to: end
```

```
# 高级模式（新增）: EL 表达式
THEN(
  claudeCode("根据需求生成代码"),
  WHEN(
    cursorReview("审查代码"),
    codexCheck("安全检查")
  ).maxWaitSeconds(120),
  IF(hasIssues, captainReview, summary)
)
```

EL 表达式最终编译为 StateGraph，与 YAML 蓝图等价。用户可以选择更紧凑的 EL 语法或更结构化的 YAML。

**EL 分阶段交付**：完整的 EL 编译器（词法分析、语法解析、嵌套 chain、循环、错误提示）工程量较大，建议分阶段交付：

| 阶段 | 交付范围 | 预估 |
|:---|:---|:---|
| Phase 3 | `THEN` + `WHEN` + `IF`（含 `.ELIF/.ELSE`）+ `SWITCH` | 2-3 天 |
| Phase 4+ | `FOR` + `WHILE` + 嵌套 chain + subflow | 1-2 周 |
| Phase 4+ | 语法错误位置提示 + IDE 补全 | 1 周 |

Phase 3 的核心子集涵盖了 80% 的实际使用场景。实现上建议使用 PEG.js 等解析器生成器，避免手写完整编译器的复杂度。

### 7.3 循环与子流程（新增）

LiteFlow 的 `FOR` / `WHILE` 和嵌套 chain 是生产工作流必备的。在 StateGraph 中增加：

```typescript
// 循环边（在 conditional edge 基础上支持循环语义）
interface LoopConfig {
  maxIterations: number;    // 最多迭代次数
  continueCondition: string; // 继续循环的条件表达式
}

// 子流程（嵌套 chain）
interface SubFlowNode {
  type: 'subflow';
  workflowId: string;       // 引用另一个 Workflow
  input: string;            // 从 Slot 取值的路径
  output: string;           // 写回 Slot 的路径
}
```

### 7.4 蓝图集成

```yaml
# .cabinet/blueprint/team.yml
agents:
  - id: claude-code-v1
    source: external_cli
    config:
      configSource: agent_native
      command: claude
      args: ["--print"]
      detectCommand: "which claude"

  - id: cursor-v1
    source: external_a2a
    config:
      configSource: cabinet_managed
      base_url: http://localhost:3002

workflows:
  - name: "CI/CD 代码流水线"
    el: |
      THEN(
        prepareContext,
        WHEN(claudeCode("生成代码"), parallelTests),
        IF(needsReview, cursorReview, skip),
        deployCheck
      )
```

### 7.5 规则热加载（借鉴 LiteFlow）

```
蓝图文件变更
  → watcher 检测到变更
  → BlueprintValidator 验证
  → 通过 → 热加载到 WorkflowEngine
  → 不通过 → 保留旧版本 + 通知 Captain
```

---

## 八，嵌入式对话窗口

### 8.1 需求

Captain 在 Cabinet 界面内打开终端窗口，**直接与外部 CLI Agent（如 Claude Code）交互**，类似于 VS Code 的 Claude Code 插件体验。

### 8.2 技术方案

```
┌──────────────────────────────────────────┐
│  Cabinet Desktop (Tauri + React)         │
│  ┌────────────────────────────────────┐  │
│  │  Agent Shell 面板                  │  │
│  │  ┌──────────────────────────────┐  │  │
│  │  │  xterm.js + PTY              │  │  │
│  │  │  $ claude                    │  │  │
│  │  │  > 创建登录页面               │  │  │
│  │  │  [Claude Code 输出...]       │  │  │
│  │  └──────────────────────────────┘  │  │
│  │  ● tokens: 2.4k | ttft: 320ms      │  │
│  │  [提交为交付物] [写入 Slot] [保存]  │  │
│  └────────────────────────────────────┘  │
│              │ IPC (Tauri invoke)         │
│  ┌───────────▼────────────────────────┐  │
│  │  Tauri Rust: portable-pty          │  │
│  │  - pty ↔ IPC ↔ xterm.js            │  │
│  │  - 命令拦截 → Harness 检查          │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

### 8.3 终端特色功能

- **Agent 选择器**：切换不同 CLI Agent
- **交付物提取**：选中输出 → 一键提交
- **Slot 写入**：选中输出 → 写入 Context Slot（供后续 Agent 消费）
- **命令拦截**：高风险命令 → DecisionService 审批链
- **遥测展示**：实时显示 tokens、TTFT、步骤数


## 九，统一安全与配置

### 9.1 安全模型

所有 Agent 经过同一套检查链：

```
Agent 的操作
  → Adapter → ClassificationInput
  → LevelClassifier.classify() → L0..L3
  → SafetyChecker.check(level, tier) → allow / deny / require_approval
  → require_approval → DecisionService.create()
    → PolicyEngine.checkDecision()
    → EscalationService.escalate()（L3 时）
    → Captain 审批 → WebSocket/HTTP → Agent
```

### 9.2 安全组件扩展点

| 组件 | 新增 |
|:---|:---|
| `LevelClassifier` | 增加 `agentTrustLevel`——高信任度 Agent 可降低一级 |
| `SafetyChecker` | 增加对外部 Agent 操作类型的感知 |
| `PolicyEngine` | 增加 mission：`external_agent_sandbox` |
| `BudgetGuard` | 外部 Agent 遥测进入 CostTracker |

### 9.3 配置层级（四层覆盖）

```
全局默认 → Agent 类型默认 → 单个 Agent 配置 → 单次任务 overrides
```

### 9.4 双模式配置源（借鉴 WeSight）

| 模式 | 适用场景 |
|:---|:---|
| `cabinet_managed` | 用户希望统一管理密钥和模型，Agent 不需要自己的配置 |
| `agent_native` | Agent 已有自己的 CLI 配置和 API key，Cabinet 不干预 |


## 十，错误恢复与幂等性

### 10.1 任务幂等

- 每个外部任务有唯一 `task_id`，分派前检查是否已存在
- 重复分派 → 返回已有结果或恢复执行

### 10.2 超时 / 崩溃 / 审批可靠性

- **超时**：标记 `error` → AgentEventBus → Captain → 按 maxRetries 重试
- **崩溃恢复**：断连 → `awaiting_recovery` → 重连后幂等恢复
- **审批回调**：WebSocket + HTTP 双通道通知，ACK + 指数退避重试


## 十一，A2A 接入详细设计

### 11.1 能力发现

```json
// GET /.well-known/agent.json
{
  "agent_id": "cursor-v1",
  "display_name": "Cursor AI",
  "version": "1.0.0",
  "capabilities": [
    {
      "name": "code-review",
      "description": "审查代码质量",
      "input_schema": { "properties": { "code": { "type": "string" } } },
      "security_level": "read_only"
    }
  ],
  "connection": {
    "protocol": "a2a",
    "base_url": "http://localhost:3002",
    "health_check": "http://localhost:3002/health"
  }
}
```

### 11.2 任务分派

```typescript
POST {agent_base_url}/a2a/tasks
{
  task_id: string;
  session_id: string;
  capability: string;
  input: unknown;
  slot: ContextSlot;          // 完整共享数据总线
  configuration: {
    max_retries, timeout_ms,
    slot_write_url: string;   // Agent 回写 Slot 的 REST 端点
  };
}
```

### 11.3 目标 Agent

| Agent | A2A 支持 | 接入 |
|:---|:---|:---|
| LangGraph Agent | ✅ | A2A Connector |
| CrewAI Agent | ✅ | A2A Connector |
| Google ADK Agent | ✅ | A2A Connector |
| OpenCodex | ✅ | A2A Connector |
| Cursor | 待确认 | 优先 A2A，备选 CLI |
| Claude Code | CLI | CLI Adapter |


## 十二，实施路线图

```
Phase 1 (1-2 周): 基础设施对齐 + 内部简化
  ├── AgentRoleRegistry 扩展 (external_a2a / external_cli)
  ├── Context Slot 实现（Session 新增 contextSlot 字段）
  ├── Agent 节点统一化（废弃 external_agent 类型，统一为 agent）
  ├── 移除 Meeting Agent
  ├── Provider 分层简化（废弃 tier → 单模型）
  ├── ModelRouter / ToolPruner / AutoAdjuster 模型切换 → 废弃
  └── 验收: 内部清理完毕，Slot 机制可工作

Phase 2 (2-3 周): A2A + CLI Adapter 并行开发
  ├── CliAdapter: 配置驱动通用 Adapter + detect/install + 双模式配置源
  ├── A2A Connector: 能力发现、任务分派、Slot 传递、WebSocket
  ├── Slot 回写 API: POST /api/slot/{task_id}/write
  ├── TelemetryStore + POST /api/telemetry/report
  ├── 安全扩展: Agent 操作 → ClassificationInput → 检查链
  └── 验收: 两个 Agent（A2A + CLI）完成完整任务闭环

Phase 3 (2-3 周): 终端集成 + Workflow 扩展
  ├── xterm.js + Tauri PTY 嵌入式终端 + 命令拦截
  ├── EL DSL 核心子集解析器（THEN + WHEN + IF/SWITCH → StateGraph）
  ├── Slot 分叉/合并机制（并行节点并发安全）
  ├── 蓝图支持 EL 表达式 + 双模式配置源
  ├── Activity Feed + Runtime Dashboard
  └── 验收: Captain 终端操作 + Workflow 含外部 Agent 节点的复杂流程

Phase 4 (1-2 周): 标准化 + 热加载 + 文档
  ├── 规则热加载（蓝图文件 watcher）
  ├── Agent Manifest Schema 标准化
  ├── 外部 Agent SDK (@cabinet/agent-sdk)
  └── 验收: 第三方开发者可按文档创建兼容 Agent

Phase 5 (后续，1-3 周): EL 完整语法 + 循环
  ├── FOR / WHILE 循环支持（需 StateGraph 扩展循环边）
  ├── 嵌套 chain + subflow
  ├── 语法错误位置提示
  └── 验收: 完整 LiteFlow 级编排语法可用
```


## 十三，总结

### 13.1 设计原则

1. **Agent 节点统一化**：编排层不区分 Agent 来源（内部/外部），都是统一的 Agent 节点
2. **Context Slot 双向共享**：Agent 不直接传参，所有数据通过 Slot 读写（借鉴 LiteFlow）
3. **配置驱动薄 Adapter**：不需要工厂模式，配置区分不同 Agent（借鉴 WeSight）
4. **基于现有代码扩展**：AgentEventBus、DecisionService、WorkflowEngine 全部复用
5. **三通道各司其职**：A2A = 任务分派，REST API = 数据推送，MCP = 仅内部工具连接
6. **安全统一**：所有 Agent 经过同一套检查链
7. **核心最小化**：Cabinet 只保留 Secretary + Curator + Organize

### 13.2 版本演进

| 维度 | v3.0 | v3.1 | v3.2 |
|:---|:---|:---|:---|
| 上下文 | Secretary 单向打包 | Context Slot 双向共享 | + 分叉/合并并发安全 |
| Adapter | Factory + 抽象类 + 子类 | 配置驱动通用 Adapter + detect/install | + Prompt 渲染协议 + 分隔符解析 |
| Agent 节点 | `type: 'external_agent'` | 统一 `type: 'agent'` | — |
| 配置源 | 单一 | 双模式（cabinet_managed / agent_native） | — |
| 遥测 | 仅 tokens_used | 完整遥测（TTFT/TPS/工具延迟） | — |
| 编排 DSL | YAML 蓝图 | YAML + EL 表达式 | + EL 分阶段交付计划 |
| CLI 交互 | 未明确 | 三种模式 | + stdin 管道 + 分隔符协议 |
| A2A/WebSocket | 未区分 | 互补使用 | + 分层关系澄清 |
| 并发 | 未涉及 | 未涉及 | + Slot 分叉/合并 |
| 循环/子流程 | 无 | FOR/WHILE + subflow | 移入 Phase 5 |
| 设计参考 | — | WeSight + LiteFlow | — |

### 13.3 协议分工

```
Cabinet → Agent:
  └── A2A（标准）或 CLI stdin（兼容）: 任务 + Context Slot

Agent → Cabinet:
  ├── WebSocket: 状态同步
  ├── POST /api/slot/{id}/write: Slot 回写
  ├── POST /api/decisions: 推送审批
  ├── POST /api/deliverables: 提交交付物
  └── POST /api/telemetry/report: 遥测上报

内部:
  └── MCP: Secretary/Curator 连接外部工具
```

### 13.4 最终愿景

Captain 在 Cabinet 中：
- **注册**各类专业 Agent（Claude Code、Cursor、Codex……），自动检测或一键安装
- **编排**它们到 Workflow 中——Agent 就是链上的一个节点，与 Java 组件、脚本组件无异
- **对话**——在界面内直接打开终端与 Agent 交互，实时看到遥测
- **审批**——所有 Agent 的关键操作汇聚到统一的 Decision 面板
- **查看**——所有 Agent 的交付物、中间发现、成本和性能在一个 Dashboard 中呈现

**"能编排 LiteFlow，就能编排 AI Agent。" Cabinet 把这个理念往前推了一步——"能管理 Agent，就能编排 Agent。"**
