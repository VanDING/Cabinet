# Cabinet V13 Agent 体系扩展计划（源码对标修正版）

> 基于 Claude Code 源码（plugins/feature-dev/agents/）+ Codex 源码（PermissionProfile 模型）
> 原则从源码中来，不凭空设计。

---

## 源码对标结论

### Claude Code 的设计

三个 specialist agent（explorer / architect / reviewer）：

```
Agent        Tools                          Model   Write?  Execute?
─────────────────────────────────────────────────────────────────
code-explorer  Glob Grep LS Read WebFetch   sonnet    ✗       ✗
               WebSearch TodoWrite KillShell
               BashOutput

code-architect Glob Grep LS Read WebFetch   sonnet    ✗       ✗
               WebSearch TodoWrite KillShell
               BashOutput

code-reviewer  Glob Grep LS Read WebFetch   sonnet    ✗       ✗
               WebSearch TodoWrite KillShell
               BashOutput
```

**发现**：

1. **三个 agent 工具集完全一样** — 都是只读分析工具，没有任何 write/edit/exec 权限
2. **三个 agent 用同一个模型**（sonnet）— 没有按角色分模型层级
3. **差异化全靠 instructions prompt** — 不是工具集，不是模型，不是步数
4. **没有显式的 maxSteps** — 由框架层统一管理
5. **KillShell / BashOutput 是只读的** — 能查看 shell 输出但不能执行命令

### Codex 的设计

权限控制通过 `PermissionProfile` 而非工具枚举：

```
PermissionProfile::Managed { file_system, network }   → 受控沙箱
PermissionProfile::Disabled                           → 完全访问
PermissionProfile::External { network }               → 外部沙箱
```

- 使用 sandbox 层做隔离，不是 agent 层工具白名单
- `read_only` profile:**PermissionProfile::Managed** 加文件系统限制
- 没有 maxSteps 概念（码——由 API 服务端控制回合数）

### 对 Cabinet V13 的修正

| 原计划                    | 修正                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------- |
| 每个 agent 不同工具集     | **只用两套工具集**：read-only（分析/审查/规划/搜索 共用）vs full（秘书/写手/测试 拥有） |
| 每个 agent 不同模型       | **只用两条模型线**：reasoning（Planner）vs default（其他所有人）                        |
| 每个 agent 不同 maxSteps  | **全局默认 25**，由框架层统一管理，不在 agent 定义中写死                                |
| Reviewer maxSteps 15      | **25**（Claude Code 不显式限制，靠模型判断）                                            |
| Planner 用 reasoning 模型 | **保留**（这是 Cabinet 的独特优势，Claude Code 没做）                                   |

---

## P0: 模型配置化 + Git 工具链 + Read-only Agent 工具集

### P0.0 模型配置化

新增 `apps/server/src/mastra/model-config.ts`：

```typescript
// 从用户 settings/api-keys 读取，返回 Mastra model 字符串
export function resolveModel(tier: 'default' | 'reasoning'): string {
  const { settingsRepo, apiKeyRepo } = getServerContext();
  const config = settingsRepo.getModelConfig();
  const keys = apiKeyRepo.findAll();
  const firstKey = keys[0];

  if (config?.provider) {
    return tier === 'reasoning'
      ? `${config.provider}/${config.reasoningModel ?? config.defaultModel}`
      : `${config.provider}/${config.defaultModel}`;
  }

  if (firstKey) {
    return `${firstKey.provider.toLowerCase()}/${config?.defaultModel ?? 'gpt-4'}`;
  }

  return 'openai/gpt-4o';
}
```

**所有 Agent 文件**移除 `model: 'deepseek/deepseek-chat'`。

调用时传参：

- `secretary.ts: agent.generate(input, { memory: { thread: { id: sid } } })` 用 default
- Planner 子 agent 调用时加 `{ model: resolveModel('reasoning') }`

### P0.1 Read-only Agent 工具集

> 对标 Claude Code：explorer / architect / reviewer 的工具集完全一致。

定义 `mastra/tools/index.ts` 中新增只读工具子集：

```
readOnlyTools = {
  readFile, listDirectory, grep, fileInfo,
  search, lspInspect,
  gitStatus, gitDiff, gitLog, gitShow, gitBlame,
}
```

**此工具集是以下所有分析类 agent 的统一基础**：Planner、Analyst、Reviewer、Researcher

### P0.2 Git 工具链

新建 `apps/server/src/mastra/tools/git.ts`，8 个工具：

| 工具 ID             | 功能                                                 |
| ------------------- | ---------------------------------------------------- |
| `gitStatus`         | `git status --porcelain`                             |
| `gitDiff`           | `git diff [path]`                                    |
| `gitDiffStaged`     | `git diff --staged`                                  |
| `gitLog`            | `git log --oneline -n`                               |
| `gitShow`           | `git show [commit]`                                  |
| `gitBranch`         | `git branch --list`                                  |
| `gitBlame`          | `git blame [file]`                                   |
| `gitCheckoutBranch` | `git checkout [branch]` / `git checkout -b [branch]` |

全部通过 `execSync` 调用，输出截断。gitDiff/gitLog/gitBlame 加入 `readOnlyTools`。

### P0.3 Plan Agent

新建 `apps/server/src/mastra/agents/specialist-planner.ts`：

```
new Agent({
  id: 'planner',
  name: 'Planner',
  description: 'Read-only codebase explorer and feature architect',
  tools: readOnlyTools,
  instructions: [
    SHARED_PROMPT,
    PLANNER_IDENTITY,
    'You are READ-ONLY. No file modifications, no command execution.',
    'Your job: trace code paths, analyze architecture, produce implementation plans.',
    'Output: file paths with line numbers, architecture insights, actionable blueprint.',
  ],
  defaultOptions: { maxSteps: 25 },
})
```

**对标**：Claude Code `code-explorer` + `code-architect` 合一（Claude Code 是两个 agent，我们合并为一个）

---

## P1: Reviewer Agent + 充实现有 Specialist

### P1.1 Reviewer Agent

新建 `apps/server/src/mastra/agents/specialist-reviewer.ts`：

```
new Agent({
  id: 'reviewer',
  name: 'Reviewer',
  description: 'Code review, bug detection, quality assessment',
  tools: readOnlyTools,
  instructions: [
    SHARED_PROMPT,
    REVIEWER_IDENTITY,
    'Focus: correctness, readability, performance, security.',
    'For each finding: file path, line number, severity, fix suggestion.',
    'Only report issues with high confidence. Ignore formatting (lint handles that).',
  ],
  defaultOptions: { maxSteps: 25 },
})
```

**对标**：Claude Code `code-reviewer`（confidence-based filtering，≥80 才报告）

### P1.2 充实现有 Specialist — 关键修正

> 对标 Claude Code 源码后的结论：所有分析 agent 共用同一套只读工具。差异化靠 instructions。

#### Analyst — 修改 `specialist-analyst.ts`

```
工具集：readOnlyTools
maxSteps: 25
变更：从空壳改为 readOnlyTools + 详细 prompt
作用：代码结构、数据流分析
```

#### Writer — 修改 `specialist-writer.ts`

```
工具集：{ ...readOnlyTools, writeFile }  // 唯一有写权限的 specialist
maxSteps: 25
变更：从空壳改为 readOnlyTools + writeFile + 详细 prompt
作用：文档、报告、README、代码注释
```

#### Researcher — 修改 `specialist-researcher.ts`

```
工具集：{ search, readFile, listDirectory, grep, gitLog, gitShow }
maxSteps: 25
变更：从空壳改为搜索专用工具 + 详细 prompt
作用：跨代码库/文档搜索、信息收集
注意：Researcher 不需要 lspInspect / gitDiff / gitBlame（不是分析型）
```

### P1.3 最终 Agent 体系一览

```
只读分析组（共用 readOnlyTools）
┌──────────┬───────────────────────┬────────┬──────────┐
│ Agent    │ 对标                  │ Model  │ maxSteps │
├──────────┼───────────────────────┼────────┼──────────┤
│ Planner  │ CC explorer+architect │ reason │ 25       │
│ Analyst  │ CC explorer           │ default│ 25       │
│ Reviewer │ CC code-reviewer      │ default│ 25       │
└──────────┴───────────────────────┴────────┴──────────┘

读写作组（各自不同）
┌──────────┬───────────────────────┬────────┬──────────┐
│ Agent    │ 对标                  │ Model  │ maxSteps │
├──────────┼───────────────────────┼────────┼──────────┤
│ Writer   │ CC 主 agent 的子集     │ default│ 25       │
│ Researcher│ CC WebSearch 特化     │ default│ 25       │
│ Tester   │ Cline Plan/Act        │ default│ 25       │
│ Secretary│ CC 主 agent            │ default│ 50       │
└──────────┴───────────────────────┴────────┴──────────┘
```

**核心设计决策**：

- **不用 Claude Code 的 3 个分开的 agent**（explorer/architect/reviewer）→ Cabinet 合为 Planner 一个，降低碎片化
- **maxSteps 全部 25**（除 Secretary 50）→ 对标 Claude Code 不显式限制步数的做法
- **只用两条模型线** → reasoning vs default，不引入 fast 层级（Claude Code 也没分三层）
- **readOnlyTools 是统一的** → 不是在每个 agent 里重复定义工具列表

---

## P2: Tester Agent + 模型分用

### P2.1 Tester Agent

新建 `apps/server/src/mastra/agents/specialist-tester.ts`：

```
new Agent({
  id: 'tester',
  name: 'Tester',
  description: 'Generate tests, run test suites, fix failing tests',
  tools: { ...readOnlyTools, writeFile, executeCommand },
  instructions: [
    SHARED_PROMPT,
    TESTER_IDENTITY,
    'Generate unit tests, integration tests, and fix failing tests.',
    'Run test suites with vitest/jest/pytest/etc.',
    'If tests fail, read the output and fix the source code.',
  ],
  defaultOptions: { maxSteps: 25 },
})
```

安全：executeCommand 受 Workspace `requireApproval: true` 保护。

### P2.2 模型分用（Architect/Editor 模式）

> Aider 的创新：推理模型规划 → 执行模型编码。Claude Code 没做（全用 sonnet）。

利用 Mastra 的 `model` 选项在 `generate()` 时动态切换：

```
Secretary → Planner   ：resolveModel('reasoning') — 推理模型，成本高但质量好
Secretary → Writer    ：resolveModel('default')    — 执行模型，成本低速度快
Secretary → Reviewer  ：resolveModel('default')    — 验证用标准模型即可
Secretary → Tester    ：resolveModel('default')    — 多轮迭代，速度优先
```

---

## 安全审视

```
executeCommand 保护链：
  ┌─ Workspace requireApproval: true           → 每次命令需用户确认
  └─ Secretary beforeToolCall hook             → 禁止 rm -rf / del /f
     （只保护 Secretary 自身）
     （子 agent 调用时由 Workspace 保护）

writeFile 保护链：
  ┌─ Secretary beforeToolCall hook             → 禁止写 .env/.secret/.master_key
  └─ Workspace 无额外限制

Permissions 对标：
   Cabinet: Workspace-level approval + Agent-level hooks
   Codex:   PermissionProfile (Managed = sandbox, Disabled = full access)
   CC:      Plugin-agent tool whitelist (Glob Grep LS Read ...)
```

---

## 验证清单

```
pnpm typecheck
pnpm lint
pnpm build
```

## 阶段概览

| 阶段     | 内容                                                  | 新建文件 | 修改文件 | 行数     |
| -------- | ----------------------------------------------------- | -------- | -------- | -------- |
| P0       | resolveModel + readOnlyTools + Git tools + Plan Agent | 4        | 5        | +350     |
| P1       | Reviewer + 充实 Analyst/Writer/Researcher             | 1        | 3        | +250     |
| P2       | Tester + 模型分用                                     | 1        | 2        | +150     |
| **合计** |                                                       | **6**    | **10**   | **+750** |
