# Cabinet v3 (Rust) — 完整架构设计方案

> 版本：v0.1.0 最终稿
> 定位：聚焦 Coding Agent 场景，从学习项目走向生产级产品
> 语言：Rust
> 设计来源：Cabinet v2 经验 + 7 份对标报告深度分析 + 逐层逐模块讨论
> 讨论日期：2026-06-12

---

## 零、设计宪法 — 11 条不可妥协的原则

| #   | 原则                                                                                                                                                  | 来源                                               |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 1   | **先有场景，后有架构**——每个 crate 必须有明确的"谁在什么时候用它做什么"。不允许"将来可能有用"的代码                                                   | Cabinet v2 杂揉教训                                |
| 2   | **类型/实现分离**——`types` crate（纯类型，零依赖）与实现 crate 分离。合并粒度：3 个 types crate，不追求 jcode 的极端细粒度                            | jcode 70+ crate 验证，合并决策来自讨论             |
| 3   | **依赖单向可校验**——crate 边界 = 架构边界。`cargo deny` 强制执行依赖方向                                                                              | Cabinet v2 `lint:arch`                             |
| 4   | **沙箱是安全底线**——任何 Shell 命令执行必须在沙箱内。DockerSandbox（生产默认）+ BubblewrapSandbox（Linux 原生）+ LocalSandbox（仅 debug）             | DeerFlow + Codex                                   |
| 5   | **CodeGraph 是代码理解的唯一入口**——Agent 不通过 grep/glob/ls 探索代码。符号图已经知道一切。tree-sitter queries 复用社区成果，Rust 重写索引和查询引擎 | codegraph 47.5k★ + benchmark 数据 + 讨论选择方案 C |
| 6   | **窄腰设计**——核心 Agent 循环 + 工具 schema 保持最小（20 个内置工具）。新能力通过 Skill / Plugin / MCP 添加                                           | Claude Code + Hermes                               |
| 7   | **Prompt 缓存不可侵犯**——系统提示词结构以最大化缓存命中率为目标。缓存断点顺序经过精心设计（身份→工具→Skill→项目→记忆）                                | Claude Code + Hermes                               |
| 8   | **事件溯源用于会话**——会话状态从事件流重建。Snapshot 在 TurnCompleted 后触发，N=20。完整审计 + 崩溃恢复 + 精确重放 + 游标分页                         | OpenCode                                           |
| 9   | **Plan Mode 默认开启**——Agent 必须先出计划，用户审批后执行。Plan 和 Build 是同一个 AgentLoop 的两种模式，不是两个独立 Agent                           | Claude Code 验证                                   |
| 10  | **500 行/文件，800 行硬上限**——在 Rust crate 体系中更容易执行                                                                                         | Cabinet v2 规范                                    |
| 11  | **不留骨架**——每个 crate 要么完整实现，要么不创建。不允许"先写个 trait + 空 impl，将来再补"                                                           | 讨论决策                                           |

---

## 一、场景定义

### 1.1 一句话定位

**一个在终端中运行的、极致性能的、安全沙箱化的、内置代码智能的、能自主创建和复用 Skill 的 Coding Agent。**

### 1.2 核心工作流

```
用户描述需求
    │
    ▼
CodeGraph 理解代码库（1 次调用，不是 N 次 grep/read）
    │
    ▼
Plan Mode：Agent 输出计划——它打算做什么、改哪些文件、为什么
    │
    ▼
用户审批 / 修改计划
    │
    ▼
Agent 执行：读写文件（沙箱隔离）、运行命令（ExecPolicy 管控）、验证结果
    │
    ▼
交付。复杂任务 → Agent 自主创建 Skill → 下次同类任务直接用 Skill
```

### 1.3 v3 明确不做的事情

| 不做                                        | 原因                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 项目管理平台（Decision/Workflow）           | v2 的核心能力，但不是 Coding Agent 的场景                                                               |
| IM Bot / 消息网关                           | 终端工具不需要飞书/Slack                                                                                |
| 知识图谱（实体-关系）                       | 代码已经有 CodeGraph，不需要第二个图                                                                    |
| 多 Agent 内阁（Secretary/Curator/Organize） | v3 是单 Agent + 子 Agent，不需要角色扮演                                                                |
| Web UI / 桌面应用                           | 终端优先。未来可加，但不是 v0.1.0                                                                       |
| Server 模式 (cabinet serve)                 | v0.1.0 不做，预留接口                                                                                   |
| Swarm 多 Agent / 文件冲突检测               | v0.1.0 不做                                                                                             |
| Windows Sandbox                             | 支持矩阵 Docker（全平台）+ Bwrap（Linux）。Windows 用户通过 Docker Desktop 获得沙箱。当反馈足够时再引入 |
| 跨 harness 会话导入                         | v0.1.0 不做，SessionManager 预留 `import()` 和 `export()` 接口                                          |
| 本地 ONNX Embedding                         | 条件触发：记忆 >10,000 条 或 Skill >50 个 或用户明确要求语义搜索                                        |

---

## 二、Crate 全景

### 2.1 分层架构

```
                        ┌──────────────────────────────────┐
                        │         cabinet-tui               │  Interface
                        │   (ratatui 终端界面)              │
                        └──────────────┬───────────────────┘
                                       │
                        ┌──────────────┴───────────────────┐
                        │       cabinet-app-core            │  Application
                        │   (CLI + 会话编排 + 工厂/消费者)  │
                        └──────────────┬───────────────────┘
                                       │
        ┌──────────────────────────────┼──────────────────────────────┐
        │                              │                              │
┌───────┴────────┐  ┌─────────────────┴──┐  ┌────────────────────────┴──┐
│ cabinet-agent  │  │  cabinet-skill     │  │  cabinet-memory           │  Intelligence
│  - AgentLoop   │  │   - SkillRegistry  │  │   - ShortTermMemory       │
│  - PlanMode    │  │   - Discovery      │  │   - WriteGate (5-tier)    │
│  - Observer    │  │   - Curator        │  │   - CascadeBuffer         │
│  - Steer       │  │   - SkillGenerator │  │   - LongTermMemory(FTS5)  │
│  - Dispatcher  │  │   - SecurityScan   │  │   - MemoryDecay           │
└───────┬────────┘  └────────┬───────────┘  │   - Sideagent             │
        │                    │               │   - SymbolLinks           │
        │                    │               └────────────┬──────────────┘
        │                    │                            │
        └────────────────────┼────────────────────────────┘
                             │
        ┌────────────────────┼────────────────────────────┐
        │                    │                            │
┌───────┴────────┐  ┌────────┴───────────┐  ┌───────────┴──────────┐
│ cabinet-exec   │  │ cabinet-gateway     │  │ cabinet-sandbox      │  Engine
│  - ExecEngine  │  │  - ApiFormat adapt   │  │  - DockerSandbox     │
│  - ExecPolicy  │  │  - CostTracker      │  │  - BwrapSandbox      │
│  - ShellCmd    │  │  - BudgetGuard      │  │  - LocalSandbox(dev) │
│  - Approval    │  │  - PromptCache      │  │  - PathMapping       │
└───────┬────────┘  │  - Thinking adapter │  │  - FileLock          │
        │           │  - Stream adapter   │  └───────────┬──────────┘
        │           └────────┬────────────┘              │
        │                    │                            │
┌───────┴────────┐  ┌────────┴───────────┐  ┌───────────┴──────────┐
│ cabinet-session│  │ cabinet-tool        │  │ cabinet-plugin       │  Engine
│  - EventSource │  │  - ToolRegistry     │  │  - PluginManager     │
│  - Projector   │  │  - ToolGuard(scope) │  │  - WASM Runtime      │
│  - Checkpoint  │  │  - ToolSearch(FTS)  │  │  - PluginPolicy      │
│  - Fork        │  │  - 20 builtins      │  │  - HookRegistry      │
│  - Import/Exp  │  │  - isConcurrencySafe│  │  - MCP aggregation   │
└───────┬────────┘  └────────┬────────────┘  │  - Skill aggregation  │
        │                    │                └───────────┬──────────┘
        │                    │                            │
        └────────────────────┼────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────────────────┐
│                           Foundation                                     │
│                                                                          │
│  ┌──────────────┐  ┌──────────────────┐  ┌────────────────────────────┐ │
│  │ cabinet-base │  │ cabinet-codegraph│  │ cabinet-types              │ │
│  │  - Error     │  │  - tree-sitter   │  │  agent / tool / session    │ │
│  │  - Config    │  │  - SQLite index  │  │  memory / skill / exec     │ │
│  │  - Paths     │  │  - FTS5 search   │  │  gateway / sandbox         │ │
│  └──────────────┘  │  - file watcher  │  │  permission / codegraph    │ │
│                    │  - explore/impact │  └────────────────────────────┘ │
│                    │  - trace(BFS d=5) │                                 │
│                    └──────────────────┘  ┌────────────────────────────┐ │
│                                          │ cabinet-exec-types         │ │
│  ┌──────────────┐  ┌──────────────────┐  │  ShellCommand / ExecPolicy │ │
│  │cabinet-      │  │ cabinet-otel     │  └────────────────────────────┘ │
│  │storage       │  │  - OTel tracing  │                                 │
│  │  - SQLite    │  │  - tracing 桥接  │  ┌────────────────────────────┐ │
│  │  - Migration │  │  - Perfetto导出  │  │ cabinet-gateway-types      │ │
│  │  - Backup    │  │  - 隐私优先      │  │  ProviderConfig / ModelReq  │ │
│  └──────────────┘  └──────────────────┘  └────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Cargo Workspace 成员

根 `Cargo.toml` 注册所有 18 个 crate：

```toml
[workspace]
members = [
  # Foundation
  "crates/base",
  "crates/types",
  "crates/exec-types",
  "crates/gateway-types",
  "crates/storage",
  "crates/otel",
  "crates/codegraph",

  # Engine
  "crates/exec",
  "crates/gateway",
  "crates/sandbox",
  "crates/session",
  "crates/tool",
  "crates/plugin",

  # Intelligence
  "crates/agent",
  "crates/skill",
  "crates/memory",

  # Application
  "crates/app-core",

  # Interface
  "crates/tui",
]

[workspace.package]
version = "0.1.0"
edition = "2024"
license = "MIT"
repository = "..."

# 所有 crate 共享的依赖版本在此集中管理
[workspace.dependencies]
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
toml = "0.8"
tracing = "0.1"
# ...
```

每个 crate 的 `Cargo.toml` 通过 `path = "..."` 引用 workspace 内部依赖，通过 `workspace = true` 继承公共版本号。

### 2.3 依赖规则

```
cabinet-types            → 无依赖（纯类型，连 cabinet-base 都不依赖）
cabinet-exec-types       → 无依赖
cabinet-gateway-types    → 无依赖
cabinet-base             → 无依赖
cabinet-storage          → cabinet-base
cabinet-otel             → cabinet-base
cabinet-codegraph        → cabinet-base + cabinet-storage + cabinet-types
cabinet-exec             → cabinet-base + cabinet-exec-types + cabinet-sandbox
cabinet-gateway          → cabinet-base + cabinet-gateway-types + cabinet-storage
cabinet-sandbox          → cabinet-base + cabinet-types
cabinet-session          → cabinet-base + cabinet-storage + cabinet-types
cabinet-tool             → cabinet-base + cabinet-types + cabinet-codegraph + cabinet-sandbox + cabinet-exec + cabinet-gateway
cabinet-plugin           → cabinet-base + cabinet-types + cabinet-tool + cabinet-skill + cabinet-sandbox
cabinet-agent            → cabinet-gateway + cabinet-tool + cabinet-codegraph + cabinet-exec + cabinet-sandbox + cabinet-memory + cabinet-skill + cabinet-session
cabinet-skill            → cabinet-base + cabinet-storage + cabinet-types + cabinet-gateway
#                         SkillRepo 持久化 Skill 元数据（usage_count、last_used、status）
cabinet-memory           → cabinet-base + cabinet-storage + cabinet-types + cabinet-gateway
cabinet-app-core         → 所有 Engine + Intelligence crate
cabinet-tui              → cabinet-app-core
```

---

## 三、Foundation 层：逐 crate 详析

### 3.1 `cabinet-base`

**职责：** 整个 workspace 的唯一"根依赖"。错误系统、配置系统、路径系统。

```rust
// 错误系统——trait-based（方案 A），允许下游扩展
pub trait CabinetError: std::error::Error + Send + Sync {
    fn code(&self) -> &'static str;           // "AGENT_001"
    fn severity(&self) -> ErrorSeverity;       // Fatal | Recoverable | Transient
    fn user_message(&self) -> String;
    fn retryable(&self) -> bool;
}

pub enum ErrorSeverity { Fatal, Recoverable, Transient }

// 配置系统——版本化，向前兼容。TOML 格式，~/.cabinet/config.toml
pub struct ConfigV3 {
    pub version: u32,                          // 配置版本号，用于迁移
    pub general: GeneralConfig,
    pub providers: Vec<ProviderConfig>,
    pub agent: AgentConfig,
    pub sandbox: SandboxConfig,
    pub memory: MemoryConfig,
    pub permissions: PermissionsConfig,
    pub telemetry: TelemetryConfig,
    pub codegraph: CodeGraphConfig,
}
// 内置迁移: ConfigV2 → ConfigV3，ConfigV1 → ConfigV2 → ConfigV3
// 密钥通过环境变量引用（api_key_env: "ANTHROPIC_API_KEY"），不存储在配置文件中

// 路径系统——~/.cabinet/ 目录结构
pub struct CabinetPaths {
    pub root: PathBuf,              // ~/.cabinet/
}
// 路径方法:
//   config_file()        → ~/.cabinet/config.toml
//   exec_policy_file()   → ~/.cabinet/execpolicy.toml
//   permissions_file()   → ~/.cabinet/permissions.toml
//   db_file()            → ~/.cabinet/db/cabinet.db (业务数据库)
//   skills_dir()         → ~/.cabinet/skills/
//   logs_dir()           → ~/.cabinet/logs/
//   sandbox_dir()        → ~/.cabinet/sandbox/
//   sessions_dir()       → ~/.cabinet/sessions/
//   plugins_dir()        → ~/.cabinet/plugins/
//   backups_dir()        → ~/.cabinet/backups/
//   project_dir(root)    → {root}/.cabinet/
//   project_codegraph_db(root) → {root}/.cabinet/codegraph.db (项目本地)
//   project_skills_dir(root)   → {root}/.cabinet/skills/
```

### 3.2 `cabinet-types`

**职责：** 合并后的共享类型 crate。所有 trait 定义放在这里，不在实现 crate 中。

```rust
// cabinet-types/src/lib.rs —— 8 个模块，约 1200 行
pub mod agent;       // AgentConfig, PlanStep, AgentEvent, AgentObserver trait
pub mod tool;        // ToolDefinition, ToolResult, ToolCategory, ConcurrencySafety
pub mod session;     // SessionEvent enum (15 variants), SessionState, Projector trait
pub mod memory;      // MemoryEntry, WriteGateTier, Embedding, RelevanceScore
pub mod skill;       // SkillMetadata, SkillEntry, SkillStatus, SkillKind, Author
pub mod codegraph;   // Symbol, Edge, FrameworkRoute, ExploreResult, TraceResult
pub mod permission;  // PermissionRule, PermissionEffect, WildcardPattern
pub mod sandbox;     // SandboxConfig, SandboxProvider trait, PathMapping
```

**关键 trait 位置原则：所有 trait 定义在 types crate，不在 core crate。**

### 3.3 `cabinet-exec-types`

**职责：** 执行相关类型——独立 crate，因为可能被 CI/CD 脚本或外部工具单独依赖。

```rust
// 约 150 行
pub struct ShellCommand;     // 类型安全的命令构造（非裸字符串）
pub struct ExecPolicy;       // 声明式策略引擎
pub struct ExecRule;         // pattern + effect + reason + priority
pub enum ExecEffect;         // Allow | Deny | AskUser
pub enum ExecPattern;        // Exact | Prefix | Glob | Program
pub enum PolicyDecision;     // Allow | Deny { reason } | AskUser { reason }
```

### 3.4 `cabinet-gateway-types`

**职责：** Gateway 相关类型——独立 crate，因为 Provider 开发者只需依赖此 crate。

```rust
// 约 150 行
pub struct ProviderConfig;    // name, api_key_env, base_url, default_model, models
pub struct ModelRequest;      // model, system_prompt, messages, tools, temperature, max_tokens
pub struct ModelResponse;     // content, tool_calls, usage, finish_reason
pub struct TokenUsage;        // prompt_tokens, completion_tokens, cache_read_tokens, cache_write_tokens
pub struct ModelInfo;         // name, display_name, context_length, supports_thinking, supports_vision
pub enum StreamChunk;         // Text | Thinking | ThinkingDone | ToolCall | Done | Error
```

### 3.5 `cabinet-storage`

**职责：** SQLite 持久化——连接管理、迁移、Repository 层、备份。

```rust
pub struct Database {
    conn: Connection,         // rusqlite, WAL mode
}

impl Database {
    pub fn open(path: &Path) -> Result<Self>;     // 自动执行迁移
    pub fn migrate(&self) -> Result<()>;           // 顺序迁移，不可逆
    pub fn backup(&self, dest: &Path) -> Result<()>;
    pub fn verify_integrity(&self) -> Result<bool>;
}

// Repository 层——基于 &'a Connection 的生命周期绑定
pub struct SessionRepo<'a> { conn: &'a Connection }
pub struct MemoryRepo<'a> { conn: &'a Connection }
pub struct CheckpointRepo<'a> { conn: &'a Connection }
pub struct SkillRepo<'a> { conn: &'a Connection }
pub struct PermissionRepo<'a> { conn: &'a Connection }
pub struct CostRepo<'a> { conn: &'a Connection }

// 两个独立数据库:
//   ~/.cabinet/db/cabinet.db    → 业务数据（会话、记忆、Skill、权限、成本）
//   {project}/.cabinet/codegraph.db → CodeGraph 索引（项目本地，可删除重建）
```

**迁移系统：** `_migrations` 表追踪已执行的迁移。版本号只增不减。不做 down 迁移。

### 3.6 `cabinet-otel`

**职责：** OpenTelemetry 可观测性——Traces、Metrics、Logs。

```rust
pub struct OtelGuard {
    _tracer_provider: TracerProvider,
    _logger_guard: LoggerGuard,
    _tracing_guard: TracingOpentelemetryGuard,  // tracing → OTel 桥接
}

impl OtelGuard {
    pub fn init(config: &TelemetryConfig) -> Result<Self>;
    // 初始化时自动设置 tracing-opentelemetry 桥接——
    // tokio::spawn, rusqlite::execute, reqwest::get 的 span
    // 自动转换为 OTel span，纳入 trace 树。零手动埋点。

    pub fn flush(&self);
    // Drop 时自动 flush。进程崩溃时尽力 flush（通过 panic hook）

    pub fn export_perfetto(&self, session_id: &SessionId) -> Result<PathBuf>;
    // 将当前会话的 trace 导出为 Perfetto JSON 格式
    // 用户可拖入 https://ui.perfetto.dev 可视化分析
    // 非默认行为——用户主动调用 'cabinet trace export --session xxx'
}

pub struct TelemetryConfig {
    pub enabled: bool,                      // 默认 true（仅本地文件）
    pub log_level: LogLevel,                // 默认 Info
    pub otlp_endpoint: Option<String>,      // 默认 None（不发送到外部）
    pub record_prompt_content: bool,        // 默认 false——隐私优先
    pub record_tool_args: bool,             // 默认 false
    pub record_file_location: bool,         // 是否在 span 中记录源文件位置
}
```

**Span 结构：**

```
Session root span (session_id, project_path, model, start_time)
  ├── Turn span (turn_id, step_number)
  │     ├── reqwest::connect              ← tracing 桥接自动
  │     ├── reqwest::send_request         ← tracing 桥接自动
  │     ├── LLM call span                 ← 手动
  │     ├── rusqlite::execute             ← tracing 桥接自动 (codegraph查询)
  │     ├── Tool call span                ← 手动
  │     │     └── tokio::process::wait    ← tracing 桥接自动 (bash)
  │     └── Tool call span
  ├── Compaction span
  └── CodeGraph index span
```

### 3.7 `cabinet-codegraph`

**职责：** 内置代码智能——tree-sitter 解析 + SQLite 索引 + 文件监控。

**技术路线：方案 C——复用 codegraph 社区的 tree-sitter queries（`.scm` 文件，与实现语言无关），用 Rust 重写索引和查询引擎。**

```rust
pub struct CodeGraphIndex {
    db: Database,                          // 独立 SQLite——项目本地的 .cabinet/codegraph.db
    parser: TreeSitterParser,              // 多语言 tree-sitter parser
    watcher: FileWatcher,                  // inotify / FSEvents / ReadDirectoryChanges
    config: CodeGraphConfig,
}

impl CodeGraphIndex {
    // ── 索引 ──
    pub fn open_or_create(db_path: &Path, config: &CodeGraphConfig) -> Result<Self>;
    pub fn index_project(&mut self, root: &Path) -> Result<IndexStats>;
    pub fn incremental_update(&mut self, changed_files: &[PathBuf]) -> Result<()>;
    pub fn watch(&self, debounce_ms: u64) -> Result<()>;  // 默认 2s 去抖动
    pub fn reindex(&mut self) -> Result<IndexStats>;       // 强制重建

    // ── 探索（Agent 主要入口）──
    pub fn explore(&self, query: &str) -> Result<ExploreResult>;

    // ── 精确查询 ──
    pub fn search(&self, query: &str, kind: Option<SymbolKind>, limit: usize) -> Result<Vec<Symbol>>;
    pub fn callers(&self, symbol: &str, limit: usize) -> Result<Vec<CallSite>>;
    pub fn callees(&self, symbol: &str, limit: usize) -> Result<Vec<CallSite>>;

    // ── 影响分析 ──
    pub fn impact(&self, symbol: &str, depth: u8) -> Result<ImpactResult>;

    // ── 路径追踪 ──
    // 实现: 内存 BFS，max_depth 默认 5
    // 不在 v0.1.0 做预计算路径缓存
    pub fn trace(&self, from: &str, to: &str, max_depth: u8) -> Result<TraceResult>;

    // ── 文件与路由 ──
    pub fn files(&self, path: Option<&Path>) -> Result<FileTree>;
    pub fn routes(&self, framework: Option<Framework>) -> Result<Vec<FrameworkRoute>>;

    // ── 元信息 ──
    pub fn status(&self) -> Result<IndexStatus>;
    pub fn languages(&self) -> Vec<LanguageStats>;
}
```

**关键设计决策：**

- SQLite + FTS5——零外部服务依赖
- 自动索引——打开项目目录时自动扫描。跳过 `.gitignore` + `node_modules` + `target` + `dist`
- 语言覆盖：Rust + TypeScript + Python + Go，通过 Cargo feature flags 按需编译，后续扩展到 codegraph 支持的 20+ 语言

  ```toml
  # codegraph/Cargo.toml
  [features]
  default = ["lang-rust", "lang-typescript", "lang-python", "lang-go"]
  lang-rust = ["tree-sitter-rust"]
  lang-typescript = ["tree-sitter-typescript", "tree-sitter-tsx"]
  lang-python = ["tree-sitter-python"]
  lang-go = ["tree-sitter-go"]
  # 后续扩展: lang-java, lang-csharp, lang-kotlin, lang-swift, lang-ruby...
  ```

  用户只需 Rust + TypeScript 时可以关闭不需要的 parser，减小编译时间和二进制体积

- `explore()` 替代 grep + glob + ls + read_file(探索)，一次调用满足 80% 代码理解场景
- `trace()` 使用内存 BFS，max_depth 默认 5。在 10 万符号的图中，深度 5 的双向 BFS 通常在 10ms 内完成
- 不引入 codegraph-rust 的 Agentic 分析（LATS/ReAct/Reflexion）——那是 Agent 层的职责，不是 CodeGraph 基础设施层的职责

---

## 四、Engine 层：逐 crate 详析

### 4.1 `cabinet-exec`

**职责：** 命令执行引擎——不是 Agent 的一个工具文件，而是独立的执行管道。

```rust
pub struct ExecEngine {
    sandbox: Arc<dyn SandboxProvider>,
    policy: Arc<RwLock<ExecPolicy>>,
    approval_handler: Option<Arc<dyn ApprovalHandler>>,
}

impl ExecEngine {
    /// 执行命令——完整的策略→审批→沙箱管道
    pub async fn execute(&self, cmd: &ShellCommand) -> Result<ExecOutput>;
    pub fn reload_policy(&self) -> Result<()>;
    pub fn policy(&self) -> PolicySnapshot;
}
```

**ShellCommand——类型安全的命令构造（非裸字符串拼接）：**

```rust
let cmd = ShellCommand::new("git")
    .arg("commit")
    .arg("-m")
    .arg("fix: update auth")
    .working_dir(project_root)
    .timeout(Duration::from_secs(30));
// 沙箱层接收 (program, args[]) 元组，不需要 shell 解析
```

**ExecPolicy——声明式策略引擎：**

```rust
pub struct ExecPolicy {
    pub version: u32,
    pub rules: Vec<ExecRule>,   // 按 priority 从高到低匹配
}

pub struct ExecRule {
    pub pattern: ExecPattern,   // Exact | Prefix | Glob | Program
    pub effect: ExecEffect,     // Allow | Deny | AskUser
    pub reason: String,         // 面向用户的解释
    pub priority: u32,          // 数字越大越优先
}

// 内置默认策略（来自对标项目的最佳实践）:
//   rm -rf /, dd, mkfs → Deny (priority=1000)
//   cargo build/test/clippy → Allow (priority=100)
//   git status/diff/log → Allow (priority=100)
//   curl/wget → AskUser (priority=50)
//   cargo/npm publish → AskUser (priority=200)
//   默认 → Allow (priority=0)
// 用户自定义: ~/.cabinet/execpolicy.toml
// 合并规则: 用户规则覆盖默认规则（相同 pattern+相同 priority → 用户规则覆盖）
```

**ApprovalHandler——审批回调：**

```rust
#[async_trait]
pub trait ApprovalHandler: Send + Sync {
    async fn request_approval(&self, cmd: &ShellCommand, reason: &str) -> Result<bool>;
    fn is_interactive(&self) -> bool;
}

// TUI 模式: 弹出审批弹窗
// 非交互模式 (cabinet run): NonInteractiveApprovalHandler——始终拒绝
```

**v0.1.0 不做 Shell AST 分析（readOnlyValidation 等）。** ExecPolicy 的默认规则已经人工分类了常见命令的读/写属性。当用户反馈"审批太多了"时再引入。

### 4.2 `cabinet-gateway`

**职责：** LLM 网关——API 格式适配 + 成本控制 + Prompt 缓存。不做 Provider 路由和故障转移——那是用户的决策。

**设计哲学——参考 Claude Code 的极简 API 配置：** Claude Code 本身只认一种 API 格式，切换后端靠改环境变量（`ANTHROPIC_BASE_URL` + `ANTHROPIC_MODEL`），不靠代码里的 Provider 抽象。整个行业只有两种 API 格式——Anthropic Messages API 和 OpenAI Chat Completions。Cabinet 采用同样的思路：两个格式适配器覆盖所有后端，用户通过配置文件声明多个后端、运行时通过 `/model` 手动切换。

```
gateway/src/
  lib.rs                    → Gateway struct
  format/
    anthropic.rs            → Anthropic Messages API 格式
    openai_compatible.rs    → OpenAI Chat Completions 格式（覆盖 90%+ Provider）
  client.rs                 → 统一 HTTP 客户端（reqwest，超时/重试/TLS）
  cost.rs                   → CostTracker
  budget.rs                 → BudgetGuard（仅告警，不自动切换模型）
  rate_limit.rs             → RateLimitTracker
  prompt_cache.rs           → Prompt 缓存策略（仅 Anthropic 格式）
  thinking.rs               → Thinking 适配（Anthropic 原生 / OpenAI extra_body）
  stream.rs                 → 流式解析（两种 SSE 格式 → 统一 StreamChunk）
  model.rs                  → ModelInfo, ModelRequest, ModelResponse
```

**多 Provider 配置——配几个用几个，手动切换：**

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
```

```rust
pub struct Gateway {
    providers: HashMap<String, ProviderHandle>,  // 用户配了几个就是几个
    active: String,                               // 当前使用的 provider name
    cost_tracker: Arc<CostTracker>,
    budget_guard: Arc<BudgetGuard>,
    rate_limit_tracker: Arc<RateLimitTracker>,
}

struct ProviderHandle {
    name: String,
    client: HttpClient,              // 共享的 reqwest Client
    format: ApiFormat,               // Anthropic | OpenAICompatible
    config: ProviderConfig,          // base_url, api_key, model
    rate_limit: RateLimitStatus,
}

enum ApiFormat {
    Anthropic,                       // Messages API
    OpenAICompatible,                // Chat Completions API
}
```

**切换方式：**

- TUI 中 ` /model` 列出所有已配置 Provider，`/model deepseek` 切换
- CLI `cabinet --provider deepseek` 或 `cabinet --model gpt-4o`
- 同一时刻只有一个活跃 Provider。没有降级链——当前 Provider 失败时通知用户，由用户决定是否切换。

**Prompt 缓存策略——来自 Claude Code 和 Hermes 的铁律：**

```
缓存断点顺序（精心设计，确保最大缓存命中率）:

[SystemPromptHead]   ← cache_control breakpoint (Persistent——跨会话缓存)
  ...身份 + 通用指令...
[ToolCatalog]        ← cache_control breakpoint (SessionScoped)
  ...工具目录（名称+描述，~50 tokens/个）...
[SkillIndex]         ← cache_control breakpoint (SessionScoped)
  ...匹配的 Skill L1 索引...
[ProjectContext]     ← cache_control breakpoint (SessionScoped)
  ...项目结构 + CodeGraph 状态 + 规则...

── 以下内容不缓存 (PerTurn) ──
[MemorySnapshot]     ← 每 turn 变化的记忆快照
[Turn metadata]      ← 时间戳 + session ID
```

**缓存失效场景（invalidate 调用时机）：**

- Skill 变更（`/skills reload`, Agent 创建新 Skill）
- 项目切换
- 工具集变更（Plugin 安装/卸载——MCP 工具变化）
- 上下文压缩（旧消息被 LLM 摘要替代）

**流式优先原则——来自 Claude Code + Hermes：** 即使没有消费者也使用流式。节省 TTFT（首个 Token 时间），流中断可触发重试。

**成本控制——保留 Cabinet v2 的优势，精简为全局追踪：**

```rust
// CostTracker: 所有 Provider 统一计费。
//   - 定价来自编译时嵌入的静态表 + 用户自定义（~/.cabinet/pricing.toml）
//   - 缓存命中折扣（Anthropic cache_read: prompt 价格的 10%）
//   - record() 中同步写入 CostRepo——不依赖 OtelGuard::flush()
//     原因: 进程崩溃时成本数据不应丢失
//   - 日/周/月累计 + 总计

// BudgetGuard: 4 级预算状态。仅告警和阻止，不自动切换模型。
//   ok → warning(80%) → critical(95%) → blocked(100%)
//   预算耗尽时 Agent 停止并通知用户。用户可手动调整限额或切换更便宜的 Provider。

// RateLimitTracker: 解析 HTTP 响应头
//   x-ratelimit-* 和 anthropic-ratelimit-* 头
//   速率限制命中时等待后重试，不触发 Provider 切换。
```

### 4.3 `cabinet-sandbox`

**职责：** 沙箱隔离——Agent 与文件系统和进程之间的唯一桥梁。

```rust
#[async_trait]
pub trait SandboxProvider: Send + Sync {
    // 命令执行
    async fn execute(&self, cmd: &ShellCommand) -> Result<ExecOutput>;

    // 文件操作
    async fn read_file(&self, path: &Path) -> Result<String>;
    async fn write_file(&self, path: &Path, content: &str) -> Result<()>;
    async fn list_dir(&self, path: &Path) -> Result<Vec<DirEntry>>;
    async fn file_info(&self, path: &Path) -> Result<FileInfo>;
    async fn glob(&self, pattern: &str) -> Result<Vec<PathBuf>>;
    async fn grep(&self, pattern: &str, path: &Path) -> Result<Vec<GrepMatch>>;

    // 路径映射——Agent 看到虚拟路径，沙箱映射到物理路径
    fn resolve_path(&self, virtual_path: &Path) -> PathBuf;

    // 网络控制——shell 执行时自动禁用网络
    fn network_enabled(&self) -> bool;
    async fn set_network_enabled(&self, enabled: bool) -> Result<()>;

    // 生命周期
    async fn cleanup(&self) -> Result<()>;
    fn provider_name(&self) -> &'static str;
    fn isolation_level(&self) -> IsolationLevel;
}
```

**三种实现：**

| 实现                | 平台                                     | 隔离级别        | 适用场景                       |
| ------------------- | ---------------------------------------- | --------------- | ------------------------------ |
| `DockerSandbox`     | Linux + macOS + Windows (Docker Desktop) | 容器            | 生产默认                       |
| `BubblewrapSandbox` | Linux only (需 bwrap)                    | 进程 + 命名空间 | Linux 原生，无需 Docker daemon |
| `LocalSandbox`      | 所有 (仅 `#[cfg(debug_assertions)]`)     | 无——路径白名单  | 本地开发和调试                 |

**虚拟路径映射——来自 DeerFlow：**

```
Agent 看到的路径 → 沙箱内的物理路径
/mnt/workspace  → ~/.cabinet/sandbox/{session_id}/workspace (ReadWrite)
/mnt/outputs    → ~/.cabinet/sandbox/{session_id}/outputs   (ReadWrite)
/mnt/skills     → ~/.cabinet/skills/                         (ReadOnly)
/mnt/project    → {项目根目录}                                (ReadOnly)
```

**文件写入并发安全——来自 DeerFlow 的 file_operation_lock：**

```rust
pub struct FileOperationLock {
    locks: HashMap<String, Arc<tokio::sync::Mutex<()>>>,
}
// 按 (sandbox_id, path) 键串行化写操作
// str_replace: 原子化的 read-modify-write（获取锁→读→替换→写→释放锁）
```

### 4.4 `cabinet-session`

**职责：** 事件溯源会话——准入、执行、投影、恢复、分叉。

```rust
pub enum SessionEvent {
    Created        { id, project_path, model, codegraph_indexed, timestamp },
    PromptSubmitted { msg_id, content, delivery, timestamp },
    TurnStarted    { turn_id, timestamp },
    ModelResponded { turn_id, content, tool_calls, usage, model, timestamp },
    ToolExecuted   { turn_id, call_id, name, args, result, duration_ms, timestamp },
    TurnCompleted  { turn_id, timestamp },
    CompactionHappened { messages_before, messages_after, summary_generated, timestamp },
    PlanApproved   { plan_id, steps, timestamp },
    PlanRejected   { plan_id, reason, timestamp },
    PlanStepCompleted { plan_id, step_id, timestamp },
    ModelSwitched  { from, to, reason, timestamp },
    TitleChanged   { title, timestamp },
    Interrupted    { source, timestamp },
    Resumed        { from_event, timestamp },
}

pub struct SessionState {
    pub messages: Vec<Message>,
    pub turn_count: u32,
    pub total_tokens: TokenUsage,
    pub title: Option<String>,
    pub model: String,
    pub plan: Option<ActivePlan>,
    pub status: SessionStatus,
    pub last_event_index: usize,
}

pub trait Projector {
    fn apply(&mut self, event: &SessionEvent) -> Result<()>;
    fn snapshot(&self) -> SessionState;
}

pub struct SessionManager {
    event_store: Arc<SessionRepo>,
    projector: SessionProjector,
    snapshot_interval: usize,          // N=20——每 20 个事件创建 snapshot
    compaction_threshold: f64,         // 0.75——token 利用率阈值
}
```

**关键设计决策：**

1. **事件溯源只用于会话。** Memory/Tool/Skill 用传统 CRUD + 版本号
2. **两阶段准入协议：** `admit_prompt()` 先持久化 `PromptSubmitted` 事件 → 调用者随后 `resume()` 触发执行。用户消息在 LLM 调用前已持久化
3. **Snapshot 只在 TurnCompleted 后触发。** 不在 turn 执行中途做 snapshot。崩溃恢复时总是回到最后一个完整 turn 之后
4. **N=20。** 在 50 turn 会话中，崩溃恢复最多重放 19 个事件。每次 snapshot 写入成本远低于 LLM 调用的网络延迟
5. **游标分页。** `list()` 使用 `(id, timestamp)` 复合游标，适用于无限滚动
6. **Fork 能力。** 从任意事件位置分叉创建新会话
7. **幂等 prompt 提交。** 相同 (session_id, msg_id, content, delivery) → 检测冲突，返回已有结果
8. **Import/Export 接口预留。** 方法已定义，v0.1.0 不实现

### 4.5 `cabinet-tool`

**职责：** 工具注册表——注册、发现、执行、生命周期管理。

```rust
pub struct ToolRegistry {
    tools: HashMap<String, ToolEntry>,
    search_index: ToolSearchIndex,   // FTS5 工具搜索
    generation: u64,                 // 注册表版本——每次变更递增
}

struct ToolEntry {
    definition: ToolDefinition,
    handler: Arc<dyn ToolHandler>,
    scope_token: Option<Arc<()>>,    // ToolGuard 关联
    feature_gate: Option<&'static str>,
    disallowed_for: Vec<AgentType>,
}

// ToolGuard——作用域化的工具生命周期
// Drop 时自动从注册表中移除所有通过此 guard 注册的工具
// 来自 OpenCode 的 Effect.addFinalizer 模式
pub struct ToolGuard { ... }
impl Drop for ToolGuard { ... }
```

**工具定义：**

```rust
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: JsonSchema,
    pub category: ToolCategory,           // ReadOnly | LightWrite | Exec | Destructive | Costly
    pub is_concurrency_safe: bool,        // 运行时属性——不是硬编码 Set
    pub requires_approval: Option<ApprovalReason>,
    pub source: ToolSource,               // Builtin | Skill | Plugin | MCP
}
```

**内置工具（22 个）——全部注入 prompt，对标 Claude Code：**

Claude Code 将全部工具（30+ 内置 + MCP）注入系统提示词，Agent 永远知道自己的全部能力。Cabinet 采用相同策略：21 个工具全部注入，`~50 tokens/个 = ~1050 tokens`，位于缓存断点内，仅在工具集变更时重新缓存。

| 工具                | 类别       | 并发安全 | 说明                                          |
| ------------------- | ---------- | -------- | --------------------------------------------- |
| `codegraph_explore` | ReadOnly   | ✅       | Agent 最主要的代码探索入口                    |
| `codegraph_search`  | ReadOnly   | ✅       | 精确符号查找                                  |
| `codegraph_callers` | ReadOnly   | ✅       | 调用者分析                                    |
| `codegraph_callees` | ReadOnly   | ✅       | 被调用者分析                                  |
| `codegraph_impact`  | ReadOnly   | ✅       | 影响分析                                      |
| `codegraph_trace`   | ReadOnly   | ✅       | 路径追踪                                      |
| `read_file`         | ReadOnly   | ✅       | 读取完整文件                                  |
| `write_file`        | LightWrite | ❌       | 创建/覆写文件                                 |
| `edit_file`         | LightWrite | ❌       | 精确编辑（old_string→new_string）             |
| `apply_patch`       | LightWrite | ❌       | 流式 patch 应用                               |
| `glob`              | ReadOnly   | ✅       | 文件模式匹配                                  |
| `grep`              | ReadOnly   | ✅       | 文本内容搜索                                  |
| `bash`              | Exec       | ❌       | 沙箱化 shell 命令                             |
| `web_fetch`         | Costly     | ✅       | 获取文档/API 参考                             |
| `web_search`        | Costly     | ✅       | 搜索解决方案                                  |
| `task`              | Exec       | ❌       | 生成子代理（Explore/Verify/GeneralPurpose）   |
| `workflow`          | Exec       | ❌       | 多阶段子代理编排（pipeline/barrier/loop）     |
| `todo_write`        | LightWrite | ✅       | Plan Mode 任务跟踪                            |
| `skill_invoke`      | ReadOnly   | ✅       | 调用 Skill                                    |
| `skill_create`      | LightWrite | ❌       | Agent 自主创建 Skill                          |
| `memory`            | ReadOnly   | ✅       | 统一记忆入口 (action=search/save/delete/list) |
| `ask_user`          | ReadOnly   | ✅       | Agent 向用户提问                              |

全部 22 个工具注入 ToolCatalog fragment（priority=10），~1100 tokens。MCP 工具（来自 Plugin）同样注入。工具集变更时 PromptAssembler 失效 ToolCatalog 缓存——对标 Claude Code 的 `assembleToolPool()` 缓存策略。

### 4.6 `cabinet-plugin`

**职责：** 插件管理器——WASM 运行时 + MCP/Skill 聚合 + 生命周期管理。

```rust
pub struct PluginManager {
    plugins: HashMap<String, LoadedPlugin>,
    load_order: Vec<String>,
    hook_registry: HashMap<HookEvent, Vec<HookEntry>>,
    wasm_engine: wasmtime::Engine,
}

impl PluginManager {
    pub async fn discover_and_load(&mut self, plugins_dir: &Path) -> Result<Vec<PluginLoadResult>>;
    pub async fn install(&mut self, source: PluginSource) -> Result<()>;
    pub async fn uninstall(&mut self, name: &str) -> Result<()>;
    pub async fn reload(&mut self, name: &str) -> Result<PluginLoadResult>;
    pub fn list(&self) -> Vec<PluginInfo>;
    pub fn hooks_for(&self, event: &HookEvent) -> Vec<&HookEntry>;
}
```

**插件类型：**

```rust
pub enum PluginKind {
    Provider,    // 注册 LLM Provider——通过 gateway 的 Provider trait
    Tool,        // 注册自定义工具——WASM 模块实现 ToolHandler
    Skill,       // 注册 Skill 包——调用 SkillRegistry
    Command,     // 注册斜杠命令——调用 CommandRegistry
    Hook,        // 注册生命周期钩子——调用 HookRegistry
}
```

**WASM 运行时：**

```rust
// install() 时编译和验证 WASM 模块，但延迟执行 _start()
// 无效的 WASM 在安装时即被发现

// 宿主导出给 WASM 插件的函数:
//   - register_tool(name, description, schema)
//   - register_hook(event, priority)
//   - register_skill(skill_dir)
//   - log(level, message)
//   - http_request(method, url, headers, body) → response (受 PluginPolicy 控制)

// PluginPolicy 安全约束 (~/.cabinet/plugin_policy.toml):
//   [wasm_limits]
//   max_memory_bytes = 134_217_728     # 128 MB
//   max_execution_time_ms = 30_000     # 30 秒
//   fuel = 10_000_000                  # wasmtime fuel（指令数限制）
//   [wasm_capabilities]
//   allow_network = true
//   allow_filesystem = false
//   allow_subprocess = false
```

**插件清单格式：**

```toml
# ~/.cabinet/plugins/postgres-tools/plugin.toml
[plugin]
name = "postgres-tools"
version = "0.1.0"
description = "PostgreSQL database integration"
kind = "Tool"

[[mcp]]
name = "postgres"
config = "./mcp.json"

[[skills]]
source = "./skills/sql-review/"

[[skills]]
source = "agentskills.io/nousresearch/sql-optimization"
version = ">=1.0,<2.0"

[[hooks]]
event = "SessionStart"
description = "Verify database connectivity"
```

**插件不包含可执行代码时（仅引用 MCP + Skill）：** 纯声明式，无需 WASM。`plugin.toml` + MCP 配置 + Skill 文件。

**插件包含可执行代码时（注册自定义 Tool 或 Hook）：** WASM 模块 + `plugin.toml`。

**Plugin → ToolRegistry 注入接口：** WASM 插件通过宿主导出的 `register_tool()` 函数将工具注册到 `ToolRegistry`。`PluginManager::install()` 在加载 WASM 模块后调用 `_start()`，插件在 `_start()` 中调用宿主导出函数声明自己的能力。`ToolRegistry::register_scoped()` 返回的 `ToolGuard` 绑定到此插件的 scope token——插件卸载时（`PluginManager::uninstall()`），关联的 `ToolGuard` 被 drop，工具自动从注册表注销。

**Plugin → SkillRegistry 注入接口：** 同样通过宿主导出的 `register_skill()` 函数。Plugin 卸载时，来源于此插件的所有 Skill 从 `SkillRegistry` 移除。被移除的 Skill 中如果有 `created_by = Author::Agent` 的——用户在 Skill 基础上自主创建的——不被移除。

**Plugin → HookRegistry 注入接口：** 宿主导出 `register_hook(event, priority)`。Plugin 卸载时，关联的钩子从 `HookRegistry` 注销。

---

## 五、Intelligence 层：逐 crate 详析

### 5.1 `cabinet-agent`

**职责：** Agent 主执行引擎——AgentLoop + PlanMode + Observer Pipeline + Steer + 工具分发 + **提示词工程 + 上下文管理 + Harness 质量免疫系统**。

**目录结构：**

```
agent/
  src/
    agent_loop.rs        → 主执行循环
    plan_mode.rs         → Plan Mode 切换
    observer.rs          → Observer Pipeline
    steer.rs             → Steer 机制
    workflow/            → Workflow 子代理编排
      mod.rs             → WorkflowExecutor
      pipeline.rs        → pipeline 模式
      barrier.rs         → barrier 模式
      loops.rs           → loop-until-count / loop-until-budget / loop-until-dry
      persistence.rs     → 保存/加载 workflow definition
    prompts/             → 系统提示词文件
      plan_mode.md         → Plan Agent 专用
      build_mode.md        → Build Agent 专用
      explore.md           → Explore 子代理专用（对标 exploreAgent）
      verify.md            → Verify 子代理专用（对标 verificationAgent）
      general_purpose.md   → GeneralPurpose 子代理专用（对标 generalPurposeAgent）
      workflow_guidance.md → Workflow 使用指导
      code_exploration.md
      skill_guidance.md
      memory_guidance.md
      compaction.md
      model_guidance/    → 模型专属指令（来自 Hermes + DeerFlow）
        anthropic.md
        openai.md
        google.md
    context/             → 上下文管理系统
      mod.rs
      assembler.rs       → 提示词组装管道
      monitor.rs         → Token 估算 + 阈值检测
      compressor.rs      → 4 阶段压缩 + post-compact 附件
      injector.rs        → 记忆 / Skill / CodeGraph 注入
    harness/             → 质量免疫系统（来自 Cabinet v2）
      mod.rs
      evaluator.rs       → LLM 输出评分
      quality_gate.rs    → HEI 结构完整性检查
      auto_adjuster.rs   → 自动调参
      preference.rs      → 用户偏好学习
      analyst.rs         → 每日元分析
      failure_analyzer.rs → 失败模式分析
```

### 5.1.1 提示词工程：`prompts/` + `context/assembler.rs`

**对标设计：** Claude Code 的三级缓存（Stable/Context/Volatile）+ cache_control breakpoint。Hermes 的环境感知 + 模型专属指令 + 平台感知。DeerFlow 的模板变量注入。

**组装管道：**

```rust
// context/assembler.rs

pub struct PromptAssembler {
    fragments: Vec<PromptFragment>,
    cache_key: Option<String>,          // 整体缓存键——用于 Anthropic cache_control
}

pub struct PromptFragment {
    pub content: String,
    pub source: FragmentSource,
    pub cache_ttl: CacheTTL,            // Persistent | SessionScoped | PerTurn
    pub priority: u8,                   // 注入顺序（数字越小越靠前）
}

pub enum FragmentSource {
    Identity,            // SOUL.md + 通用指令（prompts/build_mode.md）
    EnvironmentHint,     // OS/Shell/WSL/Docker 感知（来自 Hermes）
    ModelGuidance,       // 模型专属指令（prompts/model_guidance/）
    PlatformHint,        // 平台适配——TUI vs 非交互模式的指令差异
    ToolCatalog,         // 工具目录（名称+描述，~50 tokens/个）
    SkillIndex,          // 匹配的 Skill L1 索引
    ProjectContext,      // 项目结构 + CodeGraph 状态 + .cabinet/rules/
    MemorySnapshot,      // 记忆快照（来自 MemoryFacade）
    PlanState,           // 当前 Plan 的状态
    SteerChannelNote,    // Steer 机制格式约定（来自 Hermes）
}

pub enum CacheTTL {
    Persistent,          // 跨会话缓存——身份 + 模型指令
    SessionScoped,       // 会话内缓存——工具目录 + Skill 索引 + 项目上下文
    PerTurn,             // 每 turn 刷新——记忆 + Plan 状态 + 时间戳
}

pub struct AssemblyContext {
    pub mode: AgentMode,                // PlanMode | BuildMode
    pub model: String,
    pub agent_type: AgentType,
    pub environment: EnvironmentInfo,   // OS, shell, cwd, WSL, Docker detection
    pub available_tools: Vec<String>,
    pub matched_skills: Vec<String>,
    pub memory_snapshot: Option<String>,
    pub plan: Option<ActivePlan>,
}

impl PromptAssembler {
    /// 根据上下文组装完整系统提示词
    ///
    /// 组装顺序（由 priority 决定）。Fragment 分为两个预算层级:
    ///
    /// Tier 1 — 不可削减（上下文再紧张也保留）:
    ///   1. Identity (priority=1, Persistent)
    ///   2. EnvironmentHint (priority=2, SessionScoped)
    ///   3. ModelGuidance (priority=3, Persistent)
    ///   4. PlatformHint (priority=4, SessionScoped)
    ///   5. 代码探索协议 (priority=5, Persistent)
    ///   6. ToolCatalog (priority=10, SessionScoped)
    ///   11. PlanState (priority=31, PerTurn)
    ///   12. SteerChannelNote (priority=40, SessionScoped)
    ///
    /// Tier 2 — 弹性（利用率升高时逐步削减，>90% 时全部归零）:
    ///   7. SkillIndex (priority=11, SessionScoped)  — 20→10→5→pinned only
    ///   8. ProjectContext (priority=12, SessionScoped) — 5000→3000→1000 tokens
    ///   9. Skill L2 body (priority=20, SessionScoped) — 4000→2000→0 tokens
    ///   10. MemorySnapshot (priority=30, PerTurn)     — 5条→3条→1条→0
    ///
    ///   —— Persistent + SessionScoped 片段以上由 cache_control 覆盖 ——
    ///
    /// 配额由 ContextBudget::allocate_budget() 在每 turn 开始前计算。
    pub fn assemble(&self, ctx: &AssemblyContext, budget: &ContextBudget) -> String;

    /// 计算当前系统提示词的缓存键
    /// 只有当缓存键变化时才重新发送系统提示词
    pub fn cache_key(&self) -> Option<&str>;

    /// 标记特定来源的片段失效——下次 assemble() 时重新计算
    /// 调用时机: Skill 变更、项目切换、工具集变更、上下文压缩
    pub fn invalidate(&mut self, source: FragmentSource);
}

/// 环境感知——来自 Hermes 的 build_environment_hints()
pub struct EnvironmentInfo {
    pub os: String,                    // "linux" | "macos" | "windows"
    pub shell: String,                 // "bash" | "zsh" | "fish" | "git-bash" (Windows)
    pub home_dir: PathBuf,
    pub cwd: PathBuf,
    pub is_wsl: bool,                  // WSL 特殊路径提示
    pub is_docker: bool,
    pub is_desktop: bool,              // Desktop GUI vs 纯终端
}
```

**环境感知注入（来自 Hermes）：** `EnvironmentInfo` 在 `cabinet-app-core` 启动时探测，作为 `AgentLoop` 构造参数注入。`PromptAssembler` 根据 `EnvironmentInfo` 生成环境提示片段——例如 Windows 用户看到 "bash runs through git-bash, NOT PowerShell"，WSL 用户看到 "/mnt/c/ paths" 提示。

**模型专属指令（来自 Hermes + DeerFlow）：** `prompts/model_guidance/` 目录按 Provider 分类：

| 文件           | 适用模型       | 内容                                                           |
| -------------- | -------------- | -------------------------------------------------------------- |
| `anthropic.md` | Claude 系列    | extended thinking、prompt caching、tool use 最佳实践           |
| `openai.md`    | GPT/Codex 系列 | `<tool_persistence>`、`<mandatory_tool_use>`、`<verification>` |
| `google.md`    | Gemini 系列    | 并行工具调用、绝对路径、非交互标志                             |

`PromptAssembler` 在 `AssemblyContext.model` 中检测模型名，加载对应的模型专属指令片段。

### 5.1.2 上下文管理：`context/monitor.rs` + `context/compressor.rs` + `context/budget.rs`

**对标设计：** Hermes 的 4 阶段压缩策略（工具结果预裁剪 → 边界选择 → LLM 结构化摘要 → 组装防抖）。Claude Code 的 post-compact 附件重建（文件/Skill/Plan 重新注入）。DeerFlow 的阈值触发。

**核心洞察：** 对比 6 个对标产品，**无一家的记忆注入量随上下文压力调整**——记忆量是固定的。这是 Cabinet 可以做差异化的地方。

**ContextMonitor（运行时监控 + 预算分配）：**

```rust
// context/monitor.rs

pub struct ContextMonitor {
    estimated_tokens: usize,
    max_tokens: usize,                     // 模型上下文窗口大小
    warning_threshold: f64,                // 0.75——触发压缩
    critical_threshold: f64,               // 0.90——强制压缩
    breakdown: ContextBreakdown,
}

pub struct ContextBreakdown {
    pub system_prompt: usize,
    pub messages: usize,
    pub tool_results: usize,
    pub injected: usize,                   // 注入的 Skill/Memory 等
}

impl ContextMonitor {
    pub fn update(&mut self, usage: &TokenUsage);
    pub fn should_compact(&self) -> CompactDecision;
    pub fn utilization(&self) -> f64;      // 0.0 - 1.0

    /// 计算本轮注入预算——这是新增的核心能力
    /// 在每 turn 开始前调用，将预算传递给 PromptAssembler
    pub fn allocate_budget(&self) -> ContextBudget;
}
```

**ContextBudget — 弹性注入预算分配器：**

```rust
// context/budget.rs

pub struct ContextBudget {
    pub utilization: f64,                     // 当前 token 利用率
    pub allocations: HashMap<FragmentSource, u64>,  // 每个 fragment 的 token 配额
}

impl ContextBudget {
    /// 根据利用率计算各 fragment 的配额
    pub fn compute(utilization: f64, model_max_tokens: u64, current_tokens: u64) -> Self {
        let remaining = model_max_tokens - current_tokens;
        let injection_pool = remaining - (max_tokens_per_turn / 2);  // 预留 LLM 输出

        // Fragment 分为两个层级:
        //
        // Tier 1 — 不可削减（结构必需）:
        //   Identity, ToolCatalog, PlanState, SteerChannelNote
        //   → 分配固定配额，不随利用率变化
        //
        // Tier 2 — 弹性（利用率升高时逐步削减）:
        //   Skill L2 body > MemorySnapshot > SkillIndex > ProjectContext
        //   → 配额随利用率升高递减

        match utilization:
            < 0.50 → 完整配额（Skill L2: 4000, Memory: 5条, SkillIndex: 20个, Project: 5000）
            0.50-0.75 → 轻度削减（Skill L2: 2000, Memory: 3条, SkillIndex: 10个, Project: 3000）
            0.75-0.90 → 重度削减（Skill L2: 0, Memory: 1条, SkillIndex: 5个+pinned, Project: 1000）
            > 0.90 → 仅 Tier 1（所有 Tier 2 配额为 0——此时必须压缩）
    }
}
```

**MemoryFacade 和 SkillRegistry 接受 token_budget：**

```rust
// MemoryFacade 接受预算，自适应返回
impl MemoryFacade {
    pub async fn recall(&self, query: &str, project: Option<&str>, token_budget: u64)
        -> Result<Vec<VerifiedMemory>>
    {
        let limit = match token_budget:
            >= 800 → 5,       // 完整
            >= 400 → 3,       // 截断到 120 chars/条
            >= 150 → 2,       // 仅标题行
            _      → 0;       // 跳过 MemorySnapshot
        // ... 召回 + Sideagent 验证 ...
    }
}

// SkillRegistry 同样——L1 索引数量随预算变化
impl SkillRegistry {
    pub fn list_active_for_injection(&self, token_budget: u64) -> Vec<SkillL1> {
        let max_count = min(config.skill_max_injected, token_budget / 30);
        // 排序: pinned 优先 → usage_count DESC → 截断到 max_count
    }
}
```

**Fragment 优先级（预算不足时从下往上削减）：**

| 层级          | Fragment                         | 行为                               |
| ------------- | -------------------------------- | ---------------------------------- |
| **不可削减**  | Identity (CABINET.md + 核心指令) | 固定配额                           |
|               | ToolCatalog (工具目录)           | 固定配额                           |
|               | PlanState (当前计划)             | 固定配额                           |
| **弹性 1 级** | Skill L2 body                    | 4000 → 2000 → 0                    |
| **弹性 2 级** | ProjectContext (rules + cg 状态) | 5000 → 3000 → 1000                 |
| **弹性 3 级** | MemorySnapshot                   | 5 条 → 3 条 → 1 条 → 0             |
| **弹性 4 级** | SkillIndex (L1)                  | 20 个 → 10 个 → 5 个 → pinned only |

**这个机制在所有对标产品中独一无二。** Claude Code、Hermes、DeerFlow、Codex CLI、OpenCode、jcode 的记忆注入量全部是固定的，不随上下文压力变化。

**Compressor（4 阶段压缩——来自 Hermes 的完整实现）：**

```rust
// context/compressor.rs

pub struct ContextCompressor {
    gateway: Arc<Gateway>,
    config: CompactionConfig,
}

pub struct CompactionConfig {
    pub summary_model: String,             // 默认 "claude-haiku-4-5"
    pub summary_ratio: f64,                // 摘要 token 预算: 压缩内容的 20%
    pub min_summary_tokens: usize,         // 2000
    pub max_summary_tokens: usize,         // 12000
    pub protect_first_n: usize,            // 保护头部 3 条消息
    pub protect_last_n: usize,             // 保护尾部 6 条消息
    pub anti_thrash_threshold: f64,        // 连续两次节省 <10% → 跳过
    pub max_compaction_retries: u32,       // 压缩 LLM 调用最大重试次数
}

impl ContextCompressor {
    /// 完整压缩流程
    pub async fn compact(
        &self,
        messages: &mut Vec<Message>,
        focus_topic: Option<&str>,        // 用户通过 /compact <focus> 指定
    ) -> Result<CompactionReport> {
        // Phase 1: 工具结果预裁剪（无 LLM，廉价）
        //   - MD5 去重相同工具结果
        //   - 替换 >200 chars 输出为一行摘要
        //   - 截断 >500 chars tool_call 参数，保留 JSON 有效性
        //   - 移除旧截图（替换为 "[screenshot removed]"）
        //   来自 Hermes: Phase 1

        // Phase 2: 边界选择
        //   - 保护 head: system prompt + protect_first_n 消息
        //   - 保护 tail: token 预算内 + 至少 protect_last_n 条
        //   - 边界对齐: 不拆分 tool_call/result 对
        //   - 确保最后 user message 在 tail 中
        //   来自 Hermes: Phase 2

        // Phase 3: LLM 结构化摘要
        //   - 模板: Goal | Completed Actions | Active State | Key Decisions
        //          | Blocked | Resolved Questions | Relevant Files | Remaining Work
        //   - 时序锚定: 相对引用 → 过去式事实
        //   - 迭代更新: 再次压缩时更新已有摘要（保持连续性）
        //   - Token 自适应预算: 20% 比例 (min 2000, max 12000)
        //   来自 Hermes: Phase 3

        // Phase 4: 组装 + 防抖
        //   - compressed = head + summary + tail
        //   - 清理孤立 tool result
        //   - 连续两次节省 <10% → 跳过
        //   来自 Hermes: Phase 4
    }

    /// Post-compact 附件重建——来自 Claude Code
    ///
    /// 压缩后重新注入:
    ///   - 最近读取的 5 个文件（POST_COMPACT_MAX_FILES）
    ///   - 被调用的 Skill（按 recency 排序）
    ///   - 当前 Plan 状态（Plan Mode 指令不丢失）
    ///   - 工具目录 delta（避免重复注入）
    ///   - MCP 指令 delta
    pub async fn rebuild_attachments(
        &self,
        preserved_messages: &[Message],
        files: &[FilePath],
        skills: &[SkillName],
        plan: Option<&ActivePlan>,
    ) -> Result<Vec<Attachment>>;

    /// 部分压缩——来自 Claude Code 的 partialCompactConversation
    /// - 'up_to': 摘要 pivot 之前的消息（保留新消息）
    /// - 'from':  摘要 pivot 之后的消息（保留旧消息）
    pub async fn compact_partial(
        &self,
        messages: &mut Vec<Message>,
        pivot: usize,
        direction: CompactDirection,
    ) -> Result<CompactionReport>;
}
```

### 5.1.3 Harness 质量免疫系统：`harness/`

**对标设计：** Cabinet v2 的完整 Harness 闭环（Evaluator + QualityGate + AutoAdjuster + PreferenceLearner + HarnessAnalyst + FailurePatternAnalyzer）。Claude Code 的 Plan Mode（预防性质量）。Hermes 的 Curator（事后管理）。

```rust
// harness/evaluator.rs
// 来自 Cabinet v2: LLM-as-Judge 输出评分 (0-1)

pub struct Evaluator {
    gateway: Arc<Gateway>,
    config: EvaluatorConfig,
}

pub struct EvaluatorConfig {
    pub model: String,                // 默认 "claude-haiku-4-5"
    pub max_tokens: u32,               // 评分输出很短
    pub score_threshold: f64,          // 0.5——低于此分数视为低质量
}

pub struct EvaluationResult {
    pub score: f64,                    // 0.0 - 1.0
    pub feedback: String,              // 评分理由
    pub aspects: EvaluationAspects,
}

pub struct EvaluationAspects {
    pub correctness: f64,              // 是否正确理解需求
    pub completeness: f64,             // 是否完整覆盖
    pub evidence: f64,                 // 是否有证据支撑（引用代码、文档）
    pub safety: f64,                   // 是否考虑了安全影响
}

// harness/quality_gate.rs
// 来自 Cabinet v2: HEI (Hypothesis-Evidence-Impact) 结构完整性检查

pub struct QualityGate {
    hei_check: HeiCheck,
}

pub struct QualityResult {
    pub passed: bool,
    pub score: f64,
    pub missing_sections: Vec<String>,   // 缺失的 HEI 结构元素
    pub issues: Vec<QualityIssue>,
}

pub struct QualityIssue {
    pub severity: IssueSeverity,         // Warning | Error
    pub category: String,
    pub description: String,
    pub location: Option<String>,
}

// harness/auto_adjuster.rs
// 来自 Cabinet v2: 自动调参。精简到 4 种核心调整（v2 有 7 种）

pub struct AutoAdjuster {
    actions: Vec<AdjustmentAction>,
    cooldown: Duration,                  // 调整冷却——30 分钟
    escalation_threshold: u32,          // 连续 N 次低质量后触发调整
}

pub enum AdjustmentAction {
    /// 温度降低——提高确定性
    TemperatureReduce { from: f64, to: f64 },
    /// 上下文预算缩减
    ContextBudgetShrink { from: f64, to: f64 },
    /// 建议切换 Provider——通知用户当前质量趋势，建议手动 /model 切换
    SuggestProviderSwitch { current: String, suggestion: String, reason: String },
    /// 通知用户——自动调整已达上限
    NotifyUser { message: String },
}

impl AutoAdjuster {
    /// 分析会话质量趋势，决定是否需要调整
    pub fn analyze(
        &self,
        evaluations: &[EvaluationResult],
        quality_gates: &[QualityResult],
        cost_tracker: &CostTracker,
    ) -> Option<AdjustmentAction>;

    /// 应用调整动作——更新 AgentConfig
    pub fn apply(&self, action: &AdjustmentAction, config: &mut AgentConfig);
}

// harness/preference.rs
// 来自 Cabinet v2: 用户偏好学习

pub struct PreferenceLearner {
    preferences: HashMap<String, PreferenceValue>,
    repo: Option<Arc<PreferenceRepo>>,
}

impl PreferenceLearner {
    /// 从用户审批决策中学习偏好
    /// - 用户总是拒绝 curl 命令 → 学习: prefer_no_network
    /// - 用户总是批准 cargo test → 学习: trust_cargo_test
    /// - 用户选择 "AllowAndSave" → 持久化偏好
    pub fn learn_from_decision(
        &mut self,
        decision: &PermissionDecision,
    );
}

// harness/analyst.rs
// 来自 Cabinet v2: 会话后元分析（每日）

pub struct HarnessAnalyst {
    gateway: Arc<Gateway>,
    memory: Arc<MemoryFacade>,
}

impl HarnessAnalyst {
    /// 分析过去 24 小时的会话数据，生成洞察
    /// 结果存入长期记忆（type=harness_insight）
    pub async fn analyze_recent_sessions(
        &self,
        sessions: &[SessionSummary],
    ) -> Result<String>;
}

// harness/failure_analyzer.rs
// 来自 Cabinet v2: 失败模式分析

pub struct FailurePatternAnalyzer {
    db: Option<Arc<Database>>,           // step_events 表
}

pub struct FailureRecommendation {
    pub tool_name: String,
    pub failure_rate: f64,
    pub suggestion: String,              // "增加超时时间" / "降低重试次数" / "废弃此工具"
    pub severity: IssueSeverity,
}

impl FailurePatternAnalyzer {
    pub fn analyze(
        &self,
        tool_stats: &HashMap<String, ToolStats>,
    ) -> Vec<FailureRecommendation>;
}
```

### 5.1.4 Observer Pipeline——13 个 Observer 按固定顺序

**对标设计：** DeerFlow 的 14 层 middleware + 顺序 docstring 约束。

| #   | Observer                | 钩子                        | 职责                                               | 新增/保留 |
| --- | ----------------------- | --------------------------- | -------------------------------------------------- | --------- |
| 1   | ContentGuardObserver    | on_user_input               | 注入攻击检测                                       | 保留      |
| 2   | SafetyCheckObserver     | on_tool_call                | ExecPolicy 检查（阻止危险操作）                    | 保留      |
| 3   | PlanGuardObserver       | on_tool_call                | 执行模式中计划外操作拦截                           | 保留      |
| 4   | ToolExecuteObserver     | on_tool_call/on_tool_result | 工具执行统计追踪                                   | 保留      |
| 5   | StepEventObserver       | on_step_end                 | SessionEvent 写入                                  | 保留      |
| 6   | ContextMonitorObserver  | on_step_end                 | Token 估算 + 预算分配 + 阈值触发                   | 保留      |
| 7   | CompactionObserver      | on_step_end                 | 达到 75% 阈值时触发 `ContextCompressor::compact()` | 保留      |
| 8   | **EvaluatorObserver**   | on_step_end                 | LLM 输出评分（0-1）+ 反馈                          | **新增**  |
| 9   | **QualityGateObserver** | on_step_end                 | HEI 结构完整性检查                                 | **新增**  |
| 10  | CheckpointObserver      | on_step_end                 | TurnCompleted 后 snapshot（N=20）                  | 保留      |
| 11  | CostObserver            | on_post_llm_call            | 成本更新（CostTracker::record）                    | 保留      |
| 12  | **AutoAdjustObserver**  | on_session_end              | 分析质量趋势 → 触发 `AutoAdjuster`                 | **新增**  |
| 13  | ClarificationObserver   | on_tool_call                | 高风险操作强制确认（始终最后）                     | 保留      |

**每个 Observer 的位置有明确的依赖关系。** SafetyCheckObserver 必须在 ToolExecuteObserver 之前——被安全策略阻止的工具不应计入执行统计。EvaluatorObserver 在 CompactionObserver 之后——压缩后的输出也需要评分。AutoAdjustObserver 在 on_session_end——在整个会话的评估和质量检查完成后统一分析趋势。ClarificationObserver 必须在最后——在用户确认前其他 Observer 不应执行。

### 5.1.5 主执行循环

**AgentLoop 结构：**

```rust
pub struct AgentLoop {
    gateway: Arc<Gateway>,
    tools: Arc<ToolRegistry>,
    codegraph: Arc<CodeGraphIndex>,
    exec: Arc<ExecEngine>,
    sandbox: Arc<dyn SandboxProvider>,
    memory: Arc<MemoryFacade>,
    skills: Arc<SkillRegistry>,
    session: SessionManager,
    observers: Vec<Box<dyn AgentObserver>>,
    config: AgentConfig,
    // 提示词工程
    prompt_assembler: PromptAssembler,
    // 上下文管理
    context_monitor: ContextMonitor,
    context_compressor: ContextCompressor,
    context_budget: ContextBudget,              // 每 turn 注入预算（新增）
    // Harness
    evaluator: Option<Evaluator>,         // 可选——enabled via config
    quality_gate: QualityGate,
    auto_adjuster: AutoAdjuster,
    preference_learner: PreferenceLearner,
    failure_analyzer: FailurePatternAnalyzer,
    // 运行时状态
    plan_mode_active: bool,
    active_plan: Option<ActivePlan>,
    pending_steer: Option<String>,
}
```

**主执行循环：**

```
AgentLoop::run(user_message, callback):
  Phase 1: 准入
    → SessionManager::admit_prompt() —— 持久化，先于 LLM 调用

  Phase 2: Plan Mode 检查
    → 如果 plan_mode=true 且没有 active_plan:
        → 切换到 Plan 工具集（只读工具）
        → prompt_assembler.assemble(PlanMode context)
        → 多轮探索（Agent 使用 codegraph_explore + read_file）
        → Agent 输出 plan（todo_write + ask_user）
        → 用户审批 → PlanApproved 事件 → 退出 Plan Mode
        → prompt_assembler.invalidate(PlanState)

  Phase 3: 主循环 (while turn < max_turns)
    → 计算上下文预算:
        budget = context_monitor.allocate_budget()
        → 根据 utilization 计算每个 fragment 的 token 配额
    → 组装上下文:
        prompt_assembler.assemble(BuildMode context, &budget)
        + injector.inject_memory(budget.get(MemorySnapshot))
        + injector.inject_skills(budget.get(SkillIndex), budget.get(SkillL2Body))
        + injector.inject_codegraph_status(budget.get(ProjectContext))
    → 检查 prompt cache key → 如果未变化则使用缓存的系统提示词
    → LLM 流式调用
    → 无工具调用 → break（最终响应）
    → 工具分发:
        partition_tools() 按 is_concurrency_safe 分组
        → 并发批次: join_all 并行执行
        → 串行批次: for 逐个执行
    → context_monitor.update(usage) —— 更新 token 估算
    → Observer 通知:
        on_step_end:
          EvaluatorObserver → 如果 enabled，评分当前输出
          QualityGateObserver → HEI 结构检查
          CompactionObserver → 如果 should_compact()，触发 context_compressor.compact()
    → Steer 注入（如果有 pending steer）
    → CostObserver → CostTracker::record()

  Phase 4: 会话结束
    → AutoAdjustObserver::on_session_end:
        → 收集所有 Evaluator 评分
        → 收集所有 QualityGate 结果
        → auto_adjuster.analyze() → 如果需要调整，修改 AgentConfig
        → preference_learner.learn_from_decisions()
    → 持久化: SessionManager 创建最终 snapshot
```

**Plan Mode 与 Build Mode 的关系——一个 AgentLoop 的两种模式（不是两个独立 Agent）：**

```
Plan Mode:
  - 工具集: 只读（codegraph_*, read_file, glob, grep, web_*, todo_write, ask_user）
  - System prompt: prompt_assembler.assemble(PlanMode)——包含 plan_mode.md
  - 目标: 输出 plan，调用 ask_user 等待审批

Build Mode (审批通过后):
  - 工具集: 完整（包括 write_file, edit_file, bash, task）
  - System prompt: prompt_assembler.assemble(BuildMode)——包含 build_mode.md
  - 目标: 按 plan 逐步执行。计划外操作 → PlanGuardObserver 拦截。每完成一步更新 todo
```

**Steer 机制——来自 Hermes：** `/steer` 不中断当前 turn，等待工具批次完成后注入为 system 消息。非破坏性的中途引导。

**Agent 类型——对标 Claude Code 的 6 种内置 Agent：**

```rust
pub enum AgentType {
    Build,                                   // 主 Agent——全工具集。用户直接对话
    Plan,                                    // Plan Mode——只读。代码探索和分析
    Explore,                                 // 代码库探索子代理 (task spawn)
    Verify,                                  // 结果验证子代理 (task spawn)。只读+web
    GeneralPurpose,                          // 通用子代理 (task spawn)。可 bash，不可写文件
}
```

|                     | Build         | Plan           | Explore                                    | Verify                    | GeneralPurpose                                         |
| ------------------- | ------------- | -------------- | ------------------------------------------ | ------------------------- | ------------------------------------------------------ |
| **触发者**          | 用户直接对话  | Plan Mode 自动 | Agent 调用 task                            | Agent 调用 task           | Agent 调用 task                                        |
| **工具集**          | 全部 20 个    | 只读（~8 个）  | codegraph\_\*(6) + read_file + glob + grep | read*file + grep + web*\* | codegraph*\* + read_file + glob + grep + web*\* + bash |
| **可写文件**        | ✅            | ❌             | ❌                                         | ❌                        | ❌                                                     |
| **可 bash**         | ✅            | ❌             | ❌                                         | ❌                        | ✅                                                     |
| **可 spawn**        | ✅ (task)     | ❌             | ❌                                         | ❌                        | ❌                                                     |
| **系统提示词**      | build_mode.md | plan_mode.md   | explore.md                                 | verify.md                 | general_purpose.md                                     |
| **max_turns**       | 100           | 30             | 10                                         | 5                         | 10                                                     |
| **超时**            | 无            | 无             | 15 min                                     | 5 min                     | 15 min                                                 |
| **Harness**         | ✅            | ❌             | ❌                                         | ❌                        | ❌                                                     |
| **max_spawn_depth** | —             | —              | 1（不能再 spawn）                          | 1                         | 1                                                      |

**每种 Agent 类型的 Hard Limits——来自结构决定论原则：**

Agent 知道自己的边界比知道自己的能力更重要。每种 Agent 的系统提示词末尾包含明确的 Hard Limits 声明：

| Agent 类型         | Hard Limits                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Plan**           | 不能修改文件。不能执行 bash。如果用户要求直接修改，说明"我在 Plan 模式下，只能探索和分析。请 /approve 切换到 Build 模式后我再执行。" |
| **Explore**        | 不能修改文件。不能执行 bash。不能创建 Skill。不能 spawn 子代理。职责仅限于探索和报告。                                               |
| **Verify**         | 不能修改文件。不能执行 bash。不能探索新代码——只验证给定内容。不能创建 Skill。                                                        |
| **GeneralPurpose** | 不能修改文件。不能创建 Skill。不能 spawn 子代理。bash 仅用于只读命令。                                                               |
| **Build**          | 无硬限制（受 ExecPolicy + Permissions + PlanGuard + Clarification 四层运行时约束）。                                                 |

**子代理生命周期——对标 Claude Code 的 AgentTool 体系：**

```
父 Agent 调用 task(description, agent_type="explore"):

  1. 创建子 AgentLoop:
     - 独立消息历史（不共享父 memory）
     - 独立 agentMemory
     - 共享 sandbox、codegraph、gateway
     - 工具调用自动批准（父已审批 task）
     - max_spawn_depth = 1（不能再 spawn）

  2. 上下文:
     - 专用系统提示词（explore.md / verify.md / general_purpose.md）
     - 继承 CABINET.md（用户身份）
     - 继承 ProjectContext（项目上下文）
     - 不注入父的 MemorySnapshot / PlanState——独立上下文

  3. 执行:
     - 同步等待（父阻塞直到子完成）
     - 流式输出转发到父 TUI（缩进显示）
     - 父 Ctrl+C → 中断信号传播到所有子代理
     - 15 分钟超时 → 返回部分结果

  4. 并行:
     - 父可同时调用多个 task → concurrent batch
     - 各子代理独立上下文，互不干扰

  5. 记忆合并:
     - 子代理结束后 → 提取关键发现 → 合并到父 memory
     - 格式: "[Explore] auth 模块使用 trait-based 错误处理"

  6. 结果返回:
     ToolResult { content: Text("
       ## Explore Result
       {output}
       ---
       Tools: codegraph_explore(3), read_file(5) | Turns: 5 | Duration: 23s
     ") }
```

**结果验证——对标 Claude Code 的 verificationAgent：**

```
父 Agent 可选的验证流程:
  result = task("分析 auth 模块", agent_type="explore")
  verification = task("验证: {result}", agent_type="verify")
  → Verify 子代理检查正确性和完整性
  → 返回结果 + 验证标注
```

**Workflow 多阶段编排——对标 Claude Code Workflow 工具 + Cabinet v2 WorkflowEngine：**

v2 有成熟的 WorkflowEngine（18 种节点类型、StateGraph DAG 引擎、Manager 节点），但它是为"项目管理平台"设计的。v3 的 Workflow 聚焦 Coding Agent 场景：**编排子代理完成复杂的多阶段代码任务**。

```
Agent 能力层次:
  L1: 单工具调用        → bash("cargo build")
  L2: 单子代理委托      → task("分析 auth", agent_type="explore")
  L3: 并行子代理        → 同时 task × 3
  L4: 结构化多阶段编排  → workflow("审计安全漏洞")
```

三种执行模式 + 两种循环模式：

```
模式 1: pipeline — 物品流经所有阶段，无屏障。A 在 Phase 3 时 B 可在 Phase 1
模式 2: barrier  — 所有物品完成当前阶段后才一起进入下一阶段
模式 3: sequential — 物品逐个流经全部阶段

循环 A: loop-until-count  — while 发现数 < 目标 { spawn 子代理 }
循环 B: loop-until-budget — while token_budget.remaining() > 阈值 { spawn 子代理 }
循环 C: loop-until-dry    — while 连续无新发现 < N { spawn 子代理 }
```

Workflow Definition（JSON Schema，Agent 通过 workflow 工具提交）：

```json
{
  "name": "security-audit",
  "description": "审计代码安全漏洞",
  "phases": [
    {
      "title": "并行扫描",
      "mode": "pipeline",
      "agent_type": "explore",
      "max_concurrency": 10,
      "items": ["auth", "database", "api"],
      "prompt_template": "扫描 {item} 模块的安全漏洞"
    },
    {
      "title": "去重分类",
      "mode": "barrier",
      "agent_type": "general_purpose",
      "prompt": "合并结果，去重，按严重程度分类"
    },
    {
      "title": "逐项验证",
      "mode": "pipeline",
      "agent_type": "verify",
      "max_concurrency": 5,
      "items_from": "previous_phase"
    },
    { "title": "汇总报告", "mode": "barrier", "agent_type": "general_purpose" }
  ],
  "loop": { "type": "until_dry", "max_dry_rounds": 2, "max_iterations": 10 }
}
```

```rust
// agent/src/workflow/

pub struct WorkflowExecutor {
    tools: Arc<ToolRegistry>,
    gateway: Arc<Gateway>,
    sandbox: Arc<dyn SandboxProvider>,
    codegraph: Arc<CodeGraphIndex>,
}

impl WorkflowExecutor {
    /// 执行 workflow definition。内部使用 task 子代理体系。
    pub async fn execute(&self, definition: WorkflowDefinition) -> Result<WorkflowResult>;

    /// pipeline 模式——物品流经所有阶段，无阶段间屏障
    async fn run_pipeline(&self, phases, items) -> Result<Vec<PhaseResult>>;

    /// barrier 模式——所有物品完成当前阶段后进入下一阶段
    async fn run_barrier(&self, phases, items) -> Result<Vec<PhaseResult>>;

    /// 循环——直到满足条件
    async fn run_loop(&self, loop_config, phases) -> Result<Vec<PhaseResult>>;
}
```

**持久化为 Skill：**

```
Workflow 完成后 → Agent 可保存为 Skill:

SKILL.md:
  ---
  name: security-audit
  description: 审计代码安全漏洞
  kind: Workflow
  ---
  (Workflow JSON definition)

SkillRegistry 新增 kind=Workflow。
加载后可通过 skill_invoke("security-audit") 触发 WorkflowExecutor 执行。
和其他 Skill 一样受 Curator 生命周期管理。
```

**与 Cabinet v2 的关系：**

| v2                                | v3                                              |
| --------------------------------- | ----------------------------------------------- |
| StateGraph DAG 引擎               | 不移植——v3 只需 spawn 子代理，不需要图编译器    |
| 18 种节点                         | 不移植——v3 只有一种节点：子代理                 |
| Manager 节点                      | 不移植——已被 Agent Plan Mode + Workflow 覆盖    |
| AgentDispatcher Pipeline/Parallel | 被 WorkflowExecutor 的 pipeline/barrier 吸收    |
| Decision 系统 + approval 节点     | 不移植——Coding Agent 场景不需要                 |
| Harness Pipeline                  | ✅ 已在 v3（Evaluator + QualityGate 等 6 组件） |
| Observer Pipeline                 | ✅ 已在 v3（13 个 Observer）                    |

### 5.2 `cabinet-skill`

**职责：** Skill 系统——发现、加载、匹配、生命周期管理、自主创建。

```rust
pub struct SkillRegistry {
    skills: HashMap<String, SkillEntry>,
    repo: SkillRepo,                               // SQLite 持久化——跨进程重启保留
    catalog_cache: LruCache<String, String>,       // L1: 内存 LRU (8 条目)
    snapshot: SkillSnapshot,                        // L2: 磁盘快照 + mtime 校验
    usage: HashMap<String, SkillUsage>,
}
```

**Skill 元数据持久化：** `SkillRepo` 负责读写 `usage_count`、`last_used`、`status`、`pinned` 等字段。进程重启后，`SkillRegistry::new()` 从 `SkillRepo` 恢复所有注册 Skill 的运行时状态。SKILL.md 文件本身从磁盘读取——`SkillRepo` 只存元数据，不存 body。

**Skill 作用域覆盖规则：** `discover_and_load()` 按顺序扫描（内置 → 全局 → 项目 → Plugin），后加载的**完全覆盖**先加载的同名 Skill（包括 body、metadata、allowed_tools）。被覆盖的 Skill 保留在内存中但标记为 `status=Superseded`，可通过显式指定 scope 恢复。

**Skill 元数据：**

```rust
pub struct SkillMetadata {
    pub name: String,
    pub description: String,               // ≤ 60 chars
    pub kind: SkillKind,                   // Prompt | Tool | Composite | Workflow
    pub created_by: Author,                // User | Agent | Community
    pub scope: SkillScope,                 // Global | Project
    pub allowed_tools: Option<Vec<String>>,      // 安全隔离——Skill 声明的工具白名单（来自 DeerFlow）
    pub requires_tools: Option<Vec<String>>,      // 条件显示——工具不可用时隐藏（来自 Hermes）
    pub fallback_for_tools: Option<Vec<String>>,  // 条件隐藏——工具可用时隐藏（来自 Hermes）
    pub version: u32,
    pub status: SkillStatus,               // Active | Stale | Archived
    pub pinned: bool,                      // 固定 Skill 免疫自动归档
    pub last_used: Option<DateTime>,
    pub usage_count: u32,
}
```

**三级渐进加载——来自 Cabinet v2：**

```
L1: 名称 + 描述——始终注入 prompt (~50 tokens/个)
L2: 完整 SKILL.md body——当 Agent 通过 skill_invoke 激活时注入
L3: references/ + scripts/——Agent 通过 read_file 按需读取
```

**加载顺序（后覆盖前）：**

1. 内置 Skill（编译时嵌入的 coding patterns）
2. `~/.cabinet/skills/`（全局）
3. `.cabinet/skills/`（项目——覆盖全局同名 Skill）
4. Plugin 注册的 Skill

**Curator——Skill 生命周期管理（来自 Hermes）：**

```rust
pub struct Curator {
    registry: Arc<SkillRegistry>,
    gateway: Arc<Gateway>,
    config: CuratorConfig,
}

impl Curator {
    // Stage 1: 自动状态转换（纯规则，无 LLM）
    //   active + 30d 未使用 → stale
    //   stale + 90d 未使用 → archived
    //   stale + 重新使用 → active（复活）
    //   pinned=true → 跳过所有自动转换
    pub async fn apply_automatic_transitions(&self) -> Result<TransitionReport>;

    // Stage 2: LLM 整合审查（Fork AIAgent，使用 haiku）
    //   扫描前缀聚类 → 合并为伞 Skill / 新建伞 Skill / 降级为支持文件
    //   → 归档被吸收的 Skill
    pub async fn consolidate(&self) -> Result<ConsolidationReport>;

    pub fn should_run(&self, last_run: Option<DateTime>, agent_idle: Duration) -> bool;
}
```

**SkillGenerator——Agent 自主创建 Skill（来自 Hermes）：**

```rust
pub struct SkillGenerator {
    registry: Arc<SkillRegistry>,
    gateway: Arc<Gateway>,
}

impl SkillGenerator {
    // 触发条件: 任务使用 5+ 次工具调用 + 成功完成 + Agent 调用 skill_create 工具
    // 流程: 构建生成 prompt → LLM 生成 SKILL.md → 解析验证 → 写入磁盘 → 注册
    pub async fn generate_from_session(
        &self, session_id, task_description, tool_calls, result
    ) -> Result<SkillEntry>;
}
```

**两个触发路径都支持：** Agent 自主触发（完成后调用 skill_create）+ Plan Mode 系统提示中包含建议。

**安全扫描——来自 DeerFlow：** 加载 Skill 时扫描 body 中是否包含可疑 shell 命令（rm -rf /、curl | bash、sudo 等）。

**当前阶段不做自动匹配。** Skill 通过以下方式被发现：L1 目录始终注入 prompt + Agent 自主判断 + 用户 `/skill-name` 手动激活。当 Skill 数量超过 50 个后引入 embedding 匹配。

### 5.3 `cabinet-memory`

**职责：** 记忆系统——5 层流水线 + Sideagent + 自主提示 + CodeGraph 关联。

```rust
pub struct MemoryFacade {
    short_term: ShortTermMemory,
    write_gate: WriteGate,
    cascade: CascadeBuffer,
    long_term: LongTermMemory,
    decay: MemoryDecayService,
    sideagent: Sideagent,
    config: MemoryConfig,
}
```

**5 层流水线——保留 Cabinet v2 的最佳设计：**

```
Layer 1: ShortTermMemory
  - 会话 KV + Turn 日志
  - LRU + TTL 30min, maxSize=1000

Layer 2: WriteGate
  - 5 级分类: Working | Register | Daily | TransientNoise | StructuredPrefix
  - 快速路径: 多语言正则匹配
  - Working + Register + StructuredPrefix → 升级到长期记忆

Layer 3: CascadeBuffer
  - L0 暂存——批量写入优化
  - 封存条件: minCount=3 或 maxAge=30min

Layer 4: LongTermMemory
  - SQLite + FTS5 全文搜索
  - 500K 上限
  - 按时间范围、按项目筛选

Layer 5: MemoryDecay
  - expire → archive → supersede → prune
  - 复合评分: importance × confidence × recency_decay × access_boost
  - 上限裁剪: 超 500K 时删除最低分条目
```

**Sideagent——注入前验证（来自 jcode）：**

```rust
pub struct Sideagent {
    gateway: Arc<Gateway>,
    config: SideagentConfig,   // model=haiku, max_verifications=5, max_tokens=200
}

impl Sideagent {
    // 对每个候选记忆构造微型 prompt:
    //   "用户正在问: {query}。这是检索到的记忆: {content}。
    //    相关吗？回答 RELEVANT 或 NOT_RELEVANT。"
    // 过滤掉 relevance < 0.6 的记忆
    pub async fn verify_relevance(
        &self, query, candidates
    ) -> Result<Vec<VerifiedMemory>>;
}
```

**自主提示——来自 Hermes：** 会话超过 10 turn 或有决策事件 + 超过 20 turn 未提示 → 注入 nudge。

**CodeGraph 符号关联：**

```sql
CREATE TABLE memory_symbol_links (
    memory_id TEXT NOT NULL,
    symbol_id TEXT NOT NULL,
    symbol_name TEXT NOT NULL,
    project_path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (memory_id, symbol_id),
    FOREIGN KEY (memory_id) REFERENCES long_term_memory(id) ON DELETE CASCADE
);
```

```rust
impl MemoryFacade {
    pub async fn link_to_symbol(&self, memory_id, symbol, symbol_name) -> Result<()>;
    pub async fn recall_by_symbol(&self, symbol_name, project, limit) -> Result<Vec<LongTermEntry>>;
    pub async fn recall_for_file(&self, file_path, project, limit) -> Result<Vec<LongTermEntry>>;
}
```

**置信度过滤——来自 DeerFlow：** LLM 提取时打分，< 0.7 丢弃。检索时 Sideagent 再次验证（双重防线）。

**Memory 工具：** 统一入口，通过 `action` 参数区分 `search` / `save` / `delete` / `list`。

**v3 移除的 Cabinet v2 组件：** KnowledgeGraph（代码已有 CodeGraph）、EntityMemory（不需要"员工偏好"）、ProjectMemory（不是 Coding Agent 的场景）。

**v3 新增的对标能力：** Sideagent（来自 jcode）、自主提示（来自 Hermes）、置信度过滤（来自 DeerFlow）、符号关联。

---

## 六、Application 层

### 6.1 `cabinet-app-core`

**职责：** 应用编排——依赖组装、生命周期管理、配置加载、信号处理、运行模式 dispatch。

**核心设计：工厂/消费者分离。**

```rust
pub struct App {
    config: Config,
    paths: CabinetPaths,

    // Foundation (Arc 共享)
    db: Database,
    codegraph: Arc<CodeGraphIndex>,
    otel: OtelGuard,

    // Engine (Arc 共享)
    gateway: Arc<Gateway>,
    sandbox: Arc<dyn SandboxProvider>,
    exec: Arc<ExecEngine>,
    session_manager: Arc<SessionManager>,
    tools: Arc<ToolRegistry>,
    plugin_manager: Arc<PluginManager>,

    // Intelligence (Arc 共享)
    skills: Arc<SkillRegistry>,
    memory: Arc<MemoryFacade>,

    // 运行时状态
    mode: AppMode,
    shutdown_flag: Arc<AtomicBool>,
}

pub enum AppMode {
    Interactive,                    // cabinet（默认）
    Headless { prompt: String },    // cabinet run "prompt"
}
```

**初始化顺序（由依赖关系决定）：**

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

Phase 4: 创建 Agent（第一个 AgentLoop）
  agent = build AgentLoop with all Arc references
```

```rust
impl App {
    pub async fn new(config_path: Option<&Path>, mode: AppMode) -> Result<Self>;
    pub async fn run(&mut self) -> Result<ExitCode>;

    // 工厂方法——TUI 通过此方法按需创建新 AgentLoop
    // （/new 命令、会话切换等场景）
    pub fn create_agent(&self) -> Result<AgentLoop>;
}
```

**Agent 生命周期：** `App::new()` 时创建第一个 Agent。TUI 中 `/new` 命令通过 `app.create_agent()` 获取新实例。旧的 Agent 被 drop 时自动释放资源。TUI 不直接访问 ToolRegistry 或 Gateway——通过 App 提供的接口操作。

**信号处理：**

```
Ctrl+C (第一次): 设置 shutdown_flag → Agent 检测到后优雅停止当前 turn
Ctrl+C (第二次, 3 秒内): 强制退出 (exit 130)
SIGTERM: 同 Ctrl+C
```

**优雅关闭（Drop 顺序）：**

```
1. Agent 先停（不再发起新的 LLM 调用）
2. Session 持久化最后的 snapshot
3. Sandbox 清理容器/临时文件
4. Plugin WASM 实例卸载
5. Database 关闭连接
6. OtelGuard flush 剩余的 trace/log
```

**Binary 入口：**

```rust
// src/main.rs
#[tokio::main]
async fn main() -> std::process::ExitCode {
    let args = CliArgs::parse();
    let mode = if let Some(prompt) = args.prompt {
        AppMode::Headless { prompt }
    } else {
        AppMode::Interactive
    };
    // ...
}

#[derive(Parser)]
#[command(name = "cabinet", version, about = "A coding agent that runs in your terminal")]
struct CliArgs {
    #[arg(short, long)] prompt: Option<String>,
    #[arg(short, long)] config: Option<PathBuf>,
    #[arg(short, long)] working_dir: Option<PathBuf>,
}
```

**Server 模式接口预留：** `run_server(&mut self, addr: SocketAddr)` 方法已定义，v0.1.0 不实现。

---

## 七、Interface 层

### 7.1 `cabinet-tui`

**职责：** ratatui 终端界面——聊天区 + 侧边栏 + 输入区 + 权限审批弹窗。

**技术选型：** ratatui + crossterm。不拆分子 crate——总代码量不超过 5,000 行。

**主布局（自适应终端宽度）：**

```
宽屏 (≥120 列): 聊天区 65% + 侧边栏 35%
中等 (≥80 列):  聊天区 75% + 侧边栏 25%
窄屏 (<80 列):  侧边栏折叠为底部 Tab 切换
```

**5 个核心组件：**

| 组件               | 职责                                                               |
| ------------------ | ------------------------------------------------------------------ |
| `StatusBar`        | 会话标题、Plan Mode 状态、模型名、Turn 计数、Token 用量、今日成本  |
| `ChatView`         | 消息列表（支持滚动）、流式渲染、代码块语法高亮、工具调用/结果展示  |
| `Sidebar`          | Tab 切换：Plan / CodeGraph / Memory / Skills / Diff                |
| `Composer`         | 输入框、斜杠命令自动补全、历史记录、Readline 键位                  |
| `PermissionDialog` | 审批弹窗——ExecPolicy AskUser、计划外操作、破坏性命令、首次使用工具 |

**流式渲染回调：**

```rust
pub struct TuiStreamingCallback<'a> {
    chat: &'a mut ChatView,
    status: &'a mut StatusBar,
    sidebar: &'a mut Sidebar,
    redraw: &'a dyn Fn(),
}

impl StreamingCallback for TuiStreamingCallback<'_> {
    fn on_text(&mut self, content: &str);
    fn on_thinking(&mut self, content: &str);
    fn on_thinking_done(&mut self);
    fn on_tool_call(&mut self, name: &str, args: &Value);
    fn on_tool_result(&mut self, name: &str, result: &ToolResult);
    fn on_plan_updated(&mut self, plan: &ActivePlan);
    fn on_error(&mut self, message: &str);
}
```

**斜杠命令——15 个内置命令（参考 Claude Code 的 100+ 命令，精简到 Coding Agent 必需）：**

| 命令                                      | 类别      | 说明                    |
| ----------------------------------------- | --------- | ----------------------- |
| `/new`                                    | Session   | 开始新会话              |
| `/resume [id]`                            | Session   | 恢复到之前的会话        |
| `/model [name]`                           | Model     | 切换使用的模型          |
| `/mode [safe\|plan\|trusted\|everything]` | Mode      | 切换全局授权模式        |
| `/plan`                                   | Plan      | 查看/编辑当前计划       |
| `/approve`                                | Plan      | 批准当前计划，开始执行  |
| `/reject [reason]`                        | Plan      | 拒绝当前计划            |
| `/skills`                                 | Skill     | 列出可用的 Skill        |
| `/skill <name>`                           | Skill     | 激活指定 Skill          |
| `/codegraph`                              | CodeGraph | 显示 CodeGraph 索引状态 |
| `/memory [query]`                         | Memory    | 搜索或管理跨会话记忆    |
| `/config [key] [value]`                   | Config    | 查看或修改配置          |
| `/clear`                                  | System    | 清除当前会话上下文      |
| `/doctor`                                 | System    | 诊断系统状态            |
| `/exit`                                   | System    | 退出 cabinet            |

**权限审批弹窗——4 种审批类型：**

```rust
pub enum PermissionDetail {
    ExecCommand { cmd: ShellCommand, policy_reason: String },
    OutsidePlan { tool_call: ToolCall, plan_step: Option<String> },
    DestructiveOp { tool_name: String, reason: String },
    FirstUse { tool_name: String, description: String },
}

pub enum PermissionOption {
    AllowOnce,       // 仅本次
    AllowAll,        // 本次会话内始终允许
    AllowAndSave,    // 保存到 ~/.cabinet/permissions.toml 永不过期
    Deny,
}
```

**v0.1.0 键位——Readline 风格：** Ctrl+A/E（行首/行尾），Ctrl+K/U（删除至行尾/行首），Alt+B/F（逐词移动），Tab（侧边栏切换/自动补全），Enter（发送），Esc（取消）。Vim 模式作为未来可选 feature。

---

## 八、安全架构

### 8.1 全局授权模式 — 对标 Claude Code PermissionMode + v2 DelegationTier

全局授权模式是安全模型的"元开关"——它决定了下面 5 层安全机制的默认行为。用户通过 `/mode` 命令在四种模式间切换：

| 模式           | 只读工具 | 计划内写文件 | 计划内 bash | 计划外操作 | 破坏性操作 | 对标                            |
| -------------- | -------- | ------------ | ----------- | ---------- | ---------- | ------------------------------- |
| **Safe**       | 自动     | 审批         | 审批        | 审批       | **拒绝**   | Claude Code Default + v2 T0     |
| **Plan**       | 自动     | 自动         | 自动        | 审批       | 审批       | Claude Code Auto (Plan) + v2 T1 |
| **Trusted**    | 自动     | 自动         | 自动        | 自动       | 审批       | Claude Code AcceptEdits + v2 T2 |
| **Everything** | 自动     | 自动         | 自动        | 自动       | **审批**   | Claude Code Bypass + v2 T3      |

```
/mode                    → 查看当前模式
/mode safe               → Safe（默认——新用户、不信任的项目）
/mode plan                → Plan（Plan 批准后自动切换）
/mode trusted             → Trusted（有经验的用户）
/mode everything          → Everything（需二次确认才能进入）
```

**Safe（默认）：** 最保守。只读工具自动批准，任何写操作或 bash 都需要审批。破坏性操作直接拒绝——不给 Allow 选项，防止用户误点。适合不熟悉的项目或新用户。

**Plan（推荐工作模式）：** Plan 被审批后自动进入。计划内的文件修改和 bash 自动批准——因为用户已经审过了计划。计划外操作仍然需要审批。破坏性操作需要审批。这是日常 Coding Agent 使用的模式。

**Trusted：** 用户信任当前项目和 Agent 的判断。只读、写文件、bash 都自动批准。仅破坏性操作需要审批。计划外操作自动批准（用户信任 Agent 能自主判断）。适合熟悉的项目。

**Everything：** 接近全自动。破坏性操作仍需审批（最后一道防线）。其余全部自动。进入需要用户显式二次确认。对标 v2 T3 Full Autonomy。

**模式与 5 层安全的关系：** 模式决定了各层的"默认行为"，但各层仍然独立运作。例如 Safe 模式下 ExecPolicy 仍然会匹配规则——即使写文件需要审批，`rm -rf /` 仍然被 ExecPolicy 直接 Deny。

### 8.2 5 层安全模型

```
Layer 0: PermissionMode（元开关）
  └── Safe / Plan / Trusted / Everything —— 决定以下 5 层的审批默认值

Layer 1: Sandbox
  ├── DockerSandbox + BubblewrapSandbox + LocalSandbox(dev)
  ├── 虚拟路径映射——Agent 看不到真实文件系统
  ├── 网络隔离——Shell 执行时自动禁用网络
  └── 文件写入并发锁

Layer 2: ExecPolicy
  ├── 声明式命令规则（Allow / Deny / AskUser）
  ├── 内置安全默认值（rm -rf → Deny, cargo build → Allow）
  ├── readOnlyValidation——已知只读命令自动 Allow（git status, ls, cargo check...）
  ├── shadowedRuleDetection——检测用户规则是否被内置规则覆盖
  └── 用户可自定义（~/.cabinet/execpolicy.toml）

Layer 3: Permissions
  ├── 通配符规则（action + resource + effect）
  ├── Skill 声明的 allowed_tools（工具白名单）
  └── 用户持久化规则（~/.cabinet/permissions.toml）

Layer 4: Plan Mode（默认开启）
  ├── Agent 必须先 Plan 后执行
  ├── 计划外操作 → 行为取决于 PermissionMode
  └── 破坏性操作 → 始终需要审批（即使在 Everything 模式）

Layer 5: Clarification（Observer 管道最后一道防线）
  └── ContentGuardObserver → SafetyCheckObserver → PlanGuardObserver
      → ... → ClarificationObserver（始终最后）
```

---

## 九、技术栈与性能目标

### 9.1 外部依赖

| 用途        | Crate                                        | 说明                                 |
| ----------- | -------------------------------------------- | ------------------------------------ |
| 异步运行时  | tokio (full)                                 | 多线程调度 + IO + 信号               |
| SQLite      | rusqlite                                     | WAL 模式 + FTS5                      |
| HTTP 客户端 | reqwest                                      | rustls-tls                           |
| WebSocket   | tokio-tungstenite                            | MCP 连接                             |
| TUI         | ratatui + crossterm                          | 终端渲染                             |
| CLI         | clap                                         | 参数解析                             |
| 序列化      | serde + serde_json + toml                    | 配置 + 事件                          |
| 日志/追踪   | tracing + tracing-subscriber + opentelemetry | 可观测性                             |
| 树解析      | tree-sitter + language bindings              | CodeGraph                            |
| WASM 运行时 | wasmtime                                     | 插件系统                             |
| 文本处理    | regex, glob, walkdir, similar (diff)         | 工具支持                             |
| 文件监控    | notify                                       | CodeGraph 热更新                     |
| 加密        | sha2, hex                                    | 不需要 AES（无浏览器端密钥存储需求） |
| MCP         | 自研（参考 rmcp 协议）                       | MCP 客户端                           |

### 9.2 性能目标

| 指标                           | 目标    | 对标                            |
| ------------------------------ | ------- | ------------------------------- |
| 启动时间（首帧）               | < 100ms | jcode 14ms, Claude Code 3.4s    |
| 内存基线（单会话）             | < 80MB  | jcode 27.8MB, Claude Code 386MB |
| 每额外会话                     | < 30MB  | jcode +10.4MB                   |
| CodeGraph 索引（10 万行 Rust） | < 5 秒  | codegraph benchmark             |
| LLM 流式首 token               | < 1 秒  | 取决于 Provider                 |

---

## 十、工程规范

| 规则                                                            | 说明                                      |
| --------------------------------------------------------------- | ----------------------------------------- |
| Rust edition 2024                                               | 最新稳定版                                |
| clippy -D warnings                                              | 12+ 条自定义 lint（参考 Codex AGENTS.md） |
| cargo fmt                                                       | 标准格式化                                |
| cargo deny                                                      | 依赖审计 + 依赖方向校验                   |
| cargo audit                                                     | 安全漏洞扫描                              |
| 500 行/文件，800 行硬上限                                       | 来自 Cabinet v2                           |
| PR diff < 800 行                                                | 来自 Codex（非机械变更）                  |
| conventional commits                                            | `type(scope): summary`——来自 OpenCode     |
| 分支命名: 最多三词，连字符分隔                                  | 来自 OpenCode                             |
| 测试: Rust test + insta snapshot（UI 变更必须有 snapshot 覆盖） | 来自 Codex                                |
| 文档: 每个 crate 有 README + 公开 API 有 doc comment            | —                                         |

### 10.1 开发工具链配置

**rustfmt.toml（根目录）：**

```toml
# 统一代码风格
edition = "2024"
max_width = 100
tab_spaces = 4
use_small_heuristics = "Max"
newline_style = "Unix"
imports_granularity = "Crate"
group_imports = "StdExternalCrate"
reorder_imports = true
format_code_in_doc_comments = true
format_macro_matchers = true
format_strings = true
```

**clippy.toml（根目录）：**

```toml
# 12+ 条自定义 lint（参考 Codex AGENTS.md）
cognitive-complexity-threshold = 25
too-many-arguments-threshold = 8
max-trait-bounds = 5

# 强制规则（编译失败）
# clippy::collapsible_if          → 可合并的 if 必须合并
# clippy::uninlined_format_args   → format! 参数必须内联
# clippy::redundant_closure       → 优先方法引用 foo.map(bar)
# clippy::wildcard_enum_match_arm → 避免 wildcard match arm
# clippy::bool_to_int_with_if     → 禁止 bool 参数位置的字面量
# clippy::cast_lossless           → 无损失类型转换不警告
# clippy::needless_pass_by_value  → 优先引用传递
# clippy::map_unwrap_or           → 优先使用 map_or
# clippy::unnecessary_wraps       → 禁止无意义的 Option<Result<>>
# clippy::expect_used             → 生产代码禁止 expect()
# clippy::unwrap_used             → 生产代码禁止 unwrap()
# clippy::todo                    → 不留 TODO 注释
```

**deny.toml（cargo-deny 配置，根目录）：**

```toml
# 依赖方向校验——参考 Cabinet v2 的 lint:arch
[bans]
multiple-versions = "deny"
wildcards = "deny"

# 禁止违反架构层的依赖
# 例如: cabinet-types 不能依赖 cabinet-storage
#       cabinet-session 不能依赖 cabinet-agent
[[bans.deny]]
name = "cabinet-storage"
wrappers = ["cabinet-types"]    # types 是纯数据，不能依赖 storage

[[bans.deny]]
name = "cabinet-agent"
wrappers = ["cabinet-session"]   # session 在 Engine 层，不能依赖 Intelligence 层的 agent

[[bans.deny]]
name = "cabinet-tui"
wrappers = ["cabinet-codegraph"]  # TUI 不直接访问 Foundation 层
wrappers = ["cabinet-exec"]       # TUI 通过 app-core 访问子系统

# 许可证审计
[licenses]
allow = ["MIT", "Apache-2.0", "BSD-3-Clause", "Unicode-DFS-2016"]
copyleft = "deny"

# 安全审计
[advisories]
vulnerability = "deny"
unmaintained = "warn"
yanked = "deny"
```

### 10.2 CI Pipeline

**GitHub Actions 工作流：**

```
ci.yml:
  lint:
    cargo fmt --check
    cargo clippy --all-features -- -D warnings
    cargo deny check
    cargo audit

  typecheck:
    cargo check --all-features
    cargo check --no-default-features  # 验证最小编译也通过

  test:
    cargo test --all-features
    cargo test --no-default-features

  snapshot:
    cargo insta review  # CI 中验证 snapshot 是否已更新

  docs:
    cargo doc --no-deps --document-private-items
    # 验证文档链接不 broken
```

**Pre-push 钩子（`.husky/pre-push`）：**

```bash
#!/bin/sh
cargo fmt --check
cargo clippy --all-features -- -D warnings
cargo test --all-features
```

---

> 方案结束。此文档覆盖 v3 架构的所有最终决策，与逐层讨论结果完全一致。
