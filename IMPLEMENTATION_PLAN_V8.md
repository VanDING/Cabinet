# Cabinet → Mastra 修复与收尾计划 v8

> 基于审计报告 14 项发现 + Mastra Workspace/MCP 内置工具能力的重新评估
> 日期：2026-06-23
> 前置：Phase A-H 编译已通过，14 项审计问题需解决

---

## 核心认知转变

Mastra 不是裸工具框架。它有 **Workspace**（文件/Shell/LSP/搜索工具）和 **MCP**（浏览器/Web/外部工具），覆盖了 Cabinet 60%+ 的自研工具。自定义工具只需覆盖 Cabinet 独有的 6 个领域。

```
旧认知: 75+ tools 全部要迁移为 createTool()
新认知:
  Workspace → 14 个文件工具 + 1 个 Shell 工具 + 4 个 LSP 工具 + 搜索工具
  MCP       → 6 个浏览器工具 + 2 个 Web 工具 + 动态外部工具
  createTool → 6 个 Cabinet 独有类别 (~25 tools)
```

**总删除：** 自研文件工具(15) + Shell(1) + LSP(4) + 浏览器(6) + Web(3) + 文档(4) + 知识搜索(3) + 技能(3) + 通知/剪贴板(7) ≈ 46 个工具不再需要。**保留约 25 个 Cabinet 独有工具。**

---

## Phase R1: 修复严重问题（约 2 小时）

### R1.1：Memory vector/embedder 配置

**问题：** `semanticRecall: true` 缺少 `vector` 和 `embedder`

```typescript
// mastra/index.ts 修改
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import { ModelRouterEmbeddingModel } from '@mastra/core/llm';

const vector = new LibSQLVector({
  id: 'cabinet-vector',
  url: 'file:./data/cabinet-vector.db',
});

const memory = new Memory({
  storage,
  vector,
  embedder: new ModelRouterEmbeddingModel('openai/text-embedding-3-small'),
  options: {
    // ... 不变
  },
});
```

### R1.2：修复硬编码 sessionId

**问题：** `memory.ts` 所有工具使用 `'default-session'`

**修改：** Mastra agent 的 `context` 参数包含当前 session 信息。每个工具从 context 获取真实的 threadId：

```typescript
// mastra/tools/memory.ts 修改方案
// 工具 execute 函数接收 context，提取 resource/thread：
// { context }: { context: { threadId?: string; resourceId?: string } }
// sessionId = context.threadId || context.resourceId || 'default'
```

---

## Phase R2: 用 Mastra Workspace 替换文件/Shell 工具（约 1 小时）

### R2.1：创建 Workspace

```typescript
// mastra/workspace.ts (新建)
import { Workspace, LocalFilesystem, LocalSandbox, WORKSPACE_TOOLS } from '@mastra/core/workspace';

export const cabinetWorkspace = new Workspace({
  filesystem: new LocalFilesystem({
    basePath: process.cwd(),
  }),
  sandbox: new LocalSandbox({
    workingDirectory: process.cwd(),
  }),
  tools: {
    // 危险操作需要审批
    [WORKSPACE_TOOLS.FILESYSTEM.DELETE]: {
      requireApproval: true,
    },
    [WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND]: {
      requireApproval: true,
    },
    // 工具名称映射为 Cabinet 旧名称，保持兼容
    [WORKSPACE_TOOLS.FILESYSTEM.READ_FILE]: { name: 'readFile' },
    [WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE]: { name: 'writeFile' },
    [WORKSPACE_TOOLS.FILESYSTEM.LIST_FILES]: { name: 'listDirectory' },
    [WORKSPACE_TOOLS.FILESYSTEM.GREP]: { name: 'grep' },
    [WORKSPACE_TOOLS.FILESYSTEM.DELETE]: { name: 'deleteFile' },
    [WORKSPACE_TOOLS.FILESYSTEM.MOVE]: { name: 'moveFile' },
    [WORKSPACE_TOOLS.FILESYSTEM.COPY]: { name: 'copyFile' },
    [WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND]: { name: 'executeCommand' },
  },
});
```

**删除清单：**

```
❌ mastra/tools/file.ts    (全部 14 个文件工具 → Workspace filesystem)
❌ mastra/tools/shell.ts   (execCommand → Workspace sandbox)
❌ mastra/tools/filesystem.ts (旧死代码也删除)
```

**保留清单：**

```
✅ mastra/tools/web.ts   (转为 MCP，Phase R3)
✅ mastra/tools/memory.ts (保留 Cabinet 独有记忆工具)
✅ mastra/tools/workflow.ts (保留，连接 Mastra workflow API)
```

### R2.2：Agent 使用 Workspace

```typescript
// mastra/agents/secretary.ts 修改
import { cabinetWorkspace } from '../workspace.js';

export const secretaryAgent = new Agent({
  // ...
  workspace: cabinetWorkspace,
  tools: { ...cabinetTools }, // 只包含 Cabinet 独有工具
});
```

---

## Phase R3: MCP 替换浏览器/Web 工具（约 30 分钟）

**现状：** browser-tools.ts 用 Playwright（被删除，未重新实现）
**Mastra 方案：** 连接 Playwright MCP server

```typescript
// mastra/mcp.ts (新建)
import { MCPClient } from '@mastra/mcp';

export const browserMcp = new MCPClient({
  id: 'cabinet-browser',
  servers: {
    browser: {
      command: 'npx',
      args: ['-y', '@anthropic/mcp-browser@latest'],
    },
    webFetch: {
      url: new URL('http://localhost:3001/mcp'), // 自建 web-fetch MCP 或外部服务
    },
  },
});

// 在 agent 上注册：
tools: await browserMcp.listTools(),
```

**删除清单：**

```
❌ mastra/tools/web.ts (webFetch/httpRequest → MCP)
❌ packages/agent/src/tools/browser-tools.ts (已被 Mastra MCP 覆盖)
❌ packages/agent/src/tools/web-tools.ts
❌ packages/harness/src/browser-pool.ts (浏览器池不再需要)
```

---

## Phase R4: 补全 Cabinet 独有工具（约 2 小时）

只有 **6 个类别** 需要自定义实现：

```
mastra/tools/
├── decision.ts     ← getDecision, queryDecisions, createDecision, approveDecision, rejectDecision
├── knowledge.ts    ← queryKnowledgeGraph, updateKnowledgeGraph, detectContradiction
├── project.ts      ← getProjectContext, setProjectContext, createProject, listProjects, addMilestone, getPreferences, setPreferences
├── agent.ts        ← listAgents, registerAgent, deleteAgent, invokeAgent
├── scheduler.ts    ← scheduleTask, listScheduledTasks, cancelScheduledTask
├── status.ts       ← getStatus, getDashboardStats, getMemoryStats
└── index.ts        ← 聚合导出
```

每个工具文件使用 `createTool()` + `tool-context.ts` 访问 ServerContext 的服务。

---

## Phase R5: 修复安全问题（约 30 分钟）

### R5.1：Agent maxSteps 限制

```typescript
// mastra/agents/secretary.ts
export const secretaryAgent = new Agent({
  // ...
  defaultOptions: {
    maxSteps: 50,
  },
});
```

### R5.2：Workspace 提供额外的安全检查

Workspace 自带:

- `requireReadBeforeWrite`: 写前必须读
- `requireApproval`: 危险操作需审批
- `maxOutputTokens: 2000`: 输出截断
- ANSI 清理: 自动清除

Agent hooks 保留 Cabinet 独有的路径安全检查（敏感文件保护）。

---

## Phase R6: 杂项修复（约 30 分钟）

| #    | 问题                          | 修复                                                                           |
| ---- | ----------------------------- | ------------------------------------------------------------------------------ |
| R6.1 | `filesystem.ts` 死代码        | 删除                                                                           |
| R6.2 | `workflow.ts` stub 工具       | 连接真实 Mastra workflow API：`mastra.getWorkflow('processFiles').createRun()` |
| R6.3 | code-review.ts 平台命令       | 改为跨平台命令或增加平台判断                                                   |
| R6.4 | 工具 ID 风格统一为 snake_case | 或保持 camelCase + prompt 中注明                                               |
| R6.5 | 添加 delegation hooks         | `onDelegationStart` 做安全审计/日志                                            |
| R6.6 | Observability 存储            | 保持 LibSQL（简单部署），DuckDB 为可选升级                                     |

---

## Phase R7: 旧代码清理（约 1 小时）

删除以下不再需要的包文件：

```
packages/agent/src/tools/file-tools.ts        ✗ (Workspace filesystem)
packages/agent/src/tools/shell-tools.ts       ✗ (Workspace sandbox)
packages/agent/src/tools/web-tools.ts         ✗ (MCP)
packages/agent/src/tools/browser-tools.ts     ✗ (MCP)
packages/agent/src/tools/document-tools.ts    ✗ (Agent 用 shell 调用 pandoc/pdf)
packages/agent/src/tools/knowledge-tools.ts   ✗ (Workspace search)
packages/agent/src/tools/lsp-tools.ts         ✗ (Workspace LSP)
packages/agent/src/tools/system-tools.ts      ✗ (平台差异大，不在服务端)
packages/agent/src/tools/communication-tools.ts ✗ (MCP 或外部服务)
packages/agent/src/tools/archive-tools.ts     ✗ (Agent 用 shell 调用 unzip)
packages/agent/src/tools/skill-tools.ts       ✗ (Workspace skills)
packages/agent/src/tools/evaluation-tools.ts  ✗ (Mastra Evals)
packages/agent/src/tools/review-tools.ts      ✗ (Mastra suspend/resume)
packages/agent/src/tools/mcp-tools.ts         ✗ (Mastra MCP 内置)
packages/agent/src/tools/employee-tools.ts    ✗ (独立服务)
packages/agent/src/tools/event-tools.ts       ✗ (Mastra Observability)
packages/agent/src/tools/system-knowledge-tools.ts ✗ (合并到 status)
packages/agent/src/tools/task-tools.ts        ✗ (合并到 project)
packages/agent/src/tools/status-tools.ts      ✗ (重做到 mastra/tools/status.ts)

✅ 保留:
packages/agent/src/tools/decision-tools.ts    ← 迁移到 mastra/tools/decision.ts
packages/agent/src/tools/project-tools.ts     ← 迁移到 mastra/tools/project.ts
packages/agent/src/tools/agent-tools.ts       ← 迁移到 mastra/tools/agent.ts
packages/agent/src/tools/scheduler-tools.ts   ← 迁移到 mastra/tools/scheduler.ts
packages/agent/src/tools/memory-tools.ts      ← 迁移到 mastra/tools/memory.ts
packages/agent/src/tools/workflow-tools.ts    ← 迁移到 mastra/tools/workflow.ts
```

---

## 最终对比

| 指标           | 迁移前                | 当前 (v7 Phase H)           | 收尾后 (v8)                                        |
| -------------- | --------------------- | --------------------------- | -------------------------------------------------- |
| 自研工具数     | 75+                   | ~30 (仅 5 类)               | ~25 (仅 6 类 Cabinet 独有)                         |
| 工具实现方式   | 全部 createSdkTools() | 全部 createTool()           | Workspace + MCP + createTool()                     |
| 文件工具安全性 | 无强制检查            | hooks 3 个模式              | Workspace requireReadBeforeWrite + requireApproval |
| Memory 配置    | 自研 STM/LTM          | Mastra OM+WM+SR             | Mastra OM+WM+SR + embedder/vector ✅               |
| sessionId 隔离 | 按 session            | 硬编码 'default-session' ❌ | 从 context.threadId 提取 ✅                        |
| 审计问题       | —                     | 14 项                       | 0 项                                               |

---

## 执行顺序

```
R1 (修复严重) → R2 (Workspace 文件/Shell) → R3 (MCP 浏览器/Web)
                                              ↓
R4 (补全 Cabinet 工具) ←──────────────────────┘
         ↓
R5 (安全修复) → R6 (杂项) → R7 (旧代码删除)
```

**总工作量：** 约 8 小时前端完整实施。
