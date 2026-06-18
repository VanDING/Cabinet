# Cabinet v3 (Rust) — 全量细节设计

> 版本：v0.1.0 完整稿
> 定位：聚焦 Coding Agent 场景的 Rust 重写
> 配套文档：`cabinet-v3-architecture-final.md`（架构层）
> 本文档定位：细节设计层——所有 18 个 crate 的完整类型定义、数据库 Schema、API 契约、配置 Schema、错误类型
> 设计原则：不写代码，只做设计。每个决策都有"为什么"和对标来源。
> 讨论日期：2026-06-12

---

## 文档关系

```
cabinet-v3-architecture-final.md     ← 架构层（crate 边界、模块职责、数据流伪代码）
cabinet-v3-detailed-design.md        ← 细节层（本文档——类型定义、DB Schema、API 签名、错误类型）
```

架构文档定义了"系统做什么"。本文档定义了"每个子系统怎么做"。两者共同构成实现前的完整规格。

---

## 目录

- [1. Foundation 层](#1-foundation-层)
  - [1.1 cabinet-base](#11-cabinet-base)
  - [1.2 cabinet-types](#12-cabinet-types)
  - [1.3 cabinet-exec-types](#13-cabinet-exec-types)
  - [1.4 cabinet-gateway-types](#14-cabinet-gateway-types)
  - [1.5 cabinet-storage](#15-cabinet-storage)
  - [1.6 cabinet-otel](#16-cabinet-otel)
  - [1.7 cabinet-codegraph](#17-cabinet-codegraph)
- [2. Engine 层](#2-engine-层)
  - [2.1 cabinet-exec](#21-cabinet-exec)
  - [2.2 cabinet-gateway](#22-cabinet-gateway)
  - [2.3 cabinet-sandbox](#23-cabinet-sandbox)
  - [2.4 cabinet-session](#24-cabinet-session)
  - [2.5 cabinet-tool](#25-cabinet-tool)
  - [2.6 cabinet-plugin](#26-cabinet-plugin)
- [3. Intelligence 层](#3-intelligence-层)
  - [3.1 cabinet-agent](#31-cabinet-agent)
  - [3.2 cabinet-skill](#32-cabinet-skill)
  - [3.3 cabinet-memory](#33-cabinet-memory)
- [4. Application 层](#4-application-层)
  - [4.1 cabinet-app-core](#41-cabinet-app-core)
- [5. Interface 层](#5-interface-层)
  - [5.1 cabinet-tui](#51-cabinet-tui)

---

# 1. Foundation 层

## 1.1 cabinet-base

整个 workspace 的"根"依赖。只做三件事：错误系统、配置系统、路径系统。

### 1.1.1 错误系统

#### 错误码分类法（5 位编码）

| 段       | 含义                  | 示例                    |
| -------- | --------------------- | ----------------------- |
| `AGENT`  | Agent 执行错误        | `AGENT_LOOP_MAX_TURNS`  |
| `TOOL`   | 工具执行错误          | `TOOL_TIMEOUT`          |
| `GW`     | Gateway/Provider 错误 | `GW_RATE_LIMIT`         |
| `EXEC`   | 命令执行错误          | `EXEC_POLICY_DENY`      |
| `SBOX`   | 沙箱错误              | `SBOX_CONTAINER_FAILED` |
| `CG`     | CodeGraph 错误        | `CG_PARSE_FAILED`       |
| `SESS`   | 会话错误              | `SESS_CORRUPT_EVENT`    |
| `MEM`    | 记忆系统错误          | `MEM_FTS5_QUERY_ERROR`  |
| `SKILL`  | Skill 系统错误        | `SKILL_PARSE_INVALID`   |
| `PLUG`   | 插件错误              | `PLUG_WASM_COMPILE`     |
| `CONFIG` | 配置错误              | `CONFIG_INVALID_TOML`   |
| `DB`     | 数据库错误            | `DB_MIGRATION_FAILED`   |
| `IO`     | 文件系统错误          | `IO_PERMISSION_DENIED`  |

#### 方案选择：trait-based（方案 A）

不选择单一 `CabinetError` enum（方案 B——破坏依赖方向），不选择 `thiserror` + `Box<dyn Error>`（方案 C——丢失结构化信息）。

```rust
pub trait CabinetError: std::error::Error + Send + Sync {
    fn code(&self) -> &'static str;           // "AGENT_001"
    fn severity(&self) -> ErrorSeverity;       // Fatal | Recoverable | Transient
    fn user_message(&self) -> String;
    fn retryable(&self) -> bool;
}

pub enum ErrorSeverity { Fatal, Recoverable, Transient }
```

暂不增加 `source()` 方法。`code()`、`severity()`、`retryable()` 和 `user_message()` 已构成完整的结构化错误信息。当未来出现具体的跨层调试需求时，再通过增强特定错误类型来支持。

#### 严重级别定义

| 级别          | 含义                     | 处理策略                               |
| ------------- | ------------------------ | -------------------------------------- |
| `Fatal`       | 不可恢复。需人工介入     | 数据库损坏、配置语法错误、沙箱无法启动 |
| `Recoverable` | 可通过重试/降级恢复      | 网络超时、速率限制、LLM 临时不可用     |
| `Transient`   | 自动恢复，不需要用户感知 | token 刷新、文件锁竞争、缓存未命中重算 |

对标：jcode 不区分严重级别；Codex CLI 有 3 级（Fatal/Retryable/UserVisible）；Claude Code 用 TypeScript Error 子类隐式区分。

#### 内置基础错误类型

| 错误类型             | 用途                                      | 被哪些 crate 使用                  |
| -------------------- | ----------------------------------------- | ---------------------------------- |
| `ConfigError`        | 配置加载/解析/迁移失败                    | 所有 crate 的 config 构造          |
| `IoError`            | 文件读写失败（带路径上下文）              | storage, codegraph, skill, session |
| `SerializationError` | serde 序列化/反序列化失败                 | 所有持久化层                       |
| `TimeoutError`       | 操作超时（带 duration 和 operation name） | gateway, exec, sandbox             |

### 1.1.2 配置系统

#### 完整配置 Schema

`~/.cabinet/config.toml` 的每一个键、类型、默认值、验证规则：

**`[general]` 节：**

| 键                          | 类型   | 默认值                | 验证                                 | 说明                                     |
| --------------------------- | ------ | --------------------- | ------------------------------------ | ---------------------------------------- |
| `default_model`             | string | `"claude-sonnet-4-6"` | 必须在某个 provider 的 models 列表中 |                                          |
| `default_provider`          | string | `"anthropic"`         | 必须匹配一个已配置 provider 的 name  |                                          |
| `max_turns_per_session`     | u32    | 100                   | 1..500                               | 防止无限循环                             |
| `plan_mode_default`         | bool   | true                  | —                                    | 新会话默认是否进入 Plan Mode             |
| `project_max_context_bytes` | u64    | 1_048_576             | 0..10_485_760                        | 注入 project context 的最大字节数（1MB） |
| `skill_max_injected`        | u32    | 20                    | 1..200                               | 注入 prompt 的 Skill L1 索引最大数量     |
| `sandbox_provider`          | string | `"docker"`            | "docker" / "bubblewrap" / "local"    |                                          |

**`[agent]` 节：**

| 键                             | 类型   | 默认值               | 说明                                   |
| ------------------------------ | ------ | -------------------- | -------------------------------------- |
| `temperature`                  | f64    | 0.0                  | 0.0..2.0                               |
| `max_tokens_per_turn`          | u32    | 32000                | 单 turn 最大输出 token                 |
| `thinking_budget_tokens`       | u32    | 16000                | extended thinking 预算（仅 Anthropic） |
| `compact_at_utilization`       | f64    | 0.75                 | token 利用率阈值，触发压缩             |
| `evaluator_enabled`            | bool   | true                 | 是否启用 LLM 输出评分                  |
| `evaluator_model`              | string | `"claude-haiku-4-5"` | 评分使用的小模型                       |
| `auto_adjust_enabled`          | bool   | true                 | 是否启用自动调参                       |
| `auto_adjust_cooldown_minutes` | u32    | 30                   | 调整冷却时间                           |

**`[sandbox]` 节：**

| 键                       | 类型   | 默认值                     | 说明                        |
| ------------------------ | ------ | -------------------------- | --------------------------- |
| `docker_image`           | string | `"cabinet-sandbox:latest"` | Docker 沙箱镜像             |
| `docker_timeout_seconds` | u32    | 300                        | 单命令超时                  |
| `bwrap_enable_network`   | bool   | false                      | Bubblewrap 是否允许网络     |
| `workspace_mount`        | string | `"~/.cabinet/sandbox"`     | 工作区挂载根目录            |
| `cleanup_on_exit`        | bool   | true                       | 退出时是否清理容器/临时文件 |

**`[memory]` 节：**

| 键                          | 类型   | 默认值               | 说明                    |
| --------------------------- | ------ | -------------------- | ----------------------- |
| `short_term_capacity`       | u32    | 1000                 | 短期记忆容量            |
| `short_term_ttl_minutes`    | u32    | 30                   | 短期记忆 TTL            |
| `long_term_max_entries`     | u32    | 500000               | 长期记忆上限            |
| `cascade_min_count`         | u32    | 3                    | 级联缓冲区封存最小计数  |
| `cascade_max_age_minutes`   | u32    | 30                   | 级联缓冲区封存最大等待  |
| `sideagent_enabled`         | bool   | true                 | 是否启用 Sideagent 验证 |
| `sideagent_model`           | string | `"claude-haiku-4-5"` | Sideagent 模型          |
| `auto_nudge_after_turns`    | u32    | 20                   | 自主提示间隔            |
| `auto_nudge_decision_turns` | u32    | 10                   | 决策事件后提示间隔      |
| `confidence_threshold`      | f64    | 0.7                  | 记忆置信度最低阈值      |

**`[permissions]` 节：**

| 键                             | 类型 | 默认值 | 说明                           |
| ------------------------------ | ---- | ------ | ------------------------------ |
| `auto_approve_readonly`        | bool | true   | 只读工具自动批准               |
| `auto_approve_cargo_test`      | bool | true   | cargo test 自动批准            |
| `auto_approve_git_status`      | bool | true   | git status/diff/log 自动批准   |
| `require_approval_for_network` | bool | true   | 网络请求需要审批               |
| `save_decisions`               | bool | true   | 是否持久化 "AllowAndSave" 决策 |

**`[telemetry]` 节：**

| 键                               | 类型    | 默认值   | 说明                                          |
| -------------------------------- | ------- | -------- | --------------------------------------------- |
| `enabled`                        | bool    | true     | 仅本地文件，不发送外部                        |
| `log_level`                      | string  | `"info"` | "trace" / "debug" / "info" / "warn" / "error" |
| `otlp_endpoint`                  | string? | null     | 外部 OTLP 端点                                |
| `record_prompt_content`          | bool    | false    | 隐私优先                                      |
| `record_tool_args`               | bool    | false    | 隐私优先                                      |
| `record_file_location`           | bool    | true     | 默认记录源文件位置（非敏感）                  |
| `export_perfetto_on_session_end` | bool    | false    | 会话结束自动导出 Perfetto trace               |

**`[codegraph]` 节：**

| 键                    | 类型     | 默认值                                                      | 说明                        |
| --------------------- | -------- | ----------------------------------------------------------- | --------------------------- |
| `auto_index`          | bool     | true                                                        | 打开项目时自动索引          |
| `watch_enabled`       | bool     | true                                                        | 是否启用文件监控            |
| `watch_debounce_ms`   | u64      | 2000                                                        | 文件变更去抖时间            |
| `max_file_size_bytes` | u64      | 1_048_576                                                   | 跳过超过此大小的文件（1MB） |
| `exclude_patterns`    | string[] | `["node_modules", "target", "dist", ".git", "__pycache__"]` | 排除目录                    |
| `trace_max_depth`     | u8       | 5                                                           | trace() BFS 最大深度        |
| `trace_max_results`   | u32      | 100                                                         | trace() 最多返回路径数      |

#### 配置版本迁移

```
ConfigV1 → ConfigV2 → ConfigV3（当前）
```

每个版本有对应的 `ConfigV{N}` struct + `From<ConfigV{N-1}> for ConfigV{N}` 实现。

迁移规则：

- 新增字段 → 提供默认值
- 重命名字段 → 从旧字段名读取，写入新字段名
- 废弃字段 → 忽略，不报错（向前兼容）
- 删除字段 → 如果旧版本有、新版本没有，忽略（不阻塞启动）

#### 项目级配置覆盖

`{project}/.cabinet/config.toml` 可以覆盖**部分**全局配置。采用深度合并——项目级只需写入变更项。

| 可覆盖                       | 不可覆盖                              |
| ---------------------------- | ------------------------------------- |
| `default_model`              | `sandbox.*`（安全边界不可项目覆盖）   |
| `plan_mode_default`          | `telemetry.*`（隐私配置不可项目覆盖） |
| `agent.temperature`          | `permissions.*`（安全边界）           |
| `agent.max_tokens_per_turn`  | `general.sandbox_provider`            |
| `memory.*`（全部）           | `codegraph.*`（项目级别自动适配）     |
| `codegraph.exclude_patterns` | `general.*` 中的路径配置              |

#### 配置热加载

`cabinet-base` 只负责一次性加载。热加载（通过文件 mtime 监控和重载）由 `cabinet-app-core` 处理——headless 模式不需要热加载。

### 1.1.3 路径系统

#### 完整目录结构

```
~/.cabinet/
├── config.toml              # 全局配置
├── execpolicy.toml          # ExecPolicy 规则
├── permissions.toml         # 持久化权限决策
├── plugin_policy.toml       # Plugin WASM 安全策略
├── db/
│   └── cabinet.db           # 业务数据库 (SQLite)
├── skills/                  # 全局 Skill
│   └── {skill-name}/
│       ├── SKILL.md
│       ├── references/
│       └── scripts/
├── plugins/                 # 已安装插件
│   └── {plugin-name}/
│       ├── plugin.toml
│       ├── plugin.wasm      # (可选)
│       └── mcp.json         # (可选)
├── sandbox/                 # 沙箱运行时目录
│   └── {sandbox-id}/
│       ├── workspace/
│       └── outputs/
├── sessions/                # 会话持久化（事件流 + snapshot）
│   └── {session-id}/
│       ├── events.jsonl
│       └── snapshots/
├── logs/                    # 日志文件
│   └── cabinet-{date}.log
├── traces/                  # Perfetto trace 导出
│   └── {session-id}-{timestamp}.json
└── backups/                 # 数据库备份
    └── cabinet-{timestamp}.db
```

#### 项目本地路径

```
{project}/.cabinet/
├── config.toml              # 项目级配置覆盖
├── codegraph.db             # CodeGraph 索引（可删除重建）
├── skills/                  # 项目级 Skill
│   └── {skill-name}/
│       ├── SKILL.md
│       ├── references/
│       └── scripts/
└── rules/                   # 项目规则文件（注入 ProjectContext）
    ├── CLAUDE.md
    ├── CABINET.md
    └── *.md
```

#### 路径创建时机和所有权

| 路径                              | 创建时机             | 创建者                              | 删除时机                             |
| --------------------------------- | -------------------- | ----------------------------------- | ------------------------------------ |
| `~/.cabinet/`                     | 首次启动             | `cabinet-base::Paths::ensure()`     | 用户手动                             |
| `~/.cabinet/config.toml`          | 首次启动（写默认值） | Config loader                       | 用户手动                             |
| `~/.cabinet/db/cabinet.db`        | 首次需要持久化时     | `cabinet-storage::Database::open()` | 用户手动                             |
| `~/.cabinet/sandbox/{id}/`        | 每次沙箱会话启动     | `cabinet-sandbox`                   | 会话结束 + cleanup_on_exit           |
| `~/.cabinet/sessions/{id}/`       | 每次新会话           | `cabinet-session`                   | 用户手动 `/clear` 或归档             |
| `~/.cabinet/logs/`                | 首次启动             | `cabinet-otel`                      | 日志轮转策略（保留 30 天）           |
| `{project}/.cabinet/codegraph.db` | 首次进入项目         | `cabinet-codegraph`                 | 用户手动 `cabinet codegraph reindex` |

---

## 1.2 cabinet-types

共享类型 crate——所有 trait 定义在此。零依赖（连 `cabinet-base` 都不依赖），允许的依赖仅 `serde` + `std`。

### 1.2.1 agent 模块

#### AgentConfig

```
AgentConfig:
  mode: AgentMode                      // PlanMode | BuildMode
  max_turns: u32                       // 单次运行最大 turn 数（默认 100）
  temperature: f64                     // 0.0..2.0
  max_tokens_per_turn: u32            // 单 turn 最大输出 token
  thinking_budget_tokens: u32         // extended thinking 预算
  compact_at_utilization: f64         // token 利用率压缩阈值
  plan_mode_default: bool             // 新会话默认 Plan Mode
  evaluator_enabled: bool             // Harness 开关
  auto_adjust_enabled: bool
```

#### AgentMode

```
AgentMode:
  | PlanMode    // 只读工具集，生成计划
  | BuildMode   // 全工具集，按计划执行
```

#### PlanStep

```
PlanStep:
  id: String                           // 唯一标识
  description: String                  // ≤ 200 chars
  files_to_touch: Vec<String>          // 预期修改的文件列表
  tools_needed: Vec<String>            // 需要的工具名
  depends_on: Vec<String>              // 依赖的前置 step id
  status: PlanStepStatus               // Pending | InProgress | Completed | Skipped | Failed
  verification: Option<String>         // 如何验证此步完成
```

#### ActivePlan

```
ActivePlan:
  id: String
  title: String                        // ≤ 80 chars
  steps: Vec<PlanStep>
  created_at: DateTime
  approved_at: Option<DateTime>
  total_steps: u32
  completed_steps: u32
```

#### AgentEvent — Observer 间内存通信（区别于 SessionEvent）

```
AgentEvent:
  | UserInputReceived { content, delivery }
  | TurnStarted { turn_id }
  | LlmResponseReceived { turn_id, content, tool_calls, usage }
  | ToolCallStarted { turn_id, call_id, tool_name }
  | ToolCallCompleted { turn_id, call_id, result, duration_ms }
  | TurnCompleted { turn_id }
  | CompactionTriggered { utilization, messages_before }
  | CompactionCompleted { messages_after, tokens_saved }
  | PlanSubmitted { plan }
  | PlanApproved { plan_id }
  | PlanRejected { plan_id, reason }
  | PlanStepCompleted { step_id }
  | Error { source, message, severity }
  | Interrupted { source }
  | SessionEnding
```

区分：`SessionEvent` 持久化到事件流（完整上下文），`AgentEvent` 是运行时轻量事件（不持久化）。

#### AgentObserver trait

```rust
trait AgentObserver: Send + Sync:
  name() -> &'static str
  priority() -> u8
  on_user_input(&self, content: &str) -> Result<()>
  on_turn_start(&self, turn_id: &TurnId) -> Result<()>
  on_llm_response(&self, turn_id, response) -> Result<()>
  on_tool_call_start(&self, turn_id, call_id, tool_name, args) -> Result<()>
  on_tool_call_result(&self, turn_id, call_id, result, duration_ms) -> Result<()>
  on_turn_end(&self, turn_id) -> Result<()>
  on_compaction(&self, report: &CompactionReport) -> Result<()>
  on_plan_event(&self, event: &PlanEvent) -> Result<()>
  on_error(&self, error: &AgentEvent::Error) -> Result<()>
  on_session_end(&self) -> Result<()>
  requires_before() -> Vec<&'static str>
  requires_after() -> Vec<&'static str>
```

#### AgentType — 对标 Claude Code 的 6 种内置 Agent

```
AgentType:
  | Build                                    // 主 Agent——全工具集。用户直接对话
  | Plan                                     // Plan Mode——只读。代码探索和分析
  | Explore                                  // 代码库探索子代理 (task spawn)
  | Verify                                   // 结果验证子代理 (task spawn)
  | GeneralPurpose                           // 通用子代理 (task spawn)。可 bash，不可写文件
```

|                | Build         | Plan           | Explore                                    | Verify                    | GeneralPurpose                                         |
| -------------- | ------------- | -------------- | ------------------------------------------ | ------------------------- | ------------------------------------------------------ |
| **触发者**     | 用户直接对话  | Plan Mode 自动 | Agent 调用 task                            | Agent 调用 task           | Agent 调用 task                                        |
| **工具集**     | 全部 20 个    | 只读（~8 个）  | codegraph\_\*(6) + read_file + glob + grep | read*file + grep + web*\* | codegraph*\* + read_file + glob + grep + web*\* + bash |
| **可写文件**   | ✅            | ❌             | ❌                                         | ❌                        | ❌                                                     |
| **可 bash**    | ✅            | ❌             | ❌                                         | ❌                        | ✅                                                     |
| **可 spawn**   | ✅ (task)     | ❌             | ❌                                         | ❌                        | ❌                                                     |
| **系统提示词** | build_mode.md | plan_mode.md   | explore.md                                 | verify.md                 | general_purpose.md                                     |
| **max_turns**  | 100           | 30             | 10                                         | 5                         | 10                                                     |
| **超时**       | 无            | 无             | 15 min                                     | 5 min                     | 15 min                                                 |
| **Harness**    | ✅            | ❌             | ❌                                         | ❌                        | ❌                                                     |

### 1.2.2 tool 模块

#### ToolDefinition

```
ToolDefinition:
  name: String                           // 唯一标识，snake_case
  description: String                    // ≤ 200 chars
  parameters: JsonSchema
  category: ToolCategory
  is_concurrency_safe: bool             // 运行时属性——handler 可在执行前覆盖
  requires_approval: Option<ApprovalReason>
  source: ToolSource                    // Builtin | Skill | Plugin | MCP
  feature_gate: Option<String>          // Cargo feature name，编译时控制可用性
  disallowed_for: Vec<AgentType>        // 禁止某些 Agent 类型使用
```

#### ToolCategory

```
ToolCategory:
  | ReadOnly         // 不修改文件系统、不执行命令、不发送网络请求
  | LightWrite       // 文件编辑（write_file, edit_file, apply_patch），有锁保护
  | Exec             // 执行命令（bash），必须通过沙箱
  | Destructive      // 破坏性操作（rm, 数据库 drop, 强制 push）
  | Costly           // 有成本的操作（LLM 调用、网络请求、外部 API）
```

#### ToolResultContent（精简为 3 个 variant）

```
ToolResultContent:
  | Text { content: String, mime_type: Option<String> }
  | Diff { hunks: Vec<DiffHunk> }
  | Error { message: String, code: Option<String> }
```

mime_type 取值：`"text/plain"` / `"text/markdown"` / `"application/json"` / `"text/x-search-results"` / `"text/x-codegraph"` / `"text/x-file-content"`。

TUI 的内容解析是 TUI 的职责，不是 types 的职责。Diff 保留独立 variant——Coding Agent 的核心输出是代码变更。

#### ToolResult

```
ToolResult:
  content: ToolResultContent
  tool_name: String
  call_id: String
  duration_ms: u64
  is_error: bool
```

#### ToolHandler trait

```rust
trait ToolHandler: Send + Sync:
  execute(&self, args: JsonValue, context: &ToolContext) -> Result<ToolResult>
  definition(&self) -> &ToolDefinition
  check_concurrency_safety(&self, args: &JsonValue) -> bool
```

#### ToolContext

```
ToolContext:
  session_id: SessionId
  turn_id: TurnId
  sandbox: Arc<dyn SandboxProvider>
  codegraph: Arc<CodeGraphIndex>
  working_dir: PathBuf
  agent_type: AgentType
```

### 1.2.3 session 模块

#### SessionEvent — 完整 15 variant

```
SessionEvent:
  | Created {
      id: SessionId, project_path: PathBuf, model: String,
      codegraph_indexed: bool, agent_config_snapshot: AgentConfig, timestamp: DateTime
    }
  | PromptSubmitted {
      msg_id: String, content: String, delivery: MessageDelivery, timestamp: DateTime
    }
  | TurnStarted { turn_id: TurnId, turn_number: u32, timestamp: DateTime }
  | ModelResponded {
      turn_id: TurnId, content: Option<String>, tool_calls: Vec<ToolCallRequest>,
      usage: TokenUsage, model: String, finish_reason: String, timestamp: DateTime
    }
  | ToolExecuted {
      turn_id: TurnId, call_id: String, name: String,
      args: JsonValue, result: ToolResult, duration_ms: u64, timestamp: DateTime
    }
  | TurnCompleted { turn_id: TurnId, timestamp: DateTime }
  | CompactionHappened {
      messages_before: u32, messages_after: u32, tokens_before: u64,
      tokens_after: u64, summary_generated: bool, compressed_range: (usize, usize), timestamp: DateTime
    }
  | PlanApproved { plan_id: String, title: String, steps_count: u32, steps: Vec<PlanStep>, timestamp: DateTime }
  | PlanRejected { plan_id: String, reason: Option<String>, timestamp: DateTime }
  | PlanStepCompleted { plan_id: String, step_id: String, timestamp: DateTime }
  | ModelSwitched { from: String, to: String, reason: ModelSwitchReason, timestamp: DateTime }
  | TitleChanged { title: String, generated_by: TitleSource, timestamp: DateTime }
  | Interrupted { source: InterruptSource, during_turn: Option<TurnId>, timestamp: DateTime }
  | Resumed { from_event_index: usize, timestamp: DateTime }
```

#### SessionState

```
SessionState:
  session_id: SessionId
  messages: Vec<Message>
  turn_count: u32
  current_turn: Option<TurnId>
  total_usage: TokenUsage
  title: Option<String>
  model: String
  plan: Option<ActivePlan>
  status: SessionStatus              // Active | Idle | Interrupted | Completed | Abandoned
  last_event_index: usize
  created_at: DateTime
  project_path: PathBuf
```

#### Projector trait

```rust
trait Projector:
  apply(&mut self, event: &SessionEvent) -> Result<()>
  snapshot(&self) -> SessionState
  restore(&mut self, snapshot: SessionState) -> Result<()>
  replay(&mut self, events: &[SessionEvent], up_to: Option<usize>) -> Result<()>
```

### 1.2.4 memory 模块

#### MemoryEntry

```
MemoryEntry:
  id: String
  content: String
  category: MemoryCategory          // UserPreference | ProjectFact | Decision | Pattern | Feedback | TechnicalNote
  confidence: f64                   // 0.0..1.0
  source: MemorySource
  project_path: Option<PathBuf>
  importance: f64                   // 0.0..1.0
  access_count: u32
  created_at: DateTime
  last_accessed_at: Option<DateTime>
  expires_at: Option<DateTime>
  tags: Vec<String>
```

#### WriteGateTier

```
WriteGateTier:
  | Working           // 当前会话相关的临时信息
  | Register          // 跨会话有价值的具体事实/决定
  | Daily             // 每日会话摘要
  | TransientNoise    // 瞬时噪音——不升级到长期记忆
  | StructuredPrefix  // 系统生成的格式信息
```

升级决策：Working + Register + StructuredPrefix → 级联到 LongTermMemory。Daily 保留 30 天。TransientNoise 直接丢弃。

#### VerifiedMemory

```
VerifiedMemory:
  entry: MemoryEntry
  relevance_score: f64              // Sideagent 相关性评分 0.0..1.0
  verification_timestamp: DateTime
```

### 1.2.5 skill 模块

#### SkillMetadata（完整版）

```
SkillMetadata:
  name: String                        // kebab-case，唯一标识
  description: String                 // ≤ 60 chars
  kind: SkillKind                     // Prompt | Tool | Composite | Workflow
  created_by: Author                  // User | Agent | Community
  scope: SkillScope                   // Builtin | Global | Project | Plugin
  version: u32
  status: SkillStatus                 // Active | Stale | Archived | Superseded
  pinned: bool
  allowed_tools: Option<Vec<String>>  // 工具白名单（来自 DeerFlow）
  requires_tools: Option<Vec<String>> // 条件显示——工具不可用时隐藏（来自 Hermes）
  fallback_for_tools: Option<Vec<String>>  // 条件隐藏——工具可用时隐藏（来自 Hermes）
  last_used: Option<DateTime>
  usage_count: u32
  created_at: DateTime
  updated_at: DateTime
  source_path: PathBuf                // SKILL.md 文件路径
  body_hash: String                   // SHA256，用于变更检测
  tags: Vec<String>
```

#### Skill 状态转换

```
Active ──(30d unused)──→ Stale ──(90d unused)──→ Archived
  ↑                         │                        │
  └───(reused)──────────────┘                        │
Active ──(覆盖)──→ Superseded ──(覆盖者卸载)──→ Active
```

#### SkillScope

```
SkillScope:
  | Builtin        // 编译时嵌入（最低优先级）
  | Global         // ~/.cabinet/skills/
  | Project        // {project}/.cabinet/skills/  （覆盖 Global）
  | Plugin         // 插件注册（覆盖所有，卸载时移除）
```

### 1.2.6 codegraph 模块

#### Symbol

```
Symbol:
  id: String
  name: String                        // 符号名
  kind: SymbolKind                    // Function | Method | Class | Interface | Type | Variable | ...
  file_path: PathBuf
  line_start: u32, line_end: u32
  column_start: u32, column_end: u32
  language: String
  docstring: Option<String>
  is_exported: bool
  parent_symbol: Option<String>
  signature: String
```

#### CallSite

```
CallSite:
  caller_symbol: String
  callee_symbol: String
  file_path: PathBuf
  line: u32, column: u32
  call_type: CallType                // Direct | MethodCall | DynamicDispatch | AsyncAwait | Callback
```

#### ExploreResult — Agent 最常用入口

```
ExploreResult:
  symbols: Vec<Symbol>
  related_files: Vec<PathBuf>
  caller_count: u32
  callee_count: u32
  framework_hints: Vec<String>
  suggested_next_queries: Vec<String>
```

一次调用替代多次 grep/read/ls 操作。

#### TraceResult

```
TraceResult:
  paths: Vec<CallPath>               // 每条路径是一串 CallSite
  total_paths_found: u32
  search_depth: u8
  truncated: bool
```

#### ImpactResult

```
ImpactResult:
  symbol: String
  direct_callers: Vec<CallSite>
  transitive_callers: u32
  affected_files: Vec<PathBuf>
  affected_tests: Vec<String>
  risk_level: ImpactRisk            // Low | Medium | High
```

#### IndexStatus

```
IndexStatus:
  total_files: u32
  indexed_files: u32
  total_symbols: u32
  total_edges: u32
  languages: Vec<LanguageStats>
  last_indexed_at: Option<DateTime>
  is_watching: bool
  pending_changes: u32
```

### 1.2.7 permission 模块

#### PermissionRule

```
PermissionRule:
  id: String
  action: PermissionAction
  resource: WildcardPattern
  effect: PermissionEffect           // Allow | Deny | AskUser
  scope: PermissionScope             // Session | Persistent
  reason: String
  priority: u32
  created_by: PermissionSource       // UserSaved | SystemDefault | Learned
```

#### PermissionOption（审批弹窗选项）

```
PermissionOption:
  | AllowOnce       // 仅本次
  | AllowAll        // 本次会话内始终允许
  | AllowAndSave    // 保存到 ~/.cabinet/permissions.toml 永不过期
  | Deny
```

#### PermissionMode（全局授权模式 — 对标 Claude Code + v2 DelegationTier）

```
PermissionMode:
  | Safe            // 默认。只读自动。写/bash 审批。破坏性拒绝
  | Plan            // Plan 审批后自动进入。计划内自动。计划外审批
  | Trusted         // 除破坏性外全部自动。计划外自动批准
  | Everything      // 除破坏性外全部自动。需二次确认进入
```

| 模式       | 只读工具 | 计划内写/bash | 计划外操作 | 破坏性操作 |
| ---------- | -------- | ------------- | ---------- | ---------- |
| Safe       | 自动     | 审批          | 审批       | **拒绝**   |
| Plan       | 自动     | 自动          | 审批       | 审批       |
| Trusted    | 自动     | 自动          | 自动       | 审批       |
| Everything | 自动     | 自动          | 自动       | **审批**   |

切换: `/mode [safe|plan|trusted|everything]`。Safe→Everything 需二次确认。Plan 模式由 PlanApproved 事件自动触发。

### 1.2.8 sandbox 模块

#### SandboxConfig

```
SandboxConfig:
  provider: SandboxProviderType        // Docker | Bubblewrap | Local
  docker_image: String
  docker_timeout_seconds: u32
  bwrap_enable_network: bool
  workspace_mount: PathBuf
  cleanup_on_exit: bool
```

#### SandboxProvider trait（定义在 types，实现在 cabinet-sandbox）

```rust
trait SandboxProvider: Send + Sync:
  execute(&self, cmd: &ShellCommand) -> Result<ExecOutput>
  read_file(&self, path: &Path) -> Result<String>
  write_file(&self, path: &Path, content: &str) -> Result<()>
  list_dir(&self, path: &Path) -> Result<Vec<DirEntry>>
  file_info(&self, path: &Path) -> Result<FileInfo>
  glob(&self, pattern: &str) -> Result<Vec<PathBuf>>
  grep(&self, pattern: &str, path: &Path) -> Result<Vec<GrepMatch>>
  resolve_path(&self, virtual_path: &Path) -> PathBuf
  network_enabled(&self) -> bool
  set_network_enabled(&self, enabled: bool) -> Result<()>
  cleanup(&self) -> Result<()>
  provider_name() -> &'static str
  isolation_level() -> IsolationLevel
```

#### PathMapping

```
PathMapping:
  virtual_path: PathBuf                // Agent 看到的路径
  physical_path: PathBuf               // 宿主机真实路径
  access: PathAccess                   // ReadOnly | ReadWrite
```

---

## 1.3 cabinet-exec-types

约 150 行。独立 crate——可能被 CI/CD 脚本或外部工具单独依赖。

#### ShellCommand — 类型安全的命令构造

```
ShellCommand:
  program: String                      // 可执行程序名（"git", "cargo", "python"）
  args: Vec<String>                    // 参数列表，不包含 program 本身
  working_dir: Option<PathBuf>
  env: Vec<(String, String)>
  timeout: Option<Duration>
  stdin: Option<String>
  label: Option<String>               // 面向用户的描述标签
```

构造后不可变——保证审批时看到的命令和执行时的命令完全一致。沙箱接收已解析的 `(program, args[])` 元组，不经过 shell 解析（对比 Claude Code 的裸字符串拼接）。

#### ExecPolicy — 声明式策略引擎

```
ExecPolicy:
  version: u32
  rules: Vec<ExecRule>                // 按 priority 降序，首次匹配即停止
  default_effect: ExecEffect          // 无规则匹配时的默认行为（Allow）
```

**匹配算法：** 按 priority 从高到低遍历，找到第一个 pattern 匹配的规则 → 返回对应的 effect。首次匹配而非收集所有匹配——安全策略必须可预测。

```
ExecRule:
  pattern: ExecPattern                // Exact | Prefix | Glob | Program
  effect: ExecEffect                  // Allow | Deny | AskUser
  reason: String
  priority: u32
  source: ExecRuleSource              // Builtin | UserCustom
```

#### 内置默认规则表

| Pattern                                    | Effect  | Priority | Reason                  |
| ------------------------------------------ | ------- | -------- | ----------------------- |
| Program("rm") + Prefix(["rm", "-rf", "/"]) | Deny    | 1000     | 禁止递归删除根目录      |
| Program("dd")                              | Deny    | 1000     | 禁止直接磁盘操作        |
| Program("mkfs")                            | Deny    | 1000     | 禁止格式化文件系统      |
| Exact("git push --force")                  | AskUser | 500      | 强制推送需要确认        |
| Prefix(["cargo", "publish"])               | AskUser | 500      | 发布到 crates.io 需确认 |
| Prefix(["npm", "publish"])                 | AskUser | 500      | 发布到 npm 需确认       |
| Program("curl")                            | AskUser | 300      | 网络下载需要确认        |
| Prefix(["git", "push"])                    | Allow   | 200      | 普通推送允许            |
| Prefix(["cargo", "build"])                 | Allow   | 200      | 构建允许                |
| Prefix(["cargo", "test"])                  | Allow   | 200      | 测试允许                |
| Prefix(["git", "status"])                  | Allow   | 100      | 状态查看允许            |
| Glob("\*")                                 | Allow   | 0        | 默认允许所有其他命令    |

底层策略是"5 层安全"。ExecPolicy 只是第 2 层。第 1 层沙箱已提供容器隔离——即使默认允许 `rm -rf /`，沙箱内的 `/` 也不是真实根目录。对标 Codex CLI 的 Default Allow + Sandbox 策略。

#### ExecOutput

```
ExecOutput:
  stdout: String
  stderr: String
  exit_code: i32
  duration_ms: u64
  timed_out: bool
  truncated: bool
  truncated_at_bytes: Option<u64>
```

stdout/stderr 截断策略：超过 100KB 时 `truncated = true`。

---

## 1.4 cabinet-gateway-types

约 150 行。Provider 开发者只需依赖此 crate。

#### ProviderConfig

```
ProviderConfig:
  name: String                        // "anthropic" | "openai" | "openrouter"
  display_name: String
  api_key_env: String                 // 环境变量名，不是密钥值
  base_url: Option<String>            // 自定义端点
  default_model: String
  models: Vec<ModelInfo>
  extra_headers: Vec<(String, String)>
  extra_body: Option<JsonValue>
  rate_limit: Option<RateLimitConfig>
  timeout_seconds: u32                // 默认 120
  max_retries: u32                    // 默认 3
  retry_backoff_base_ms: u64          // 默认 1000
  retry_backoff_max_ms: u64           // 默认 30000
  features: ProviderFeatures
```

#### ProviderFeatures

```
ProviderFeatures:
  supports_streaming: bool            // 默认 true
  supports_thinking: bool             // extended thinking / reasoning
  supports_vision: bool               // 图片输入
  supports_prompt_caching: bool       // cache_control / prefix caching
  supports_tool_use: bool             // parallel tool calls
  supports_json_mode: bool            // response_format: json_object
  max_context_tokens: u64
  max_output_tokens: u64
```

#### ModelInfo

```
ModelInfo:
  name: String                        // "claude-sonnet-4-6"
  display_name: String
  provider: String
  context_length: u64
  max_output_tokens: u64
  supports_thinking: bool
  supports_vision: bool
  supports_prompt_caching: bool
  pricing: ModelPricing               // 每百万 token 定价
  tags: Vec<String>                   // "fast", "reasoning", "coding", "cheap"
```

#### ModelRequest

```
ModelRequest:
  model: String
  system_prompt: String
  messages: Vec<Message>
  tools: Vec<ToolDefinition>
  temperature: f64
  max_tokens: u32
  thinking_budget_tokens: Option<u32>
  stop_sequences: Vec<String>
  stream: bool
  extra_body: Option<JsonValue>       // Provider 特定参数
  cache_control_positions: Vec<usize> // 由 Gateway 自动设置
```

#### Message

```
Message:
  role: MessageRole                    // System | User | Assistant | Tool
  content: MessageContent
  id: Option<String>

MessageContent:
  | Text(String)
  | ToolCalls(Vec<ToolCallChunk>)
  | ToolResult { call_id: String, result: String }
  | MultiContent(Vec<ContentBlock>)    // 多模态（text + image + tool_call）

ContentBlock:
  | TextBlock { text: String }
  | ImageBlock { base64: String, media_type: String }
  | ToolUseBlock { id: String, name: String, input: JsonValue }
  | ToolResultBlock { tool_use_id: String, content: String }
  | ThinkingBlock { thinking: String, signature: String }
```

#### ModelResponse

```
ModelResponse:
  content: Vec<ContentBlock>
  tool_calls: Vec<ToolCallRequest>
  usage: TokenUsage
  finish_reason: String
  model: String
  id: String
```

#### TokenUsage

```
TokenUsage:
  prompt_tokens: u64
  completion_tokens: u64
  cache_read_tokens: u64
  cache_write_tokens: u64
  thinking_tokens: Option<u64>        // 仅 Anthropic/支持 reasoning 的模型
```

#### StreamChunk

```
StreamChunk:
  | Text { content: String }
  | Thinking { content: String }
  | ThinkingDone
  | ToolCallStart { id: String, name: String }
  | ToolCallDelta { id: String, args_json: String }
  | ToolCallEnd { id: String }
  | Done { usage: TokenUsage, finish_reason: String }
  | Error { message: String, retryable: bool }
```

---

## 1.5 cabinet-storage

SQLite 持久化——连接管理、迁移、Repository 层、备份。

### 1.5.1 双数据库架构

|          | `cabinet.db`（全局）                 | `codegraph.db`（项目本地）        |
| -------- | ------------------------------------ | --------------------------------- |
| 位置     | `~/.cabinet/db/cabinet.db`           | `{project}/.cabinet/codegraph.db` |
| 生命周期 | 与 Cabinet 安装同寿                  | 与项目同寿，可删除重建            |
| 数据     | 会话、记忆、Skill 元数据、权限、成本 | 符号图、边、FTS5 索引             |
| 迁移策略 | 顺序迁移，不可逆                     | 无迁移——重建比迁移更快            |
| WAL 模式 | ✅                                   | ✅                                |
| 备份     | ✅ 自动备份                          | ❌ 不备份——可从源码重建           |
| 并发访问 | 单进程                               | 单进程                            |

两个独立数据库的理由：(1) 重建成本不对等 (2) 备份策略不同 (3) 项目切换时只需关闭/打开 codegraph.db (4) codegraph.db 放在项目目录下。

### 1.5.2 cabinet.db Schema DDL

#### session_events（事件溯源核心）

```sql
CREATE TABLE session_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL,
    event_type  TEXT NOT NULL,
    event_data  TEXT NOT NULL,          -- JSON blob（完整事件数据）
    event_index INTEGER NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(session_id, event_index)
);
CREATE INDEX idx_session_events_session_id ON session_events(session_id, event_index);
CREATE INDEX idx_session_events_type ON session_events(session_id, event_type);
```

选择 JSON blob 存储——schema 灵活，新增事件 variant 不需要迁移。事件流的访问模式是"按会话按序读取"，JSON blob 在此模式下无性能劣势。

事件数据的 JSON 结构包含 `schema_version` 字段用于跨版本兼容读取。

#### session_snapshots

```sql
CREATE TABLE session_snapshots (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      TEXT NOT NULL,
    event_index     INTEGER NOT NULL,
    state_data      TEXT NOT NULL,       -- JSON blob (SessionState)
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(session_id, event_index)
);
CREATE INDEX idx_snapshots_session ON session_snapshots(session_id, event_index DESC);
```

触发时机：TurnCompleted 后 event_index % 20 == 0（N=20）。保留最近 5 个 + 初始快照。

#### sessions（会话元数据）

```sql
CREATE TABLE sessions (
    id              TEXT PRIMARY KEY,
    project_path    TEXT NOT NULL,
    model           TEXT NOT NULL,
    title           TEXT,
    status          TEXT NOT NULL DEFAULT 'active',
    turn_count      INTEGER NOT NULL DEFAULT 0,
    total_prompt_tokens     INTEGER NOT NULL DEFAULT 0,
    total_completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_cost_rmb          REAL NOT NULL DEFAULT 0.0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at    TEXT
);
```

#### long_term_memory

```sql
CREATE TABLE long_term_memory (
    id              TEXT PRIMARY KEY,
    content         TEXT NOT NULL,
    category        TEXT NOT NULL,
    confidence      REAL NOT NULL DEFAULT 0.7,
    source          TEXT NOT NULL,
    project_path    TEXT,
    importance      REAL NOT NULL DEFAULT 0.5,
    access_count    INTEGER NOT NULL DEFAULT 0,
    last_accessed_at TEXT,
    expires_at      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### memory_fts（FTS5 全文搜索）

```sql
CREATE VIRTUAL TABLE memory_fts USING fts5(
    content, category, project_path,
    content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
);
```

同步更新——记忆写入不是高频操作（每秒 < 10 次），同步保证搜索结果立即可见。

#### memory_symbol_links（记忆-符号关联）

```sql
CREATE TABLE memory_symbol_links (
    memory_id   TEXT NOT NULL,
    symbol_id   TEXT NOT NULL,
    symbol_name TEXT NOT NULL,
    project_path TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (memory_id, symbol_id),
    FOREIGN KEY (memory_id) REFERENCES long_term_memory(id) ON DELETE CASCADE
);
```

#### skills（Skill 元数据，不含 body）

```sql
CREATE TABLE skills (
    name            TEXT PRIMARY KEY,
    description     TEXT NOT NULL,
    kind            TEXT NOT NULL,
    created_by      TEXT NOT NULL,
    scope           TEXT NOT NULL,
    version         INTEGER NOT NULL DEFAULT 1,
    status          TEXT NOT NULL DEFAULT 'active',
    pinned          INTEGER NOT NULL DEFAULT 0,
    source_path     TEXT NOT NULL,
    body_hash       TEXT NOT NULL,
    usage_count     INTEGER NOT NULL DEFAULT 0,
    last_used       TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Skill body 不在数据库中——文件系统是最适合存储 SKILL.md 的。`body_hash` 用于检测手动编辑后的变更。

#### permissions

```sql
CREATE TABLE permissions (
    id              TEXT PRIMARY KEY,
    action_type     TEXT NOT NULL,
    resource        TEXT NOT NULL,
    effect          TEXT NOT NULL,
    scope           TEXT NOT NULL DEFAULT 'persistent',
    reason          TEXT NOT NULL,
    priority        INTEGER NOT NULL DEFAULT 0,
    created_by      TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### cost_records

```sql
CREATE TABLE cost_records (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      TEXT NOT NULL,
    model           TEXT NOT NULL,
    provider        TEXT NOT NULL,
    prompt_tokens   INTEGER NOT NULL,
    completion_tokens INTEGER NOT NULL,
    cache_read_tokens    INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens   INTEGER NOT NULL DEFAULT 0,
    thinking_tokens      INTEGER,       -- NULL = 模型不支持
    cost_rmb        REAL NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### \_migrations（迁移追踪）

```sql
CREATE TABLE _migrations (
    version     INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    applied_at  TEXT NOT NULL DEFAULT (datetime('now')),
    checksum    TEXT NOT NULL            -- 迁移 SQL 的 SHA256
);
```

### 1.5.3 迁移系统

- 顺序执行、不可逆、事务性（每个迁移独立事务）
- 幂等检测：执行前检查 version 是否已应用 + checksum 是否匹配
- checksum 校验：迁移文件被修改且 version 已应用 → 返回错误
- 不做 down 迁移

### 1.5.4 Repository 层

基于 `&'a Connection` 生命周期绑定。rusqlite::Connection 是 `!Send` 的——Repository 不能跨线程使用。Database 实例必须保持在创建它的线程上。

| Repository           | 职责                                     |
| -------------------- | ---------------------------------------- |
| `SessionRepo<'a>`    | 事件追加、快照读写、会话查询             |
| `MemoryRepo<'a>`     | 记忆 CRUD、FTS5 搜索、符号关联           |
| `SkillRepo<'a>`      | Skill 元数据 upsert、状态更新、使用统计  |
| `PermissionRepo<'a>` | 权限规则 upsert、按 action+resource 查询 |
| `CostRepo<'a>`       | 成本记录、按会话/日期/模型聚合           |
| `CheckpointRepo<'a>` | Agent 中断恢复检查点                     |

### 1.5.5 备份系统

- 使用 `VACUUM INTO` 备份为独立 SQLite 文件
- 自动备份：每 24 小时 + 首次启动
- 保留最近 7 个每日备份
- 恢复：`cp backup.db cabinet.db` + 重启自动运行最新迁移

### 1.5.6 设计决策确认

- FTS5 同步策略：同步执行（同事务内），保证搜索结果立即可见
- 会话删除：硬删除（不可恢复），对标 Claude Code 的 `/clear`
- WAL checkpoint：被动模式，依赖 SQLite 默认的 `wal_autocheckpoint=1000`

---

## 1.6 cabinet-otel

OpenTelemetry 可观测性——Traces、Metrics、Logs。

### 1.6.1 职责边界

| 负责                  | 不负责                                      |
| --------------------- | ------------------------------------------- |
| 初始化 OTel SDK       | 决定"什么需要被追踪"——那是各 crate 自己的事 |
| `tracing` → OTel 桥接 | 成本记录——那是 `CostRepo` 的事              |
| 日志收集和文件轮转    | 错误恢复——那是各 crate 的 error handler     |

### 1.6.2 初始化流程

```
OtelGuard::init(config, paths):
  Phase 1: 日志系统先启动
    - 文件输出: ~/.cabinet/logs/cabinet-{date}.log
    - 格式: 默认文本，--log-json flag 切换为 JSON
    - 轮转: 每天一个文件，保留 30 天
  Phase 2: OTel TracerProvider + BatchSpanProcessor + tracing 桥接
  Phase 3: OTel LoggerProvider（仅在配置了 otlp_endpoint 时）
  Phase 4: MeterProvider（预留，v0.1.0 不做自定义 Metrics）
```

### 1.6.3 Span 体系

```
Session root span (session_id, project_path, model, os, cabinet_version)
  ├── Turn span (turn_id, turn_number, mode)
  │     ├── LLM call span (model, provider, tokens, duration, cache_hit)
  │     ├── Tool call span (tool_name, category, duration, sandbox_provider)
  │     └── (tracing 桥接自动) reqwest / rusqlite / tokio 依赖 span
  ├── Compaction span (messages_before/after, tokens_saved, duration)
  ├── CodeGraph index span (files, symbols, duration, languages)
  └── Checkpoint span (event_index, snapshot_created, duration)
```

### 1.6.4 隐私设计（三级控制）

| 级别                    | 控制的字段                 | 默认值  | 何时开启        |
| ----------------------- | -------------------------- | ------- | --------------- |
| `record_file_location`  | 源文件路径                 | `true`  | 始终            |
| `record_tool_args`      | 工具调用参数               | `false` | 调试时          |
| `record_prompt_content` | 用户消息内容、LLM 响应内容 | `false` | 用户明确 opt-in |

当内容记录关闭时，使用 SHA256 前 8 字符的哈希替代明文。

### 1.6.5 Perfetto 导出

- 导出格式：Perfetto Trace JSON（https://ui.perfetto.dev 可直接加载）
- 触发方式：`cabinet trace export --session <id>` 或 `export_perfetto_on_session_end=true`
- 导出位置：`~/.cabinet/traces/`，保留最近 20 个

### 1.6.6 日志规范

| 级别    | 使用场景               | 示例                                       |
| ------- | ---------------------- | ------------------------------------------ |
| `ERROR` | 需要用户关注的操作失败 | 沙箱启动失败、LLM API 认证错误             |
| `WARN`  | 自动恢复的问题         | 重试耗尽降级、token 利用率达 80%           |
| `INFO`  | 关键操作里程碑         | Turn 开始/结束、Skill 加载、CodeGraph 完成 |
| `DEBUG` | 开发调试               | Provider 选择逻辑、缓存命中/未命中         |
| `TRACE` | 非常详细的内部状态     | Token 计数细节、Observer 执行顺序          |

---

## 1.7 cabinet-codegraph

内置代码智能——复用 codegraph 社区 tree-sitter queries (`.scm`)，Rust 重写索引和查询引擎。

### 1.7.1 codegraph.db Schema

#### 符号表 symbols

```sql
CREATE TABLE symbols (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    kind            TEXT NOT NULL,
    file_path       TEXT NOT NULL,
    line_start      INTEGER NOT NULL,
    line_end        INTEGER NOT NULL,
    column_start    INTEGER NOT NULL,
    column_end      INTEGER NOT NULL,
    language        TEXT NOT NULL,
    is_exported     INTEGER NOT NULL DEFAULT 0,
    parent_symbol   TEXT,
    signature       TEXT NOT NULL,
    docstring       TEXT,
    source_hash     TEXT NOT NULL,
    indexed_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_symbols_name_file ON symbols(name, file_path);
CREATE INDEX idx_symbols_kind ON symbols(kind);
CREATE INDEX idx_symbols_source_hash ON symbols(source_hash);
```

#### 边表 edges

```sql
CREATE TABLE edges (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    caller_id       INTEGER NOT NULL,
    callee_name     TEXT NOT NULL,
    callee_id       INTEGER,            -- NULL = 外部符号
    call_type       TEXT NOT NULL DEFAULT 'Direct',
    file_path       TEXT NOT NULL,
    line            INTEGER NOT NULL,
    column          INTEGER NOT NULL,
    FOREIGN KEY (caller_id) REFERENCES symbols(id) ON DELETE CASCADE,
    FOREIGN KEY (callee_id) REFERENCES symbols(id) ON DELETE SET NULL
);
```

#### 文件表 files

```sql
CREATE TABLE files (
    path            TEXT PRIMARY KEY,
    language        TEXT NOT NULL,
    symbol_count    INTEGER NOT NULL DEFAULT 0,
    source_hash     TEXT NOT NULL,
    lines           INTEGER NOT NULL DEFAULT 0,
    bytes           INTEGER NOT NULL DEFAULT 0,
    indexed_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### FTS5 符号搜索

```sql
CREATE VIRTUAL TABLE symbols_fts USING fts5(
    name, signature, docstring, file_path,
    content_rowid='id',
    tokenize='unicode61 remove_diacritics 2'
);
```

#### 框架路由表 framework_routes

```sql
CREATE TABLE framework_routes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    path            TEXT NOT NULL,
    method          TEXT NOT NULL,
    handler         TEXT NOT NULL,
    file_path       TEXT NOT NULL,
    line            INTEGER NOT NULL,
    framework       TEXT NOT NULL,
    middleware       TEXT
);
```

### 1.7.2 索引管道

```
index_project(root):
  Phase 1: 文件发现 (walkdir + .gitignore + 排除模式)
  Phase 2: tree-sitter 解析 (并行, per-CPU-core)
    - 每个文件: 读取 → SHA256 → 与已有比较（相同则跳过）
    - 解析为 AST → 执行 .scm queries → 提取 Symbol/Edge/Route
  Phase 3: 数据库写入 (单线程批量，每 1000 行一批)
    - DELETE + INSERT (changed_files) → FTS5 同步
  Phase 4: 边解析 (跨文件符号关联)
    - callee_name → 在 symbols 表中匹配 → 填充 callee_id
```

### 1.7.3 增量更新

```
incremental_update(changed_files):
  - SHA256 比较 → 跳过未实际变更的文件
  - 仅重新索引变更文件
  - 清理受影响符号的边
  - 超过 500 个变更文件 → 触发完整重建
```

### 1.7.4 文件监控

- notify crate（inotify / FSEvents / ReadDirectoryChanges）
- 去抖动 2 秒
- 积压超过 500 文件 → 完整重建

### 1.7.5 语言支持（Cargo feature flags）

| 语言                          | Feature           | v0.1.0  |
| ----------------------------- | ----------------- | ------- |
| Rust                          | `lang-rust`       | ✅ 默认 |
| TypeScript/TSX                | `lang-typescript` | ✅ 默认 |
| Python                        | `lang-python`     | ✅ 默认 |
| Go                            | `lang-go`         | ✅ 默认 |
| JavaScript                    | `lang-javascript` | ✅ 默认 |
| Java/Kotlin/Swift/C#/Ruby/C++ | 各 feature        | ❌ 后续 |

### 1.7.6 查询 API 复杂度

| 操作                      | 100K 符号项目 | 算法               |
| ------------------------- | ------------- | ------------------ |
| `explore()`               | < 50ms        | FTS5 + SQL 聚合    |
| `search()`                | < 20ms        | FTS5 索引搜索      |
| `callers()` / `callees()` | < 10ms        | SQL 索引查询       |
| `trace()`                 | < 200ms       | 双向 BFS（深度 5） |
| `impact()`                | < 50ms        | BFS 遍历（深度 2） |

### 1.7.7 Framework 检测

自动检测 Next.js (App/Pages Router)、Express、Axum、Actix Web、FastAPI、Django、Gin。

---

# 2. Engine 层

## 2.1 cabinet-exec

命令执行引擎——安全模型的第 2 层（ExecPolicy）+ 第 2.5 层（ApprovalHandler）。

### 2.1.1 ExecEngine API

```
ExecEngine:
  new(sandbox: Arc<dyn SandboxProvider>, policy: ExecPolicy) -> Self
  with_approval_handler(self, handler: Arc<dyn ApprovalHandler>) -> Self
  execute(&self, cmd: &ShellCommand, context: &ExecContext) -> Result<ExecOutput>
  check_policy(&self, cmd: &ShellCommand) -> PolicyDecision
  reload_policy(&self) -> Result<()>
  policy_snapshot(&self) -> PolicySnapshot
  sandbox(&self) -> &dyn SandboxProvider
```

### 2.1.2 执行流程状态机

```
execute(cmd, context):

  1. check_policy(cmd) → decision

  2. match decision:
     Allow → sandbox.execute(cmd) → ExecOutput
     Deny { reason } → ExecError::PolicyDenied
     AskUser { reason }:
       if approval_handler:
         approve → Allow 路径
         deny → Deny 路径
       else (headless):
         ExecError::ApprovalRequired（不执行）
```

### 2.1.3 策略匹配算法

```
按 priority 降序遍历 rules:
  match rule.pattern:
    Exact(pattern) → 完整命令字符串比较
    Prefix(prefix) → 参数列表前缀匹配
    Glob(pattern)   → glob 模式匹配
    Program(prog)   → program 名匹配

  if matched → 返回对应 effect
无匹配 → 返回 default_effect（默认 Allow）

在执行策略匹配之前，SafetyCheckObserver 先做 readOnlyValidation:
  已知只读命令前缀列表:
    git status, git diff, git log, git show,
    cargo check, cargo clippy, cargo doc,
    ls, cat, head, tail, wc, du, df, find,
    grep (rg), which, type, echo, pwd, env
  → 直接 Allow，跳过 ExecPolicy 匹配
  → 对标 Claude Code 的 readOnlyValidation
```

**影子规则检测——对标 Claude Code shadowedRuleDetection：**

ExecPolicy::merge() 时检测规则包含关系。如果两条规则的 pattern 存在子集关系（"git push" 是 "git \*" 的子集），且优先级接近（相差 < 50），且 effect 不同，记录 WARN 日志：

```
"你的规则 'git push: Deny (priority=150)' 可能被内置规则
 'git *: Allow (priority=200)' 覆盖。如果有意如此，忽略此警告。"
```

选择首次匹配而非收集所有匹配——安全策略必须可预测。Allow + Deny 冲突时结果不确定本身是安全漏洞。

### 2.1.4 用户规则覆盖

用户规则（`~/.cabinet/execpolicy.toml`）覆盖相同 pattern + priority 的内置规则。用户也可以覆盖 `default_effect`。

### 2.1.5 与 Layer 3 Permissions 的交互

ExecPolicy AskUser → 先查 Permissions 表 → 如果用户之前选了 Allow & Save → 跳过审批弹窗 → 直接执行。

两个文件分工：

- `~/.cabinet/execpolicy.toml`：用户手动编辑的策略
- `~/.cabinet/permissions.toml`：系统自动保存的审批决策

### 2.1.6 并发模型

`ExecEngine` 内部不加锁。并发安全由沙箱层保证——每个命令在沙箱中独立执行。唯一的共享状态是 `ExecPolicy`：用 `Arc<RwLock<ExecPolicy>>`——策略更新低频，命令执行高频。

### 2.1.7 错误类型

```
ExecError:
  | PolicyDenied { reason, cmd_description }
  | ApprovalRequired { reason, cmd_description }
  | ApprovalFailed { source }
  | SandboxError { source }
  | Timeout { duration_ms, cmd_description }
  | InvalidCommand { reason }
```

### 2.1.8 v0.1.0 不做

- Shell AST 分析（readOnlyValidation）
- 命令输出语义分析
- 命令执行历史去重
- 基于文件变更的自动重试触发

---

## 2.2 cabinet-gateway

LLM 网关——Agent 与 LLM 之间的唯一通道。设计参考 Claude Code 的极简方式：整个行业只有两种 API 格式，两个格式适配器覆盖所有后端。

### 2.2.1 设计哲学

Claude Code 本身只认一种 API 格式，切换后端靠改环境变量，不靠代码里的 Provider 抽象。Cabinet 采用同样的思路：用户通过 `[[providers]]` 配置列表声明多个后端，运行时通过 `/model` 手动切换。**没有自动降级链**——当前 Provider 失败时通知用户，由用户决定是否切换。

### 2.2.2 多 Provider 配置

```toml
# ~/.cabinet/config.toml

[general]
default_provider = "anthropic"

[[providers]]
name = "anthropic"
base_url = "https://api.anthropic.com"
api_key_env = "ANTHROPIC_API_KEY"
model = "claude-sonnet-4-6"

[[providers]]
name = "deepseek"
base_url = "https://api.deepseek.com"
api_key_env = "DEEPSEEK_API_KEY"
model = "deepseek-chat"

[[providers]]
name = "ollama"
base_url = "http://localhost:11434"
model = "llama3.1:70b"
# 不需要 api_key

[[providers]]
name = "openrouter"
base_url = "https://openrouter.ai/api"
api_key_env = "OPENROUTER_API_KEY"
model = "anthropic/claude-sonnet-4-6"
```

配置了几个就是几个。没有内置的"支持的 Provider 列表"——任何兼容 OpenAI API 或 Anthropic API 的后端都能用。

### 2.2.3 Gateway 结构

```
Gateway:
  providers: HashMap<String, ProviderHandle>  // 用户配了几个就是几个
  active: String                               // 当前使用的 provider name
  cost_tracker: Arc<CostTracker>
  budget_guard: Arc<BudgetGuard>
  rate_limit_tracker: Arc<RateLimitTracker>
  prompt_cache_state: Mutex<PromptCacheState>

ProviderHandle:
  name: String
  client: HttpClient               // 共享的 reqwest Client，统一超时/重试/TLS
  format: ApiFormat                // Anthropic | OpenAICompatible
  config: ProviderConfig           // base_url, api_key, model, extra_headers
  rate_limit: RateLimitStatus      // 每个 provider 独立的速率限制状态

enum ApiFormat:
  | Anthropic                      // Messages API —— x-api-key 认证 + 原生 Thinking + cache_control
  | OpenAICompatible               // Chat Completions API —— Bearer 认证 —— 覆盖 DeepSeek/OpenRouter/Ollama/LM Studio/Groq/vLLM/...
```

### 2.2.4 格式检测

Gateway 启动时对每个配置的 Provider 自动检测 API 格式：

```
检测策略（按优先级）:
  1. 用户显式指定 format = "anthropic" 或 "openai_compatible" → 直接使用
  2. base_url 包含 "api.anthropic.com" → Anthropic
  3. 其他所有情况 → OpenAICompatible（默认）
  4. 连接失败 → 标记此 Provider 为不可用，记录 WARN，不阻塞启动

不需要探针请求——根据 base_url 模式判断已足够准确。
用户总是可以通过 format 字段显式覆盖。
```

### 2.2.5 目录结构

```
gateway/src/
  lib.rs                    → Gateway struct
  format/
    anthropic.rs            → Anthropic Messages API——x-api-key 认证、原生 Thinking、cache_control
    openai_compatible.rs    → OpenAI Chat Completions API——Bearer 认证、extra_body Thinking
  client.rs                 → 统一 HTTP 客户端（reqwest，超时/重试/TLS/指数退避）
  cost.rs                   → CostTracker
  budget.rs                 → BudgetGuard（仅告警和阻止，不自动切换模型）
  rate_limit.rs             → RateLimitTracker
  prompt_cache.rs           → Prompt 缓存策略（仅 Anthropic 格式。OpenAI 格式的 Prompt Caching 后续支持）
  thinking.rs               → Thinking 适配（Anthropic 原生 / OpenAI extra_body / 不支持则忽略）
  stream.rs                 → 流式解析（两种 SSE 格式 → 统一 StreamChunk）
```

### 2.2.6 格式适配差异

| 差异点        | Anthropic 格式                                     | OpenAI 兼容格式                                                 |
| ------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| 端点          | `{base_url}/v1/messages`                           | `{base_url}/chat/completions`                                   |
| 认证          | `x-api-key: {api_key}`                             | `Authorization: Bearer {api_key}`                               |
| System prompt | 独立 `system` 字段                                 | `messages[0].role = "system"`                                   |
| Tool 格式     | `{name, description, input_schema}`                | `{type: "function", function: {name, description, parameters}}` |
| Thinking      | 原生 `thinking.budget_tokens`                      | `extra_body.thinking`（如果支持）                               |
| Prompt 缓存   | `cache_control` marker                             | ❌（后续支持）                                                  |
| 流式 SSE      | `content_block_start/delta/stop` + `message_delta` | `chat.completion.chunk` delta                                   |
| Token 用量    | `message.delta.usage`（流式最后）                  | `chunk.usage`（流式最后）                                       |

两种格式适配器在调用前做格式转换，在调用后做响应反转换。Gateway 对外暴露统一的 `ModelRequest`/`ModelResponse`/`StreamChunk`，Agent 不感知底层 API 格式差异。

### 2.2.7 Provider 切换

```
TUI 中:
  /model                    → 列出所有已配置 Provider（标注 active）
  /model deepseek           → 切换到 DeepSeek
  /model gpt-4o             → 切换到 OpenAI 的 gpt-4o（需在 [[providers]] 中配置了 openai）

CLI:
  cabinet --provider deepseek
  cabinet --model gpt-4o

切换行为:
  1. 更新 Gateway.active → 新 provider name
  2. 同一会话内可切换——LLM 上下文窗口是 Provider 无关的（messages 是统一格式）
  3. 切换时 PromptAssembler 更新 ModelGuidance fragment（模型专属指令不同）
  4. 如果切换到不支持 Prompt 缓存的 Provider → 缓存自动禁用
  5. 成本追踪跨 Provider 累计——不管用哪个，总成本都记录
```

### 2.2.8 CostTracker

- 定价来源：编译时嵌入静态定价表 + 用户自定义（`~/.cabinet/pricing.toml`）
- 成本计算：每百万 token 定价 × 实际 token 数 × 汇率
- 缓存命中折扣：Anthropic cache_read 为 prompt 价格的 10%
- 记录时机：每次 LLM 调用后 `CostObserver` 同步写入 `CostRepo`——不依赖 `OtelGuard::flush()`
- 跨 Provider 累计——不管当前用的哪个 Provider，总成本统一追踪

### 2.2.9 BudgetGuard

4 级预算状态。**仅告警和阻止，不自动切换模型：**

| 状态     | 消耗率   | 行为                                                            |
| -------- | -------- | --------------------------------------------------------------- |
| Ok       | < 80%    | 正常执行                                                        |
| Warning  | 80%-95%  | 执行 + 注入 frugality 提示                                      |
| Critical | 95%-100% | 执行 + 通知用户"预算即将耗尽，建议切换便宜 Provider"            |
| Blocked  | ≥ 100%   | 拒绝调用，返回 GatewayError。用户可手动调整限额或 `/model` 切换 |

每日/每月预算自动重置。环境变量 `CABINET_BUDGET_PER_DAY_RMB` 覆盖配置文件。

不自动切换模型的理由：切模型是用户的决策。BudgetGuard 的职责是**告知**用户预算状态，不是替用户做选择。

### 2.2.10 RateLimitTracker

- 解析 HTTP 响应头（`x-ratelimit-*` 和 `anthropic-ratelimit-*`）
- 每个 Provider 独立追踪速率限制状态
- 速率限制命中且等待时间 < 30 秒 → 等待后重试（指数退避）
- 速率限制命中且等待时间 ≥ 30 秒 → 返回 GatewayError，通知用户"当前 Provider 速率受限，建议 /model 切换"

### 2.2.11 Prompt 缓存策略（仅 Anthropic 格式）

缓存断点顺序（确保最大缓存命中率）：

```
[Identity] ← cache_control breakpoint (Persistent)
[ToolCatalog] ← cache_control breakpoint (SessionScoped)
[SkillIndex] ← cache_control breakpoint (SessionScoped)
[ProjectContext] ← cache_control breakpoint (SessionScoped)
── 以下不缓存 (PerTurn) ──
[MemorySnapshot]
[PlanState]
```

缓存键 = hash(所有 Persistent + SessionScoped 片段)。片段内容不变 → 使用缓存的系统提示词，不重新发送。

缓存失效时机：Skill 变更、项目切换、工具集变更、上下文压缩。

切换到不支持 Prompt 缓存的 Provider 时，缓存自动禁用。

### 2.2.12 流式优先原则

即使没有消费者也使用流式。节省 TTFT（首个 Token 时间），流中断可触发重试。

### 2.2.13 错误类型

```
GatewayError:
  | ProviderNotFound { name: String }
  | ProviderUnavailable { name: String, reason: String }
  | AuthenticationFailed { provider: String, message: String }
  | RateLimited { provider: String, retry_after: Option<Duration> }
  | BudgetExceeded { limit_rmb: f64, spent_rmb: f64, period: String }
  | Timeout { provider: String, duration_ms: u64 }
  | StreamingInterrupted { provider: String, reason: String }
  | InvalidResponse { provider: String, reason: String }
  | RequestTooLarge { tokens: u64, max_tokens: u64 }
  | NetworkError { provider: String, source: String }
```

不再有 `AllProvidersExhausted`——没有降级链，不存在"所有 Provider 都耗尽"的场景。

严重级别：

```
ProviderNotFound    → Fatal（配置错误，需人工修复）
ProviderUnavailable → Recoverable（用户可切换到其他 Provider）
AuthenticationFailed → Fatal（需用户修复 API key）
BudgetExceeded      → Recoverable（等待预算重置或用户调整限额/切换 Provider）
RateLimited         → Recoverable（等待后重试或用户切换 Provider）
Timeout             → Transient（重试）
StreamingInterrupted → Transient（重试）
InvalidResponse     → Recoverable（重试）
RequestTooLarge     → Recoverable（压缩上下文后重试）
NetworkError        → Transient（重试）
```

---

## 2.3 cabinet-sandbox

沙箱隔离系统——安全模型的第 1 层。

### 2.3.1 三种实现

| 实现                | 平台                                     | 隔离级别           | 适用场景                       |
| ------------------- | ---------------------------------------- | ------------------ | ------------------------------ |
| `DockerSandbox`     | Linux + macOS + Windows (Docker Desktop) | Container          | 生产默认                       |
| `BubblewrapSandbox` | Linux only (需 bwrap)                    | Process + 命名空间 | Linux 原生，无需 Docker daemon |
| `LocalSandbox`      | 所有 (仅 `#[cfg(debug_assertions)]`)     | None——路径白名单   | 本地开发和调试                 |

### 2.3.2 虚拟路径映射

```
Agent 看到的路径 → 物理路径:
  /mnt/workspace  → ~/.cabinet/sandbox/{sandbox_id}/workspace  (ReadWrite)
  /mnt/outputs    → ~/.cabinet/sandbox/{sandbox_id}/outputs    (ReadWrite)
  /mnt/skills     → ~/.cabinet/skills/                          (ReadOnly)
  /mnt/project    → {项目根目录}                                 (ReadOnly)
```

安全检查：虚拟路径必须在注册挂载点下、不允许 `../` 逃逸、写操作不允许对 ReadOnly 挂载点。

### 2.3.3 DockerSandbox 细节

- Docker 客户端：bollard crate（Docker API Rust 客户端）
- 资源限制：`--memory 512m --cpus 2 --pids-limit 100 --read-only`
- 容器保持运行（`sleep infinity`），命令通过 `docker exec` 执行
- 默认 `--network none`

对标 Codex CLI：`--memory 1g --cpus 4`。Cabinet 更保守——512MB + 2 CPU。Coding Agent 命令通常不需要大量内存。

### 2.3.4 BubblewrapSandbox 细节

- bwrap 是短生命周期——每个命令创建独立 bwrap 进程
- 每个命令启动一个 bwrap 进程约 10ms（Docker exec 约 200ms）
- 文件操作直接在宿主机执行（通过 resolve_path 映射 + 路径校验）
- 仅 Linux 可用

### 2.3.5 LocalSandbox 细节

- `#[cfg(debug_assertions)]` 条件编译——Release 模式不可用
- 直接执行宿主机命令 + 路径白名单校验
- 启动时记录 WARN 日志

### 2.3.6 文件写入并发安全

`FileOperationLock`——全局 HashMap，按 `{sandbox_id}:{virtual_path}` 串行化写操作。

```
edit_file 工具流程:
  1. lock = file_lock.acquire(sandbox_id, path)
  2. content = sandbox.read_file(path)
  3. new_content = content.replace(old, new)
  4. sandbox.write_file(path, new_content)
  5. drop(lock)
```

### 2.3.7 沙箱镜像

默认 Alpine 3.20 基础镜像 + git/curl/ripgrep/fd/bash。默认 < 50MB。用户可通过 `~/.cabinet/sandbox.Dockerfile` 自定义。

### 2.3.8 安全边界校验清单

操作前：虚拟路径解析、挂载点白名单、ReadOnly 写保护、路径逃逸检测（`..` + 符号链接）、沙箱存活检查。

操作后：输出截断（>100KB）、清理临时文件、释放 FileOperationLock。

---

## 2.4 cabinet-session

事件溯源会话系统——唯一使用 Event Sourcing 的子系统。

### 2.4.1 为什么只有 Session 用事件溯源？

| 需求              | Session            | Memory/Skill     |
| ----------------- | ------------------ | ---------------- |
| 需要完整审计追踪  | ✅ 每次 LLM 调用   | ❌ 只需当前值    |
| 需要崩溃恢复      | ✅ 从最后完整 turn | ❌ CRUD 不怕崩溃 |
| 需要时间旅行/重放 | ✅ 调试 Agent 行为 | ❌               |
| 写入模式          | 追加               | 增删改           |

### 2.4.2 SessionManager API

```
SessionManager:
  create(project_path, model, config, environment) -> Result<SessionId>
  admit_prompt(session_id, content, delivery) -> Result<MsgId>
  resume(session_id) -> Result<SessionHandle>
  complete(session_id) -> Result<()>
  abandon(session_id) -> Result<()>
  append_event(session_id, event_type, event_data) -> Result<u64>
  get_session(session_id) -> Result<SessionMeta>
  list_sessions(filter: SessionFilter) -> Result<Vec<SessionSummary>>
  create_snapshot(session_id) -> Result<()>
  fork(session_id, from_event_index) -> Result<SessionId>
  set_title(session_id, title, source) -> Result<()>
  export_session/import_session (接口预留，v0.1.0 不实现)
```

### 2.4.3 两阶段准入协议

```
Phase 1: admit_prompt()
  1. 生成 msg_id + 检查幂等（同 session_id + msg_id 不重复）
  2. 生成 event_index
  3. 写入 PromptSubmitted 事件
  → 用户消息在 LLM 调用前已持久化

Phase 2: resume()
  1. 从 snapshot + 事件流重建状态
  2. 检查会话状态（Idle/Interrupted）
  3. 返回 SessionHandle { projector, event_index, meta }
```

### 2.4.4 Snapshot 机制

- 触发时机：TurnCompleted 后 event_index % 20 == 0
- 内容：完整 SessionState（messages 列表 + plan + 统计）
- 清理：保留最近 5 个 + 初始快照
- N=20 的理由：20 个 JSON 事件重放约 10ms，远小于 LLM 调用延迟

### 2.4.5 中断和恢复

```
崩溃检测:
  进程崩溃 → 最后事件是 ToolExecuted 而非 TurnCompleted
  → 下次启动时自动标记为 Interrupted

恢复:
  cabinet resume {session_id}
  → 恢复到最后一个 TurnCompleted 之后
  → 丢弃未完成的 turn
  → 注入系统消息: "Previous session was interrupted. Resuming from turn {N}."
```

### 2.4.6 Fork 能力

从历史会话的任意事件位置分叉创建新会话。新会话共享原会话的 `agent_config_snapshot`。

### 2.4.7 性能分析

- 每次 LLM turn 写入约 8-15 个 INSERT（~1.5ms，< LLM 调用延迟的 0.3%）
- 100 turn 会话恢复约 210ms
- 1000 个会话存储约 1.5GB——SQLite 可轻松承载

---

## 2.5 cabinet-tool

工具注册与发现——窄腰架构的"腰"。20 个内置工具定义 Agent 的能力边界。

### 2.5.1 ToolRegistry API

```
ToolRegistry:
  register(tool: ToolEntry) -> Result<ToolGuard>
  register_scoped(tool: ToolEntry, scope_token: Arc<()>) -> Result<ToolGuard>
  unregister(name: &str) -> Result<()>
  get(name: &str) -> Option<&ToolEntry>
  list_visible(agent_type: AgentType) -> Vec<&ToolDefinition>
  list_all() -> Vec<&ToolEntry>
  search(query: &str) -> Vec<&ToolDefinition>   // FTS5
  execute(name: &str, args: JsonValue, context: &ToolContext) -> Result<ToolResult>
  check_concurrency_safety(name: &str, args: &JsonValue) -> bool
  generation() -> u64
  tool_stats() -> HashMap<String, ToolStats>
```

### 2.5.2 22 个内置工具——全部注入 prompt，对标 Claude Code

Claude Code 将全部工具（30+ 内置 + MCP）注入系统提示词，Agent 永远知道自己的全部能力。Cabinet 采用相同策略。21 个工具 ~50 tokens/个 ≈ 1050 tokens，位于缓存断点内，仅在工具集变更时重新缓存。

| 工具                | 类别       | 并发安全 | 实现要点                                                                      |
| ------------------- | ---------- | -------- | ----------------------------------------------------------------------------- |
| `codegraph_explore` | ReadOnly   | ✅       | CodeGraphIndex 方法薄封装                                                     |
| `codegraph_search`  | ReadOnly   | ✅       | 精确符号查找                                                                  |
| `codegraph_callers` | ReadOnly   | ✅       | 调用者分析                                                                    |
| `codegraph_callees` | ReadOnly   | ✅       | 被调用者分析                                                                  |
| `codegraph_impact`  | ReadOnly   | ✅       | 影响分析                                                                      |
| `codegraph_trace`   | ReadOnly   | ✅       | 路径追踪                                                                      |
| `read_file`         | ReadOnly   | ✅       | 沙箱 read_file                                                                |
| `write_file`        | LightWrite | ❌       | 原子写入（tmp → rename）                                                      |
| `edit_file`         | LightWrite | ❌       | old_string 精确替换（唯一匹配）                                               |
| `apply_patch`       | LightWrite | ❌       | 结构化 patch 应用                                                             |
| `glob`              | ReadOnly   | ✅       | 沙箱 glob                                                                     |
| `grep`              | ReadOnly   | ✅       | ripgrep crate（非 shell grep）                                                |
| `bash`              | Exec       | ❌       | ExecEngine 管道                                                               |
| `web_fetch`         | Costly     | ✅       | reqwest + markdown 转换                                                       |
| `web_search`        | Costly     | ✅       | 搜索 API                                                                      |
| `task`              | Exec       | ❌       | 子代理派发（Explore/Verify/GeneralPurpose）。并行支持，中断传播，15min 超时   |
| `workflow`          | Exec       | ❌       | 多阶段子代理编排（pipeline/barrier/sequential + loop-until-count/budget/dry） |
| `todo_write`        | LightWrite | ✅       | Plan Step 状态更新                                                            |
| `skill_invoke`      | ReadOnly   | ✅       | Skill 激活 + body 注入                                                        |
| `skill_create`      | LightWrite | ❌       | SkillGenerator 触发                                                           |
| `memory`            | ReadOnly   | ✅       | 统一记忆入口 (action=search/save/delete/list)                                 |
| `ask_user`          | ReadOnly   | ✅       | 向用户提问                                                                    |

MCP 工具同样注入 ToolCatalog。新增 MCP 工具时 PromptAssembler 失效 ToolCatalog 缓存——对标 Claude Code 的 `assembleToolPool()` 策略。

### 2.5.4 并发执行模型

```
工具按 is_concurrency_safe 分组:
  concurrent_batch → join_all 并行执行
  sequential_batch → for 逐个执行
```

bash 的 `check_concurrency_safety` 根据命令模式动态判断：

- `git status/diff/log` → true（只读）
- `git commit/push/merge` → false（修改仓库状态）
- 未知命令 → false（保守）

### 2.5.5 ToolGuard

作用域化工具生命周期：Plugin 卸载 / Skill 失活 → scope_token drop → 关联的 ToolGuard drop → 工具自动注销。对标 OpenCode 的 `Effect.addFinalizer` 模式。

### 2.5.6 安全边界

ToolRegistry 不做执行安全检查——那是 ExecPolicy + Sandbox 的职责。ToolRegistry 只负责：工具是否存在、是否允许给此 AgentType、参数是否符合 JSON Schema、转发执行。

---

## 2.6 cabinet-plugin

插件系统——Cabinet 的扩展机制。加载外部代码/配置并注册到正确的子系统。

### 2.6.1 插件目录结构

```
~/.cabinet/plugins/{plugin-name}/
  plugin.toml          # 必需——插件元数据和能力声明
  plugin.wasm          # 可选——WASM 可执行模块
  mcp.json             # 可选——MCP 服务器配置
  skills/              # 可选——Skill 文件
```

### 2.6.2 plugin.toml 完整 Schema

```toml
[plugin]
name = "postgres-tools"
version = "0.1.0"
description = "PostgreSQL database integration"
kind = "Composite"           # Provider | Tool | Skill | Command | Hook | Composite

[cabinet]
min_version = "0.1.0"

[wasm]
module = "plugin.wasm"        # 不存在 → 纯声明式插件

[[mcp]]
name = "postgres"
command = "npx"
args = ["-y", "@anthropic/mcp-server-postgres", "postgresql://localhost:5432/db"]
env = { "PGPASSWORD" = "${ENV:POSTGRES_PASSWORD}" }

[[skills]]
source = "./skills/sql-review/"
scope = "project"

[[hooks]]
event = "SessionStart"
description = "Verify database connectivity"
priority = 100
```

### 2.6.3 WASM 运行时

- 引擎：wasmtime
- 限制：128MB 内存、30 秒执行、10M fuel 指令数
- ABI：C ABI（最广泛的语言支持——包含 Rust/JS/Python SDK）
- 宿主导出函数：`register_tool`、`register_hook`、`register_skill`、`log`、`http_request`、`get_config`、`alloc/free`
- 编译验证在 `install()` 时完成——无效 WASM 安装即发现

### 2.6.4 PluginPolicy 安全约束

```toml
[wasm_limits]
max_memory_bytes = 134_217_728
max_execution_time_ms = 30_000
fuel = 10_000_000

[wasm_capabilities]
allow_network = true
allow_filesystem = false
allow_subprocess = false
```

### 2.6.5 MCP 聚合

- 传输方式：stdio（默认）、SSE/HTTP、WebSocket
- 连接流程：initialize → tools/list → 包装为 Cabinet ToolHandler → 注册到 ToolRegistry
- 按需启动（Lazy）：`lazy = true` → 首次工具调用时连接
- 生命周期：插件卸载 → SIGTERM → 5s → SIGKILL

### 2.6.6 Hook 系统

可用钩子事件：SessionStart/End、TurnStart/End、PreToolCall/PostToolCall、PlanApproved、CompactionStart/End、SkillCreated、PluginInstalled、PreShutdown。

钩子按 priority DESC 执行。PreToolCall 支持 Reject（短路）——拒绝后续钩子和工具执行。

### 2.6.7 插件加载顺序

- 依赖拓扑排序
- 部分失败不阻塞其他插件
- 安装记录持久化到 `plugin_install_records` 表

### 2.6.8 v0.1.0 不做

- Plugin 签名验证
- 自动更新
- Plugin 市场/注册表
- WASM 异步（WASI async）
- Plugin 热重载（文件监控）
- 跨 Plugin 通信

---

# 3. Intelligence 层

## 3.1 cabinet-agent

Agent 主执行引擎——最大的 crate。串联所有子系统为可执行的 Agent 循环。

### 3.1.1 AgentLoop 状态机

```
AgentLoopState:
  | Idle                    // 等待用户输入
  | Planning               // Plan Mode——Agent 探索代码库
  | AwaitingApproval       // Plan 已生成，等待用户审批
  | Executing              // Build Mode——执行计划
  | Compacting             // 正在压缩上下文（阻塞新 turn）
  | Interrupted            // 收到中断信号
  | Terminating            // 正在优雅关闭
  | Terminated             // 已停止
```

### 3.1.2 Plan Mode 详细流程

```
进入条件:
  - plan_mode_default = true
  - 无 active_plan
  - 用户消息不是斜杠命令
  - 非简短命令（< 10 词 + 包含明确命令名 → 跳过）

工具集: 只读（codegraph_*, read_file, glob, grep, web_*, todo_write, ask_user, memory, skill_invoke）

系统提示词: prompts/plan_mode.md
  - "你是代码分析助手。不能修改任何文件或执行任何命令。"
  - 强制 HEI 结构——使用 codegraph_explore 作为主要探索工具
  - 使用 todo_write 创建步骤列表
  - 完成时调用 ask_user 提交计划

审批交互:
  /approve → PlanApproved → 状态 → Executing
  /reject [reason] → PlanRejected → Agent 根据理由重新 plan
  /plan → 查看计划详情
```

### 3.1.3 Build Mode 执行循环

```
Phase 1: 准入检查 → BudgetGuard + RateLimitTracker
Phase 2: Prompt 组装 → 注入 Memory + Skill + CodeGraph + Plan 状态
Phase 3: LLM 流式调用 → 渲染流式文本/Thinking/工具调用
Phase 4: 工具分发 → 按并发安全性分组 → 并发/串行执行
Phase 5: Turn 后处理 → ContextMonitor → 可能触发压缩
  → Observer 管道（Evaluator → QualityGate → Compaction → Checkpoint → Cost）
  → 检查 Plan Step 完成
  → turn_number + 1
```

### 3.1.4 PromptAssembler

12 个 Fragment 按 priority 排序组装，分为两个预算层级：

| 层级            | Priority | Fragment                             | CacheTTL      | 配额                 | 利用率 >90% 行为 |
| --------------- | -------- | ------------------------------------ | ------------- | -------------------- | ---------------- |
| **T1 不可削减** | 1        | Identity（CABINET.md + 核心指令）    | Persistent    | ~3000                | 保持             |
|                 | 2        | EnvironmentHint（OS/Shell/WSL）      | SessionScoped | ~100                 | 保持             |
|                 | 3        | ModelGuidance                        | Persistent    | ~400                 | 保持             |
|                 | 4        | PlatformHint（TUI vs Headless）      | SessionScoped | ~100                 | 保持             |
|                 | 5        | 代码探索协议                         | Persistent    | ~300                 | 保持             |
|                 | 10       | ToolCatalog（全部 21 个 + MCP 工具） | SessionScoped | ~1200                | 保持             |
|                 | 31       | PlanState（当前计划）                | PerTurn       | ~200                 | 保持             |
|                 | 40       | SteerChannelNote                     | SessionScoped | ~80                  | 保持             |
| **T2 弹性**     | 20       | Skill L2 body                        | SessionScoped | 4000→2000→0          | **跳过**         |
|                 | 12       | ProjectContext（CodeGraph + rules）  | SessionScoped | 5000→3000→1000       | 截断             |
|                 | 30       | MemorySnapshot（相关记忆）           | PerTurn       | 5条→3条→1条→0        | **跳过**         |
|                 | 11       | SkillIndex（Active Skill L1）        | SessionScoped | 20个→10个→5个→pinned | pinned only      |

缓存键 = hash(所有 Persistent + SessionScoped 片段)。片段不变 → 使用缓存 → 节省 prompt tokens。

### 3.1.5 ContextMonitor + ContextBudget

**ContextMonitor（token 监控）：**

Token 估算（~15% 误差，对"是否该压缩"的判断足够）。两个阈值：

- `warning_threshold` (0.75) → 注入精简提示 → 调用 CompactionObserver
- `critical_threshold` (0.90) → 强制压缩 → 阻塞新 turn

**ContextBudget（弹性注入预算——Cabinet 差异化能力）：**

对比 6 个对标产品，无一家的记忆注入量随上下文压力调整。这是 Cabinet 独有设计——`ContextMonitor` 不仅检测利用率，还在每 turn 开始前计算注入预算：

```
allocate_budget() -> ContextBudget:

  剩余 token = 模型窗口大小 - 已用 tokens - LLM 输出预留(50%)
  注入池 = min(剩余, 26000)  // 注入上限

  Fragment 分为两个层级:

  Tier 1 — 不可削减（结构必需）:
    Identity             = persist_quota    // ~3000
    ToolCatalog          = persist_quota    // ~600
    PlanState            = persist_quota    // ~200
    SteerChannelNote     = persist_quota    // ~80

  Tier 2 — 弹性（从下往上削减）:
    utilization < 50%:
      Skill L2 body      = min(4000, 池中剩余)
      ProjectContext     = min(5000, 池中剩余)
      MemorySnapshot     = min(800, 池中剩余)   → 5 条完整
      SkillIndex         = min(600, 池中剩余)   → 20 个

    utilization 50-75%:
      Skill L2 body      = min(2000, 池中剩余)
      ProjectContext     = min(3000, 池中剩余)
      MemorySnapshot     = min(400, 池中剩余)   → 3 条截断
      SkillIndex         = min(300, 池中剩余)   → 10 个

    utilization 75-90%:
      Skill L2 body      = 0                     → 不注入
      ProjectContext     = min(1000, 池中剩余)
      MemorySnapshot     = min(150, 池中剩余)   → 1 条标题
      SkillIndex         = min(150, 池中剩余)   → 5 个 + pinned

    utilization > 90%:
      所有 Tier 2 = 0                           → 仅 Tier 1
      → 触发 CompactionObserver 强制压缩
```

MemoryFacade 和 SkillRegistry 接受 `token_budget` 参数，自适应返回：

```
MemoryFacade::recall(query, project, token_budget):
  if token_budget >= 800 → limit=5, 完整内容
  else if token_budget >= 400 → limit=3, 截断到 120 chars/条
  else if token_budget >= 150 → limit=2, 仅标题行
  else → limit=0, 跳过 MemorySnapshot

SkillRegistry::list_active_for_injection(token_budget):
  max_count = min(config.skill_max_injected, token_budget / 30)
  排序: pinned 优先 → usage_count DESC → 截断
```

### 3.1.6 ContextCompressor 4 阶段

```
Phase 1: 工具结果预裁剪（无 LLM，廉价）
  - MD5 去重相同结果
  - 替换 >200 chars 输出为摘要
  - 移除 base64 截图
Phase 2: 边界选择
  - head 保护：protect_first_n=3 对
  - tail 保护：protect_last_n=6 条
  - 不拆分 tool_call/result 对
Phase 3: LLM 结构化摘要
  - 模板: Goal | Completed Actions | Active State | Key Decisions | Blocked | Relevant Files | Remaining Work
  - 时序锚定：相对引用 → 过去式事实
  - Token 自适应预算：20% 比例 (min 2000, max 12000)
Phase 4: 组装 + 防抖
  - compressed = head + summary + tail
  - 连续两次节省 <10% → 跳过（防狂压）
```

Post-compact 附件重建：重新注入最近读取的 5 个文件、激活的 Skill、当前 Plan、工具目录 delta。

对标来源：Phase 1-4 来自 Hermes，post-compact 来自 Claude Code。

### 3.1.7 Harness 质量免疫系统

**Evaluator**：LLM 输出评分（0-1），4 维度（correctness/completeness/evidence/safety）。使用 haiku，评分仅用于 AutoAdjuster 趋势分析。

**QualityGate**：HEI 结构完整性检查（Hypothesis-Evidence-Impact）。正则模式匹配——非 LLM，快速无成本。缺少 Impact → Warning，缺少 Evidence → 注入提醒。

**AutoAdjuster**：分析最近 5 次评分趋势 → TemperatureReduce / ContextBudgetShrink / SuggestProviderSwitch / NotifyUser。冷却 30 分钟，连续触发有上限。不再自动切换模型——模型切换是用户决策。

**PreferenceLearner**：从用户审批决策中学习偏好。连续 3 次 Allow & Save → 自动创建 PermissionRule。存为 LongTermMemory（category=UserPreference）。

**HarnessAnalyst**：每日元分析。聚合会话统计 → LLM 生成洞察 → 存入 LongTermMemory。

**FailurePatternAnalyzer**：分析工具错误率。高错误率 → 建议增加超时/检查 schema/废弃工具。

对标：全部来自 Cabinet v2 的 Harness 闭环。

### 3.1.8 Observer 管道（13 个）

| #   | Observer               | 钩子             | 职责                                                       |
| --- | ---------------------- | ---------------- | ---------------------------------------------------------- |
| 1   | ContentGuardObserver   | on_user_input    | 注入攻击检测                                               |
| 2   | SafetyCheckObserver    | on_tool_call     | ExecPolicy 检查                                            |
| 3   | PlanGuardObserver      | on_tool_call     | 计划外操作拦截                                             |
| 4   | ToolExecuteObserver    | on_tool_call     | 工具执行统计                                               |
| 5   | StepEventObserver      | on_step_end      | SessionEvent 写入                                          |
| 6   | ContextMonitorObserver | on_step_end      | Token 估算 + 预算分配（传递给 MemoryFacade/SkillRegistry） |
| 7   | CompactionObserver     | on_step_end      | 触发压缩                                                   |
| 8   | EvaluatorObserver      | on_step_end      | LLM 输出评分                                               |
| 9   | QualityGateObserver    | on_step_end      | HEI 结构检查                                               |
| 10  | CheckpointObserver     | on_step_end      | TurnCompleted 后 snapshot                                  |
| 11  | CostObserver           | on_post_llm_call | 成本记录                                                   |
| 12  | AutoAdjustObserver     | on_session_end   | 自动调参                                                   |
| 13  | ClarificationObserver  | on_tool_call     | 高风险操作强制确认（始终最后）                             |

每个 Observer 有明确的 `requires_before/after` 依赖声明，启动时拓扑校验。

### 3.1.9 Steer 机制

`/steer` 不中断当前 turn——等待工具批次完成后注入 system 消息。非破坏性中途引导。对标 Hermes。

### 3.1.10 子代理（Subagent）——全面对标 Claude Code AgentTool 体系

**5 种 Agent 类型，每种有专用提示词和工具集：**

|               | Build        | Plan           | Explore                                    | Verify                    | GeneralPurpose                                         |
| ------------- | ------------ | -------------- | ------------------------------------------ | ------------------------- | ------------------------------------------------------ |
| **触发者**    | 用户直接对话 | Plan Mode 自动 | Agent 调用 task                            | Agent 调用 task           | Agent 调用 task                                        |
| **工具集**    | 全部 20 个   | 只读（~8 个）  | codegraph\_\*(6) + read_file + glob + grep | read*file + grep + web*\* | codegraph*\* + read_file + glob + grep + web*\* + bash |
| **可写文件**  | ✅           | ❌             | ❌                                         | ❌                        | ❌                                                     |
| **可 bash**   | ✅           | ❌             | ❌                                         | ❌                        | ✅                                                     |
| **可 spawn**  | ✅ (task)    | ❌             | ❌                                         | ❌                        | ❌                                                     |
| **max_turns** | 100          | 30             | 10                                         | 5                         | 10                                                     |
| **超时**      | 无           | 无             | 15 min                                     | 5 min                     | 15 min                                                 |

**子代理生命周期：**

```
父 Agent 调用 task(description, agent_type="explore"):

  1. 创建子 AgentLoop:
     - 独立消息历史（不共享父 memory）
     - 独立 ShortTermMemory（子代理有自己的短期记忆）
     - 共享 sandbox、codegraph、gateway
     - 工具调用自动批准（父已审批 task 调用）
     - max_spawn_depth = 1（不能再 spawn——防止无限嵌套）

  2. 上下文组装:
     - 专用系统提示词（prompts/explore.md / verify.md / general_purpose.md）
     - 继承 CABINET.md（用户身份继承）
     - 继承 ProjectContext（项目上下文继承）
     - 不注入父的 MemorySnapshot——独立上下文
     - 不注入父的 PlanState——子代理不需要知道全局计划

  3. 执行（同步等待）:
     - 父 Agent 阻塞直到子完成
     - 流式输出转发到父 TUI（缩进显示 "│ [Explore] ..."）
     - 子 Agent 在受限 AgentLoop 中运行

  4. 中断传播:
     - 父 Agent Ctrl+C → 中断信号传播到所有活跃子代理
     - 子代理检测到中断信号 → 完成当前工具批次 → 返回部分结果
     - 对标 Claude Code 的中断传播

  5. 超时处理:
     - Explore / GeneralPurpose: 15 分钟硬超时
     - Verify: 5 分钟硬超时
     - 超时 → tokio::time::timeout 触发 → 返回部分结果 + "[timeout]"
     - 对标 Hermes 的 child_timeout_seconds + DeerFlow 的 15-min hard timeout

  6. 并行子代理:
     - 父可同时调用多个 task → concurrent batch
     - 如果 tool_calls 中有多个 task 且 is_concurrency_safe → join_all 并行执行
     - 各子代理独立上下文，互不干扰

  7. 记忆合并:
     - 子代理结束后 → 提取关键发现
     - 格式: "[Explore] auth 模块使用 trait-based 错误处理模式"
     - 合并到父 Agent 的 MemoryFacade（category=TechnicalNote, source=Subagent{agent_type})
     - 置信度: Explore=0.7, Verify=0.9, GeneralPurpose=0.6

  8. 结果返回:
     ToolResult {
       content: Text("
         ## {AgentType} Result
         {final_output}
         ---
         Tools: {tool_list} | Turns: {N} | Duration: {X}s | Tokens: {Y}
       ")
     }
```

**结果验证——对标 Claude Code verificationAgent：**

```
父 Agent 可选的两阶段验证:
  step1 = task("分析 auth 模块", agent_type="explore")
  step2 = task("验证以下分析结果的正确性和完整性: {step1}", agent_type="verify")

  → Verify 子代理接收 Explore 的输出
  → 检查: 引用的文件路径是否存在？符号名是否正确？结论是否有证据支撑？
  → 返回: 原结果 + 验证标注（通过/警告/错误）

  此步骤是可选的——Agent 自主决定是否需要验证。
  触发条件: task 的 description 包含 "验证" 关键词，或 Agent 显式指定 agent_type="verify"
```

**内置 Agent 提示词：**

**每种 Agent 类型的 Hard Limits——来自结构决定论原则（P5）：**

Agent 知道自己的边界比知道自己的能力更重要。每种 Agent 的系统提示词末尾包含明确的 Hard Limits 声明：

```
prompts/explore.md:
  "你是一个代码库探索助手。你的职责是深入理解代码结构。
   使用 codegraph_explore 作为主要工具——一次调用获取全貌。
   返回: 关键符号列表、文件结构、调用关系、潜在问题区域。

   ## Hard Limits
   - 你不能修改任何文件。如果用户要求修改，说明你在 Explore 模式下。
   - 你不能执行 bash 命令。
   - 你不能创建 Skill。
   - 你不能 spawn 子代理。你的职责仅限于探索和报告。"

prompts/verify.md:
  "你是一个结果验证助手。你的职责是检查其他 Agent 的输出。
   验证: 引用的文件路径是否存在？符号名是否正确？
   结论是否有证据支撑？是否有遗漏的边界情况？
   返回: 验证结果 + 通过/警告/错误标注。

   ## Hard Limits
   - 你不能修改任何文件。
   - 你不能执行 bash 命令。
   - 你不能探索新代码——只验证给定的内容。
   - 你不能创建 Skill。"

prompts/general_purpose.md:
  "你是一个通用任务助手。你可以搜索代码、读取文件、执行只读 bash 命令。
   不能修改任何文件。不能创建 Skill。不能 spawn 子代理。
   返回: 任务结果 + 使用的工具统计。

   ## Hard Limits
   - 你不能修改任何文件。
   - 你不能创建 Skill。
   - 你不能 spawn 子代理。
   - bash 仅用于只读命令（git status、cargo check、ls 等）。"

prompts/plan_mode.md:
  "## Hard Limits
   - 你不能修改任何文件。
   - 你不能执行任何 bash 命令。
   - 如果用户要求直接修改，诚实告知: '我在 Plan 模式下只能探索和分析。
     请 /approve 切换到 Build 模式后我再执行修改。'"

prompts/build_mode.md:
  "你没有 Hard Limits。你拥有全部工具。
   但你必须遵守 Plan 步骤——计划外操作需要用户审批。
   破坏性操作始终需要用户确认。"
```

### 3.1.11 Workflow 多阶段编排——对标 Claude Code + Cabinet v2 WorkflowEngine

v2 有成熟的 WorkflowEngine（18 种节点、StateGraph DAG 引擎），但它是为项目管理平台设计的。v3 聚焦 Coding Agent 场景：编排子代理完成多阶段代码任务。内部仍然使用 `task` 子代理体系，WorkflowExecutor 管理阶段依赖和数据流。

**Agent 能力层次：**

```
L1: 单工具调用        → bash("cargo build")
L2: 单子代理委托      → task("分析 auth", agent_type="explore")
L3: 并行子代理        → 同时 task × 3
L4: 结构化多阶段编排  → workflow("审计安全漏洞")    ← 新增
```

**三种执行模式 + 三种循环模式：**

```
模式 1: pipeline
  物品流经所有阶段，无阶段间屏障。
  A 物品在 Phase 3 时 B 物品仍在 Phase 1。
  适用: 扫描模块、逐文件检查

模式 2: barrier
  所有物品必须完成当前阶段，才能一起进入下一阶段。
  需要全部结果才能继续——去重合并、汇总报告。
  等价于: parallel() barrier → parallel() barrier → ...

模式 3: sequential
  物品逐个流经全部阶段。
  适用: 有严格顺序依赖的任务（分析→设计→实现→测试）

循环 A: loop-until-count
  while bugs.len() < target_count { spawn Explore 子代理 }
  适用: 未知数量的发现——"找 10 个 bug"

循环 B: loop-until-budget
  剩余 token 预算 > 阈值时继续 spawn 子代理
  Guard: budget.total 为 None → Infinity（无预算设置时不做循环）
  适用: 受预算约束的大规模扫描

循环 C: loop-until-dry
  连续 N 轮无新发现 → 停止
  对标 Claude Code Workflow 的 exhaustive 模式
  适用: 穷举式分析（"找出所有可能的 SQL 注入点"）
```

**Workflow Definition（JSON，Agent 通过 workflow 工具提交）：**

```json
{
  "name": "security-audit",
  "description": "审计代码安全漏洞，分类验证，生成报告",
  "phases": [
    {
      "title": "并行扫描",
      "mode": "pipeline",
      "agent_type": "explore",
      "max_concurrency": 10,
      "items": ["auth", "database", "api"],
      "prompt_template": "扫描 {item} 模块的安全漏洞（SQL注入、XSS、认证绕过）"
    },
    {
      "title": "去重分类",
      "mode": "barrier",
      "agent_type": "general_purpose",
      "prompt": "合并扫描结果，去重，按严重程度分类"
    },
    {
      "title": "逐项验证",
      "mode": "pipeline",
      "agent_type": "verify",
      "max_concurrency": 5,
      "items_from": "previous_phase",
      "prompt_template": "验证以下发现是否真实存在"
    },
    {
      "title": "汇总报告",
      "mode": "barrier",
      "agent_type": "general_purpose",
      "prompt": "汇总为安全审计报告"
    }
  ],
  "loop": {
    "type": "until_dry",
    "max_dry_rounds": 2,
    "max_iterations": 10
  }
}
```

**WorkflowExecutor：**

```
WorkflowExecutor:
  execute(definition: WorkflowDefinition) -> Result<WorkflowResult>:

    1. 解析 definition:
       - 验证 phases 不为空
       - 验证 agent_type 合法（Explore | Verify | GeneralPurpose）
       - 如果 loop 存在 → 进入循环模式

    2. 循环模式（如果 loop 配置了）:
       while 条件不满足:
         run_phases(phases)
         收集本轮结果
         检查循环终止条件

       循环终止条件:
         until_count: 累计发现数 >= target
         until_budget: budget.remaining() < threshold
         until_dry: 连续 dry_rounds 轮无新发现

    3. run_phases:
       for phase in phases:
         match phase.mode:
           pipeline → 每个 item 独立流经剩余所有阶段
           barrier → 等待全部 item 完成当前阶段，再进入下一阶段
           sequential → 逐个 item 执行当前阶段

    4. 每个 phase 内部:
       - 确定 items（来自 phase.items 或 phase.items_from="previous_phase"）
       - 确定并发数（phase.max_concurrency 或默认 5）
       - spawn 子代理（使用 task 工具相同的子代理体系）
       - 收集结果 → 传递给下一阶段

    5. 返回 WorkflowResult {
         phases: Vec<PhaseResult>,
         total_subagents: u32,
         total_duration_ms: u64,
         total_tokens: u64,
         loop_iterations: u32,
       }
```

**持久化为 Skill：**

```
Workflow 完成后 → Agent 可选保存为 Skill:

SKILL.md frontmatter:
  kind: Workflow
  name: security-audit
  description: 审计代码安全漏洞

body: Workflow JSON definition

SkillRegistry 加载时识别 kind=Workflow →
  skill_invoke → WorkflowExecutor::execute(definition)

和其他 Skill 一样受 Curator 管理（30d stale → 90d archived）。
```

**WorkflowGuidance 提示词：**

```
prompts/workflow_guidance.md:

"何时使用 workflow vs task:

 task: 单一问题、单一答案。'分析 auth 模块'、'查找所有 unwrap()'
 workflow: 多阶段、需要发现→分类→验证→汇总。'审计安全漏洞'、'评估代码质量'

 workflow phases 设计原则:
 - Phase 1: 并行探索（Explore, pipeline 模式）
 - 中间阶段: 去重分类（barrier 模式）
 - 倒数第二阶段: 逐项验证（Verify, pipeline 模式）
 - 最后阶段: 汇总报告（barrier 模式）

 循环模式:
 - 不知道会有多少发现 → loop-until-dry
 - 需要至少 N 个发现 → loop-until-count
 - 预算有限 → loop-until-budget"
```

**与 v2 的关系：**

| v2                                                   | v3                                     |
| ---------------------------------------------------- | -------------------------------------- |
| StateGraph DAG 引擎                                  | 不移植                                 |
| 18 种节点                                            | 不移植——只有一种：spawn 子代理         |
| Manager 节点 Plan→Dispatch→Review→Iterate→Synthesize | Agent Plan Mode + Workflow 覆盖        |
| AgentDispatcher Pipeline/Parallel                    | WorkflowExecutor pipeline/barrier 吸收 |
| Decision + approval 节点                             | 不移植                                 |
| WorkflowRuns 持久化                                  | 保存为 Skill（更轻量）                 |
| Harness + Observer Pipeline                          | 已移植                                 |

---

## 3.2 cabinet-skill

Skill 系统——发现、加载、匹配、生命周期管理、自主创建。

### 3.2.1 四级来源加载

加载顺序（后覆盖前）：

1. 内置 Skill（编译时嵌入，~5-10 个）
2. `~/.cabinet/skills/`（全局）
3. `{project}/.cabinet/skills/`（项目——覆盖全局同名）
4. Plugin 注册的 Skill（覆盖所有，卸载时移除）

同名 Skill → 后加载的完全替换先加载的 → 被覆盖者 status = Superseded。例外：pinned=true 的 Skill 不被覆盖。

### 3.2.2 SKILL.md 解析

YAML frontmatter + Markdown body。frontmatter 提取为 SkillMetadata，body 保留在文件中（不存入数据库）。body_hash 用于检测手动编辑。

### 3.2.3 条件显隐（来自 Hermes）

- `requires_tools`：只有这些工具全部可用时，此 Skill 才显示
- `fallback_for_tools`：当这些工具中至少一个可用时，隐藏此 Skill
- 两个检查互斥——先查 requires，再查 fallback

### 3.2.4 渐进加载 L1 → L2 → L3

```
L1: 名称 + 描述——始终注入 prompt（~30 tokens/个，最多 20 个）
L2: 完整 SKILL.md body——skill_invoke 激活时注入为 system 消息
L3: references/ + scripts/——Agent 通过 read_file 按需读取
```

### 3.2.5 SkillGenerator — Agent 自主创建

- 触发：Agent 显式调用 skill_create 工具
- 生成：LLM（Sonnet）根据任务描述 + 工具调用摘要 + 结果生成 SKILL.md
- 验证：name kebab-case、description ≤ 60 chars、allowed_tools 都在 ToolRegistry
- 安全扫描：检测危险命令（rm -rf /、curl | bash、sudo、eval/exec）

### 3.2.6 Curator — 生命周期管理

**Stage 1（纯规则）：** Active + 30d 未使用 → Stale。Stale + 90d 未使用 → Archived。Stale + 重新使用 → Active。pinned=true 跳过所有自动转换。

**Stage 2（LLM 整合）：** 前缀聚类 → 建议合并为伞 Skill → 原专门 Skill 被吸收为 Superseded。

惰性触发：每次启动检查 + 用户手动 `/skills curate`。

### 3.2.7 Skill 安全隔离

`allowed_tools` 白名单——Skill 激活时，Agent 在当前 turn 中只能使用白名单中的工具。turn 结束自动解除。对标 DeerFlow。

---

## 3.3 cabinet-memory

记忆系统——5 层流水线 + Sideagent + 自主提示 + CodeGraph 关联。

### 3.3.1 5 层流水线

```
Layer 1: ShortTermMemory
  - LRU + TTL 30min, maxSize=1000
  - 当前会话 KV + 最近 50 turn 日志

Layer 2: WriteGate
  - 5 级分类: Working | Register | Daily | TransientNoise | StructuredPrefix
  - 多语言正则匹配
  - Working + Register + StructuredPrefix → 升级到 L4

Layer 3: CascadeBuffer
  - L0 暂存——批量写入优化
  - 封存条件: minCount=3 或 maxAge=30min

Layer 4: LongTermMemory
  - SQLite + FTS5 全文搜索
  - 500K 上限
  - 按时间范围、按项目、按符号筛选

Layer 5: MemoryDecay
  - expire → archive → supersede → prune
  - 复合评分: importance × confidence × recency_decay × access_boost
  - 超 500K 时删除最低分条目
```

### 3.3.2 WriteGate 分类规则

| Tier             | 匹配模式示例                                     | 处理            |
| ---------------- | ------------------------------------------------ | --------------- |
| StructuredPrefix | `[STEER]`, `## Subagent Result`, `Plan Approved` | → L4            |
| TransientNoise   | `error`, `warning`, `traceback`, `timeout`       | → 丢弃          |
| Register         | `用户偏好`, `decision`, `决定`, `convention`     | → L4            |
| Daily            | `## Session Summary`, `Harness Insight:`         | → L4 (30d TTL)  |
| Working          | 默认                                             | → CascadeBuffer |

### 3.3.3 Sideagent

每个候选记忆构造微型验证 prompt → haiku 批量判断 RELEVANT/NOT_RELEVANT → 过滤 relevance < 0.6。

成本：每次检索约 $0.0005。每月约 $0.75——几乎可忽略。对标 jcode。

### 3.3.4 记忆衰减公式

```
composite_score =
  importance × confidence × recency_decay × min(access_boost, 3.0)

recency_decay = e^(-days_since_creation / 30 × ln(2))
  → 每 30 天 importance 减半

access_boost = 1 + (access_count × 0.1) × 1.5
  → 每次访问提升 0.15，上限 3.0

新建记忆保护期：7 天
有符号关联的记忆优先保留
```

### 3.3.5 自主提示（Auto-Nudge）

- 会话 > 20 turn → 提示保存记忆
- 有决策事件 + > 10 turn → 提示保存决策
- 会话结束 → 提示保存摘要

不作为强制弹窗——gentle system 消息注入。对标 Hermes。

### 3.3.6 符号关联

与 CodeGraph 集成——记忆可以关联到具体代码符号。代码重构时相关记忆自动浮现。`memory_symbol_links` 表 + `MemoryFacade::recall_by_symbol()`。

### 3.3.7 v3 对比 v2

| 保留的 v2 组件        | 移除的 v2 组件                          | 新增的 v3 能力              |
| --------------------- | --------------------------------------- | --------------------------- |
| ShortTermMemory       | KnowledgeGraph（代码已有 CodeGraph）    | Sideagent（来自 jcode）     |
| WriteGate (5-tier)    | EntityMemory（不需要"员工偏好"）        | 自主提示（来自 Hermes）     |
| CascadeBuffer         | ProjectMemory（不是 Coding Agent 场景） | 置信度过滤（来自 DeerFlow） |
| LongTermMemory (FTS5) |                                         | 符号关联                    |
| MemoryDecay           |                                         |                             |

---

# 4. Application 层

## 4.1 cabinet-app-core

应用编排——依赖组装、生命周期管理、配置加载、信号处理。

### 4.1.1 App 结构

```
App:
  // Foundation (Arc 共享)
  config: ConfigV3, paths: CabinetPaths
  db: Database, codegraph: Arc<CodeGraphIndex>, otel: OtelGuard
  // Engine (Arc 共享)
  gateway: Arc<Gateway>, sandbox: Arc<dyn SandboxProvider>
  exec: Arc<ExecEngine>, session_manager: Arc<SessionManager>
  tools: Arc<ToolRegistry>, plugin_manager: Arc<PluginManager>
  // Intelligence (Arc 共享)
  skills: Arc<SkillRegistry>, memory: Arc<MemoryFacade>
  // 运行时
  mode: AppMode, shutdown_flag: Arc<AtomicBool>
```

### 4.1.2 初始化顺序（由依赖关系决定）

```
Phase 1: Foundation
  paths → config → otel(日志最先) → db + codegraph

Phase 2: Engine
  sandbox → exec_policy → exec
  gateway (注册 providers)
  tools (注册 20 内置工具)
  plugin_manager (discover_and_load → 注册 MCP 工具+Skill+钩子)
  session_manager

Phase 3: Intelligence
  skills (discover_and_load → 扫描目录)
  memory

Phase 4: 创建 AgentLoop
  agent = build AgentLoop with all Arc references
```

### 4.1.3 工厂/消费者分离

`App::create_agent()` 工厂方法——TUI 通过此方法按需创建新 AgentLoop（`/new` 命令、会话切换）。TUI 不直接访问 ToolRegistry 或 Gateway——通过 App 提供的接口操作。

### 4.1.4 运行模式

**Interactive（cabinet）：** TUI 事件循环。TUI 通过 `app.handle_user_message()` / `app.handle_slash_command()` / `app.create_agent()` 操作。

**Headless（cabinet run "prompt"）：** 创建 AgentLoop → 运行 → 等待完成 → 输出到 stdout → 退出。

### 4.1.5 信号处理

```
Ctrl+C ×1：shutdown_flag = true → Agent 优雅停止 → 保存 snapshot → 退出
Ctrl+C ×2（3 秒内）：强制 exit(130)
SIGTERM：同 Ctrl+C ×1
进程崩溃：下次启动自动检测未完成会话 → 标记 Interrupted → 用户可 /resume
```

### 4.1.6 优雅关闭（6 步）

```
1. Agent 停止（最多等待 30s）
2. Session 持久化（最后 snapshot + 标记完成）
3. Sandbox 清理（如果 cleanup_on_exit）
4. Plugin WASM 卸载 + MCP 连接关闭
5. Database 关闭（WAL checkpoint + close）
6. Otel flush
```

### 4.1.7 Binary 入口

CLI 参数支持：`--prompt`（单次执行）、`--config`、`--working-dir`、`--model`、`--sandbox`、`--log-level`、`--log-json`、`--no-plan`。

子命令：`run`、`resume`、`list`、`config`、`skills`、`plugin`、`memory`、`codegraph`、`backup`、`doctor`、`trace`、`version`。

### 4.1.8 启动验证

构造时验证：沙箱匹配配置、gateway 默认模型可用、所有内置工具依赖存在、Skill 的 requires_tools 存在、evaluator model 可用、磁盘空间 > 100MB。

---

# 5. Interface 层

## 5.1 cabinet-tui

ratatui 终端界面。只做渲染，不包含业务逻辑。

### 5.1.1 自适应布局

```
≥120 列：ChatView 65% + Sidebar 35%
≥80 列： ChatView 75% + Sidebar 25%
<80 列： Sidebar 折叠为底部 Tab 切换
```

### 5.1.2 5 个核心组件

| 组件               | 职责                                                                       |
| ------------------ | -------------------------------------------------------------------------- |
| `StatusBar`        | 会话标题、Plan 状态、模型、Turn 计数、Token 用量、今日成本                 |
| `ChatView`         | 消息列表（滚动）、流式渲染、代码块语法高亮、可折叠工具调用、文件引用可点击 |
| `Sidebar`          | Tab: Plan / CodeGraph / Memory / Skills / Diff                             |
| `Composer`         | 输入框、斜杠命令自动补全、历史记录、Readline 键位                          |
| `PermissionDialog` | 审批弹窗——Allow Once / Allow All / Allow & Save / Deny                     |

### 5.1.3 流式渲染回调

```
TuiStreamingCallback:
  on_text → ChatView 追加文本（Markdown 增量渲染）
  on_thinking → StatusBar "🤔 Thinking..."
  on_thinking_done → 恢复正常
  on_tool_call → 创建可折叠工具调用块 "⏳ ..."
  on_tool_result → 更新工具调用块（✓/✗ + 耗时）
  on_plan_updated → Sidebar Plan Tab 更新
  on_error → StatusBar 红色临时消息（3 秒）
```

### 5.1.4 14 个斜杠命令

`/new`、`/resume [id]`、`/model [name]`、`/mode [safe|plan|trusted|everything]`、`/plan`、`/approve`、`/reject [reason]`、`/skills`、`/skill <name>`、`/codegraph`、`/memory [query]`、`/config [key] [value]`、`/clear`、`/doctor`、`/exit`。

### 5.1.5 键盘绑定

Readline 风格（默认）：Ctrl+A/E/K/U/W、Alt+B/F、↑/↓ 浏览历史、Tab 焦点切换/补全。

可选 Vim 模式（未来 feature）。

### 5.1.6 终端恢复（必须）

```
impl Drop for CabinetTui:
  crossterm::terminal::disable_raw_mode()
  crossterm::execute!(stdout, LeaveAlternateScreen)
```

即使 panic 也要执行——通过 panic hook 调用。否则用户终端处于不可用状态。

---

# 附录 A：错误码分配

| 段       | 范围                    | 分配                  |
| -------- | ----------------------- | --------------------- |
| `AGENT`  | AGENT_001 - AGENT_099   | Agent 生命周期错误    |
| `TOOL`   | TOOL_001 - TOOL_099     | 工具注册/执行错误     |
| `GW`     | GW_001 - GW_099         | Gateway/Provider 错误 |
| `EXEC`   | EXEC_001 - EXEC_099     | 命令执行/策略错误     |
| `SBOX`   | SBOX_001 - SBOX_099     | 沙箱错误              |
| `CG`     | CG_001 - CG_099         | CodeGraph 错误        |
| `SESS`   | SESS_001 - SESS_099     | 会话错误              |
| `MEM`    | MEM_001 - MEM_099       | 记忆系统错误          |
| `SKILL`  | SKILL_001 - SKILL_099   | Skill 系统错误        |
| `PLUG`   | PLUG_001 - PLUG_099     | 插件错误              |
| `CONFIG` | CONFIG_001 - CONFIG_099 | 配置错误              |
| `DB`     | DB_001 - DB_099         | 数据库错误            |
| `IO`     | IO_001 - IO_099         | 文件系统错误          |

# 附录 B：性能目标

| 指标                           | 目标    | 对标                            |
| ------------------------------ | ------- | ------------------------------- |
| 启动时间（首帧）               | < 100ms | jcode 14ms, Claude Code 3.4s    |
| 内存基线（单会话）             | < 80MB  | jcode 27.8MB, Claude Code 386MB |
| 每额外会话                     | < 30MB  | jcode +10.4MB                   |
| CodeGraph 索引（10 万行 Rust） | < 5 秒  | codegraph benchmark             |
| LLM 流式首 token               | < 1 秒  | 取决于 Provider                 |
| Session 恢复（100 turn）       | < 250ms | 事件重放                        |
| Turn 事件写入                  | < 2ms   | SQLite WAL                      |

# 附录 C：设计决策速查

| 决策              | 选择                                           | 对标/原因                         |
| ----------------- | ---------------------------------------------- | --------------------------------- |
| 错误系统          | trait-based（方案 A）                          | 保护依赖方向                      |
| 配置覆盖          | 深度合并                                       | 最小化用户负担                    |
| 配置热加载        | app-core 负责                                  | base 保持纯粹                     |
| 错误链 source()   | 暂不加入                                       | 防止过度设计                      |
| ToolResultContent | Text + Diff + Error（3 variant）               | types 稳定性优先                  |
| Provider 格式转换 | 2 个格式适配器（Anthropic + OpenAICompatible） | 行业只有两种 API 格式             |
| Provider 配置     | [[providers]] 列表 + /model 手动切换           | 对标 Claude Code 环境变量方式     |
| 降级链            | 不做——用户手动切换                             | 切模型是用户的决策                |
| Docker 客户端     | bollard crate                                  | 类型安全                          |
| 策略匹配          | 首次匹配停止                                   | 安全策略必须可预测                |
| FTS5 同步         | 同步执行                                       | 记忆写入非高频                    |
| 会话删除          | 硬删除（不可恢复）                             | 对标 Claude Code                  |
| WAL checkpoint    | 被动模式                                       | 默认配置足够                      |
| 事件存储          | JSON blob + event_type 列                      | 访问模式优势                      |
| 快照 N 值         | 20                                             | 恢复 < 10ms                       |
| 插件 WASM ABI     | C ABI                                          | 最广泛语言支持                    |
| Embedding         | 不引入                                         | 条件触发（50+ Skill / 10K+ 记忆） |
| Shell AST 分析    | v0.1.0 不做                                    | ExecPolicy 默认规则已足够         |

---

> 全量细节设计结束。18 个 crate 全部覆盖，与 `cabinet-v3-architecture-final.md` 形成「架构 → 细节」两级文档体系。
> 讨论日期：2026-06-12
