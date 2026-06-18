# Cabinet v3 (Rust) — 架构设计方案

> 版本：v0.1.0 草案
> 定位：聚焦 Coding Agent 场景，从学习项目走向生产级产品
> 语言：Rust
> 设计来源：Cabinet v2 经验 + 7 份对标报告 + CodeGraph 内置决策

---

## 零、设计宪法

10 条不可妥协的原则，每一条都有明确的来源。

| #   | 原则                                                                                       | 来源                              |
| --- | ------------------------------------------------------------------------------------------ | --------------------------------- |
| 1   | **先有场景，后有架构**——每个 crate 必须有明确的"谁在什么时候用它做什么"                    | Cabinet v2 杂揉教训               |
| 2   | **类型/实现分离**——`xxx-types`（纯类型，零依赖）+ `xxx-core`（实现）两个 crate             | jcode 70+ crate 验证              |
| 3   | **依赖单向可校验**——crate 边界 = 架构边界，`cargo deny` + `lint-arch` 强制执行             | Cabinet v2 `lint:arch`            |
| 4   | **沙箱是安全底线**——任何 Shell 命令执行必须在沙箱内。不允许宿主机裸跑                      | DeerFlow + Codex                  |
| 5   | **CodeGraph 是代码理解的唯一入口**——Agent 不通过 grep/glob/ls 探索代码。符号图已经知道一切 | codegraph 47.5k★ + benchmark 数据 |
| 6   | **窄腰设计**——核心 Agent 循环 + 工具 schema 保持最小。新能力通过 Skill/Plugin/MCP 添加     | Claude Code + Hermes              |
| 7   | **Prompt 缓存不可侵犯**——系统提示词结构以最大化缓存命中率为目标。破坏缓存 = 设计 bug       | Claude Code + Hermes              |
| 8   | **事件溯源用于会话**——会话状态从事件流重建，完整审计 + 崩溃恢复 + 精确重放                 | OpenCode                          |
| 9   | **Plan Mode 默认开启**——Agent 必须先出计划，用户审批后执行                                 | Claude Code 验证                  |
| 10  | **500 行/文件，800 行硬上限**——在 Rust crate 体系中更容易执行                              | Cabinet v2 规范                   |

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

| 不做                                        | 原因                                      |
| ------------------------------------------- | ----------------------------------------- |
| 项目管理平台（Decision/Workflow）           | v2 的核心能力，但不是 Coding Agent 的场景 |
| IM Bot / 消息网关                           | 终端工具不需要飞书/Slack                  |
| 知识图谱（实体-关系）                       | 代码已经有 CodeGraph，不需要第二个图      |
| 多 Agent 内阁（Secretary/Curator/Organize） | v3 是单 Agent + 子 Agent，不需要角色扮演  |
| Web UI / 桌面应用                           | 终端优先。未来可加，但不是 MVP            |

---

## 二、Crate 全景

```
                        ┌──────────────────────────────────┐
                        │        cabinet-tui                │  Interface
                        │   (ratatui 终端界面)              │
                        └──────────────┬───────────────────┘
                                       │
                        ┌──────────────┴───────────────────┐
                        │       cabinet-app-core            │  Application
                        │   (CLI + Server + 会话编排)       │
                        └──────────────┬───────────────────┘
                                       │
        ┌──────────────────────────────┼──────────────────────────────┐
        │                              │                              │
┌───────┴────────┐  ┌─────────────────┴──┐  ┌────────────────────────┴──┐
│ cabinet-agent  │  │  cabinet-skill     │  │  cabinet-memory           │  Intelligence
│  - AgentLoop   │  │   - SkillRegistry  │  │   - 5-layer pipeline      │
│  - Observer    │  │   - Discovery      │  │   - Sideagent verify      │
│  - PlanMode    │  │   - Curator        │  │   - Consolidation         │
└───────┬────────┘  └────────┬───────────┘  └────────────┬──────────────┘
        │                    │                            │
        └────────────────────┼────────────────────────────┘
                             │
        ┌────────────────────┼────────────────────────────┐
        │                    │                            │
┌───────┴────────┐  ┌────────┴───────────┐  ┌───────────┴──────────┐
│ cabinet-exec   │  │ cabinet-gateway     │  │ cabinet-sandbox      │  Engine
│  - ExecEngine  │  │  - Provider trait   │  │  - DockerSandbox     │
│  - ExecPolicy  │  │  - CostTracker      │  │  - BwrapSandbox      │
│  - Shell       │  │  - BudgetGuard      │  │  - PathMapping       │
└───────┬────────┘  │  - FallbackChain    │  └───────────┬──────────┘
        │           └────────┬────────────┘              │
        │                    │                            │
┌───────┴────────┐  ┌────────┴───────────┐  ┌───────────┴──────────┐
│ cabinet-session│  │ cabinet-tool        │  │ cabinet-plugin       │  Engine
│  - EventSource │  │  - ToolRegistry     │  │  - PluginManager     │
│  - Projector   │  │  - ConcurrencySafe  │  │  - Marketplace        │
│  - Checkpoint  │  │  - 内置 15 工具     │  │                      │
└───────┬────────┘  └────────┬────────────┘  └───────────┬──────────┘
        │                    │                            │
        └────────────────────┼────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────────────────┐
│                           Foundation                                     │
│                                                                          │
│  ┌──────────────┐  ┌──────────────────┐  ┌────────────────────────────┐ │
│  │ cabinet-base │  │ cabinet-codegraph│  │ cabinet-*-types (8 个)     │ │
│  │  - Error     │  │  - tree-sitter   │  │  agent / tool / session    │ │
│  │  - Config    │  │  - SQLite index  │  │  memory / skill / exec     │ │
│  │  - Telemetry │  │  - FTS5 search   │  │  gateway / sandbox         │ │
│  └──────────────┘  │  - file watcher  │  │  permission                │ │
│                    └──────────────────┘  └────────────────────────────┘ │
│                                                                          │
│  ┌──────────────┐  ┌──────────────────┐  ┌────────────────────────────┐ │
│  │cabinet-      │  │ cabinet-otel     │  │ cabinet-embedding          │ │
│  │storage       │  │  - Tracing       │  │  - ONNX Runtime            │ │
│  │  - SQLite    │  │  - Metrics       │  │  - tokenizer               │ │
│  │  - Migration │  │  - Logs          │  │  - feature: local-embedding│ │
│  │  - Backup    │  │                  │  │                            │ │
│  └──────────────┘  └──────────────────┘  └────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 三、Foundation 层：逐 crate 详析

### 3.1 依赖规则

```
Foundation crate 之间允许的最小依赖：

  cabinet-*-types     → 无依赖（纯类型，连 cabinet-base 都不依赖）
  cabinet-base        → 无依赖
  cabinet-storage     → cabinet-base
  cabinet-otel        → cabinet-base
  cabinet-embedding   → cabinet-base
  cabinet-codegraph   → cabinet-base + cabinet-storage + cabinet-codegraph-types
```

`cabinet-codegraph` 在 Foundation 而非 Intelligence 层，因为它是代码理解的**基础设施**——就像 SQLite 是数据的基础设施一样。

### 3.2 `cabinet-base`

```rust
// 错误系统——trait-based，允许下游扩展
pub trait CabinetError: std::error::Error + Send + Sync {
    fn code(&self) -> &'static str;           // "AGENT_001"
    fn severity(&self) -> ErrorSeverity;       // Fatal | Recoverable | Transient
    fn user_message(&self) -> String;
    fn retryable(&self) -> bool;
}

pub enum ErrorSeverity { Fatal, Recoverable, Transient }

// 配置系统——版本化，向前兼容
pub struct ConfigV3 {
    pub version: u32,                          // 配置版本号
    pub providers: Vec<ProviderConfig>,
    pub agent: AgentConfig,
    pub sandbox: SandboxConfig,
    pub memory: MemoryConfig,
    pub permissions: PermissionsConfig,
    pub telemetry: TelemetryConfig,
}
// 内置迁移: ConfigV2 → ConfigV3，ConfigV1 → ConfigV2 → ConfigV3

// 遥测基础——所有 crate 共享的 tracing 宏
pub mod telemetry {
    // re-export tracing + opentelemetry 的基础宏
    // 每个 crate 通过 cabinet-base::telemetry::info!() 使用
}
```

### 3.3 `cabinet-storage`

```rust
// SQLite 连接管理
pub struct Database {
    conn: Connection,         // rusqlite, WAL mode
}

impl Database {
    pub fn open(path: &Path) -> Result<Self>;
    pub fn migrate(&self) -> Result<()>;     // 顺序迁移，不可逆
    pub fn backup(&self, dest: &Path) -> Result<()>;
    pub fn verify_integrity(&self) -> Result<bool>;
}

// Repository 层——每个领域一个 repo
pub mod repo {
    pub struct SessionRepo { /* 事件存储 */ }
    pub struct MemoryRepo { /* 记忆 + FTS5 */ }
    pub struct CheckpointRepo { /* 检查点 */ }
    pub struct SkillRepo { /* Skill 元数据 */ }
    pub struct PermissionRepo { /* 权限规则 */ }
    pub struct CostRepo { /* 成本历史 */ }
}
```

### 3.4 `cabinet-codegraph`：内置代码智能

```rust
// cabinet-codegraph-types:

pub struct CodeGraph {
    pub symbols: HashMap<SymbolId, Symbol>,
    pub edges: Vec<Edge>,
    pub files: HashMap<FilePath, FileInfo>,
    pub routes: Vec<FrameworkRoute>,
}

pub struct Symbol {
    pub id: SymbolId,
    pub name: String,
    pub kind: SymbolKind,          // Function | Method | Class | Trait | Module | Type
    pub location: SourceLocation,  // file + line + column
    pub signature: Option<String>,
    pub docstring: Option<String>,
    pub visibility: Visibility,    // Public | Crate | Private
    pub language: Language,
}

pub enum EdgeKind {
    Calls,          // fn A → fn B
    Imports,        // file A → module B
    Extends,        // class A → class B
    Implements,     // struct A → trait B
    Defines,        // file A → symbol B
    Routes,         // HTTP route → handler
}

pub struct FrameworkRoute {
    pub path: String,              // "/api/users/:id"
    pub method: HttpMethod,        // GET | POST | PUT | DELETE
    pub handler: SymbolId,         // → handler 函数
    pub framework: Framework,      // Express | FastAPI | Axum | Actix | Gin | ...
    pub file: FilePath,
}

// cabinet-codegraph-core:

pub struct CodeGraphIndex {
    db: Database,
    parser: TreeSitterParser,      // 多语言 tree-sitter parser
    watcher: FileWatcher,          // inotify / FSEvents / ReadDirectoryChanges
    config: CodeGraphConfig,
}

impl CodeGraphIndex {
    // ── 索引 ──
    pub fn index_project(&mut self, root: &Path) -> Result<IndexStats>;
    pub fn incremental_update(&mut self, changed_files: &[PathBuf]) -> Result<()>;
    pub fn watch(&self) -> Result<()>;   // 启动文件监控，2s 去抖动

    // ── 核心查询（Agent 直接调用） ──
    pub fn explore(&self, query: &str) -> Result<ExploreResult>;
    //   返回：入口符号 + 相关符号 + 调用者 + 被调用者 + 关键代码片段
    //   这是 Agent 最常用的单一入口，替代 grep + glob + ls + read(探索)

    pub fn search(&self, query: &str, kind: Option<SymbolKind>) -> Result<Vec<Symbol>>;
    pub fn callers(&self, symbol: &str) -> Result<Vec<CallSite>>;
    pub fn callees(&self, symbol: &str) -> Result<Vec<CallSite>>;
    pub fn impact(&self, symbol: &str, depth: u8) -> Result<ImpactResult>;
    pub fn files(&self, path: Option<&Path>) -> Result<FileTree>;
    pub fn routes(&self, framework: Option<Framework>) -> Result<Vec<FrameworkRoute>>;
    pub fn status(&self) -> Result<IndexStatus>;  // 索引健康检查
}

pub struct ExploreResult {
    pub entry_points: Vec<SymbolWithCode>,    // 匹配查询的入口符号 + 源代码
    pub related: Vec<Symbol>,                 // 相关符号
    pub callers: Vec<CallSite>,               // 谁调用了这些符号
    pub callees: Vec<CallSite>,               // 这些符号调用了谁
    pub route_links: Vec<FrameworkRoute>,     // HTTP 路由 → handler 映射
    pub summary: String,                      // 一句话总结
}
```

**关键设计决策：**

1. **SQLite + FTS5**（参考 codegraph TypeScript 版）——零外部服务。SurrealDB 的向量搜索额外复杂度在 MVP 阶段不值得。以后可以利用 `cabinet-embedding` 在 SQLite 之外加 HNSW 索引
2. **tree-sitter**——Rust 原生 binding。直接复用 codegraph 社区维护的 20+ 语言 queries
3. **自动索引**——Agent 启动时扫描项目根目录，跳过 `.gitignore` + `node_modules` + `target` + `dist`
4. **工具替代协议**——Agent 有了 CodeGraph 后，**不应该**再手动 grep/glob/ls。prompt 中明确这个约束
5. **语言覆盖**——MVP 覆盖 Rust + TypeScript + Python + Go。后续扩展到 codegraph 支持的 20+ 语言

### 3.5 `cabinet-*-types`：8 个纯类型 crate

| Crate                      | 核心内容                                                                 | 行数估算 |
| -------------------------- | ------------------------------------------------------------------------ | -------- |
| `cabinet-agent-types`      | `AgentConfig`, `AgentEvent`, `PlanStep`, `AgentObserver` trait           | ~200     |
| `cabinet-tool-types`       | `ToolDefinition`, `ToolResult`, `ToolCategory`, `ConcurrencySafety`      | ~150     |
| `cabinet-session-types`    | `SessionEvent` enum (12 variants), `SessionState`, `Projector` trait     | ~200     |
| `cabinet-memory-types`     | `MemoryEntry`, `WriteGateTier`, `Embedding`, `RelevanceScore`            | ~200     |
| `cabinet-skill-types`      | `SkillMetadata`, `SkillEntry`, `ParsedSkill`, `SkillKind`, `SkillStatus` | ~150     |
| `cabinet-exec-types`       | `ShellCommand`, `ExecPolicy`, `ExecRule`, `ExecEffect`                   | ~150     |
| `cabinet-gateway-types`    | `ProviderConfig`, `ModelRequest`, `ModelResponse`, `TokenUsage`          | ~150     |
| `cabinet-permission-types` | `PermissionRule`, `PermissionEffect`, `WildcardPattern`                  | ~100     |
| `cabinet-codegraph-types`  | `CodeGraph`, `Symbol`, `Edge`, `FrameworkRoute`                          | ~200     |
| `cabinet-sandbox-types`    | `SandboxConfig`, `SandboxProvider` trait, `PathMapping`                  | ~100     |

这些 crate 的特点：

- **零依赖**——除了 Rust std，不依赖任何东西
- **纯数据**——`struct` + `enum` + `trait` 定义，无实现
- **编译快**——几百行的纯类型，秒级编译
- **可被任何 crate 依赖**——不引入实现的重编译

### 3.6 `cabinet-embedding`

```rust
// Feature gate: "local-embedding" (默认关闭)
// 开启后: 使用 ONNX Runtime 本地推理

pub struct EmbeddingEngine {
    model: OrtModel,                // ONNX 模型
    tokenizer: Tokenizer,           // HuggingFace tokenizer
    dimension: usize,               // 384 (all-MiniLM) ~ 1536 (ada-002)
}

impl EmbeddingEngine {
    pub fn embed(&self, texts: &[&str]) -> Result<Vec<Vec<f32>>>;
    pub fn embed_query(&self, query: &str) -> Result<Vec<f32>>;
    pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32;
}
// 用途: 记忆检索 / Skill 匹配 / CodeGraph 语义搜索（未来）
```

---

## 四、Engine 层

### 4.1 `cabinet-exec`：执行引擎

```rust
// cabinet-exec-types: ShellCommand, ExecPolicy

pub struct ShellCommand {
    pub program: String,
    pub args: Vec<String>,
    pub working_dir: Option<PathBuf>,
    pub env: HashMap<String, String>,
    pub timeout: Duration,              // 默认 300s
}

pub struct ExecPolicy {
    pub rules: Vec<ExecRule>,
}

pub struct ExecRule {
    pub pattern: ExecPattern,
    pub effect: ExecEffect,
    pub reason: String,                 // 面向用户的解释
}

pub enum ExecEffect { Allow, Deny, AskUser }

pub enum ExecPattern {
    Exact(String),                      // "cargo build"
    Prefix(String),                     // "git *"
    Glob(String),                       // "*"
    Program(String),                    // "/usr/bin/*"
}

// 内置默认策略（参考 Codex execpolicy）:
//   cargo build/test/check/clippy → Allow
//   git status/log/diff/branch    → Allow
//   rm -rf /, dd, mkfs, chmod 777 → Deny (always)
//   curl/wget                     → AskUser
//   npm/pnpm/yarn install         → Allow (project root)
//   npm/pnpm/yarn publish         → AskUser
//   git push                      → AskUser (默认), 可配置 Allow

// cabinet-exec-core: ExecEngine
pub struct ExecEngine {
    sandbox: Arc<dyn SandboxProvider>,
    policy: ExecPolicy,
}

impl ExecEngine {
    pub async fn execute(&self, cmd: &ShellCommand) -> Result<ExecOutput> {
        // 1. ExecPolicy 检查 → Allow / Deny / AskUser
        // 2. Shell 命令构造（类型安全，不是字符串拼接）
        // 3. 沙箱执行
        // 4. 结果收集（stdout + stderr + exit_code + duration）
    }
}
```

### 4.2 `cabinet-gateway`：LLM 网关

```rust
// 保留 Cabinet v2 在成本控制和可靠性上的所有优势
// 学习 jcode 的独立 Provider crate 结构

pub trait Provider: Send + Sync {
    fn name(&self) -> &'static str;
    fn supported_models(&self) -> &[ModelInfo];
    async fn generate(&self, request: ModelRequest) -> Result<ModelResponse>;
    async fn stream(&self, request: ModelRequest) -> impl Stream<Item = StreamChunk>;
    fn supports_thinking(&self) -> bool;
    fn supports_vision(&self) -> bool;
}

// 每个 Provider 独立文件（不是独立 crate——MVP 不需要那么细粒度）:
//   src/provider/anthropic.rs   → Claude (Messages API)
//   src/provider/openai.rs      → OpenAI (Chat Completions)
//   src/provider/gemini.rs      → Google Gemini
//   src/provider/copilot.rs     → GitHub Copilot
//   src/provider/openrouter.rs  → OpenRouter (15+ models)
//   src/provider/ollama.rs      → Ollama (本地)
//   src/provider/lmstudio.rs    → LM Studio (本地)
//   src/provider/bedrock.rs     → AWS Bedrock

// Provider 之间完全独立——修改 Anthropic 不影响 OpenAI

// 成本控制（保留 Cabinet v2 优势）:
pub struct CostTracker { /* RMB 定价表，8 个 Provider × 20+ 模型 */ }
pub struct BudgetGuard { /* ok → warning(80%) → critical(95%) → blocked(100%) */ }
pub struct RateLimitTracker { /* HTTP 响应头解析 */ }
pub struct FallbackChain { /* 指数退避 1s/2s/4s + 模型降级 */ }
```

### 4.3 `cabinet-sandbox`

```rust
// cabinet-sandbox-types:

pub trait SandboxProvider: Send + Sync {
    async fn execute(&self, cmd: &ShellCommand) -> Result<ExecOutput>;
    async fn read_file(&self, path: &Path) -> Result<String>;
    async fn write_file(&self, path: &Path, content: &str) -> Result<()>;
    async fn list_dir(&self, path: &Path) -> Result<Vec<DirEntry>>;
    fn resolve_path(&self, virtual_path: &Path) -> PathBuf;
    fn network_enabled(&self) -> bool;
    fn set_network_enabled(&mut self, enabled: bool);
}

// 三种实现:
//   DockerSandbox        → 生产默认。Docker 容器，网络默认关闭
//   BubblewrapSandbox    → Linux 原生，更轻量（无 Docker daemon 依赖）
//   LocalSandbox         → 开发用（仅 dev profile 下编译，`#[cfg(debug_assertions)]`）

// 虚拟路径映射:
//   /mnt/workspace  → ~/.cabinet/sandbox/{session_id}/workspace
//   /mnt/outputs    → ~/.cabinet/sandbox/{session_id}/outputs
//   /mnt/skills     → ~/.cabinet/skills/
//   /mnt/project    → (read-only) 用户项目根目录
```

### 4.4 `cabinet-session`

```rust
// cabinet-session-types:

pub enum SessionEvent {
    Created        { id: SessionId, project: PathBuf, timestamp: DateTime },
    PromptSubmitted { msg_id: MessageId, content: String, delivery: DeliveryMode },
    TurnStarted    { turn_id: TurnId },
    ModelResponded { content: String, tool_calls: Vec<ToolCall>, usage: TokenUsage },
    ToolExecuted   { call_id: CallId, name: String, result: ToolResult },
    TurnCompleted  { turn_id: TurnId },
    CompactionHappened { before: usize, after: usize },
    ModelSwitched  { from: String, to: String },
    Interrupted    { source: InterruptSource },
    TitleChanged   { title: String },
    PlanApproved   { plan_id: PlanId },
    PlanRejected   { plan_id: PlanId, reason: String },
}

pub struct SessionState {
    pub messages: Vec<Message>,
    pub turn_count: u32,
    pub total_tokens: TokenUsage,
    pub title: Option<String>,
    pub model: String,
    pub plan: Option<Plan>,
    pub codegraph_status: IndexStatus,  // 会话开始时的索引状态
}

pub trait Projector {
    fn apply(&mut self, event: &SessionEvent) -> Result<()>;
    fn snapshot(&self) -> SessionState;
}

// cabinet-session-core:

pub struct SessionManager {
    event_store: SessionRepo,        // 事件持久化
    projector: Box<dyn Projector>,
    snapshot_interval: u32,          // 每 N 个事件创建一个 snapshot
}

impl SessionManager {
    // 幂等 prompt 提交——相同 (session_id, msg_id, content) → 返回已有结果
    pub async fn submit_prompt(&mut self, session: &SessionId, msg: PromptInput) -> Result<()>;
    pub async fn replay(&self, session: &SessionId) -> Result<SessionState>;
    pub async fn fork(&self, session: &SessionId, at_event: usize) -> Result<SessionId>;
    pub async fn compact(&mut self, session: &SessionId) -> Result<CompactionResult>;
}
```

**为什么事件溯源只用于会话：**

- 会话有最强的审计/重放/分叉需求——调试时需要精确回放"Agent 在第 3 步为什么做了那个决定"
- 其他领域（Memory/Tool/Skill）用传统 CRUD + 版本号——写入频率高，事件存储的额外开销不划算

### 4.5 `cabinet-tool`

```rust
// cabinet-tool-types:

pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: JsonSchema,
    pub category: ToolCategory,             // ReadOnly | Write | Destructive
    pub is_concurrency_safe: bool,          // 并行安全标记
    pub requires_approval: Option<&'static str>, // 审批理由（None = 不需要）
    pub feature_gate: Option<&'static str>, // Feature flag
}

pub enum ToolCategory { ReadOnly, Write, Destructive }

// cabinet-tool-core:

pub struct ToolRegistry {
    tools: HashMap<String, ToolDefinition>,
    search_index: FtsIndex,                  // 工具搜索索引
}

impl ToolRegistry {
    pub fn register(&mut self, tool: ToolDefinition);
    pub fn register_scoped(&mut self, tool: ToolDefinition) -> ToolGuard;
    //   ToolGuard 实现 Drop → Drop 时自动从 registry 注销
    //   用于 Plugin/Skill 引入的工具——Plugin 卸载时自动清理

    pub fn search(&self, query: &str) -> Vec<&ToolDefinition>;
    pub fn create_view(&self, allowed: &[&str]) -> ToolView;

    pub fn get_for_agent(&self, _agent_type: AgentType) -> Vec<&ToolDefinition>;
    //   不同类型 Agent 有不同的默认工具集
}
```

**内置工具（MVP——15 个）：**

| 工具                            | 类别           | 来源/参考                                         |
| ------------------------------- | -------------- | ------------------------------------------------- |
| `codegraph_explore`             | ReadOnly       | **新设计**——替代 grep + glob + ls + read(探索)    |
| `codegraph_search`              | ReadOnly       | codegraph MCP                                     |
| `codegraph_impact`              | ReadOnly       | codegraph MCP                                     |
| `read_file`                     | ReadOnly       | 读取非索引文件（.md, .json, .toml）或完整代码文件 |
| `write_file`                    | Write          | 创建新文件                                        |
| `edit_file`                     | Write          | 精确修改已有文件                                  |
| `apply_patch`                   | Write          | 流式 patch 应用（参考 Codex apply-patch crate）   |
| `bash`                          | Destructive    | 通过 `cabinet-exec` + 沙箱执行                    |
| `web_fetch`                     | ReadOnly       | 获取文档/API 参考                                 |
| `web_search`                    | ReadOnly       | 搜索解决方案                                      |
| `todo_write`                    | Write          | Plan Mode 中的任务跟踪                            |
| `task`                          | Write          | 生成子代理处理独立子任务                          |
| `skill_invoke`                  | ReadOnly       | 调用已安装的 Skill                                |
| `skill_create`                  | Write          | Agent 自主创建 Skill                              |
| `memory_search` / `memory_save` | ReadOnly/Write | 记忆存取                                          |

**CodeGraph 如何改变工具调用模型：**

传统 Agent 的代码探索路径被压缩为一次调用：

```
旧: grep("middleware") → glob("src/**/*.rs") → ls("src/auth/") → read("auth.rs") → ...
新: codegraph_explore("auth middleware") → 一次返回所有相关信息
```

Agent 的系统提示词中会明确：

```
## 代码探索协议

当需要理解代码时，使用 codegraph_explore。
不要手动 grep/glob/ls 遍历文件。
CodeGraph 已经索引了整个代码库的符号、调用关系和路由。

read_file 仅在以下情况使用:
1. 读取非索引文件（.md, .json, .toml, .yaml）
2. codegraph_explore 返回的代码片段不完整，需要更多上下文
3. 用户明确要求读取特定文件
```

### 4.6 `cabinet-plugin`

```rust
pub enum PluginKind {
    Provider,    // 添加 LLM Provider（Ollama, LM Studio, 自定义端点）
    Tool,        // 注册自定义工具
    Skill,       // 注册 Skill 包
    Command,     // 注册斜杠命令
    Hook,        // 注册生命周期钩子
}

pub struct PluginManifest {
    pub name: String,
    pub version: semver::Version,
    pub kind: PluginKind,
    pub hooks: Vec<HookRegistration>,
}

pub struct PluginManager {
    plugins: HashMap<String, LoadedPlugin>,
    marketplace: MarketplaceClient,
}

impl PluginManager {
    pub fn discover(&self) -> Vec<PluginManifest>;      // 扫描 ~/.cabinet/plugins/
    pub fn install(&mut self, source: PluginSource) -> Result<()>;
    pub fn uninstall(&mut self, name: &str) -> Result<()>;
    pub fn hooks_for(&self, event: HookEvent) -> Vec<&HookRegistration>;
}

pub enum HookEvent {
    SessionStart, PreToolCall, PostToolCall,
    PreCompact, PostCompact, PreLLMCall, PostLLMCall,
}
```

---

## 五、Intelligence 层

### 5.1 `cabinet-agent`

```rust
// cabinet-agent-types:

pub trait AgentObserver: Send + Sync {
    fn name(&self) -> &'static str;

    fn on_session_start(&self, _ctx: &mut AgentContext) -> Result<()> { Ok(()) }
    fn on_user_input(&self, _ctx: &mut AgentContext, _msg: &str) -> Result<Option<BlockReason>> { Ok(None) }
    fn on_pre_llm_call(&self, _ctx: &mut AgentContext, _req: &ModelRequest) -> Result<()> { Ok(()) }
    fn on_post_llm_call(&self, _ctx: &mut AgentContext, _resp: &ModelResponse) -> Result<()> { Ok(()) }
    fn on_tool_call(&self, _ctx: &mut AgentContext, _call: &ToolCall) -> Result<Option<BlockReason>> { Ok(None) }
    fn on_tool_result(&self, _ctx: &mut AgentContext, _call: &ToolCall, _result: &ToolResult) -> Result<()> { Ok(()) }
    fn on_step_end(&self, _ctx: &mut AgentContext) -> Result<Option<HandoffSignal>> { Ok(None) }
    fn on_session_end(&self, _ctx: &mut AgentContext, _summary: &SessionSummary) -> Result<()> { Ok(()) }
}

// 默认 Observer 注册顺序（有文档约束）:
//
// 1. ContentGuardObserver      → on_user_input: 检查注入攻击
// 2. SafetyCheckObserver        → on_tool_call: 按 ExecPolicy 检查危险操作
// 3. ToolExecuteObserver        → on_tool_call/on_tool_result: 追踪工具统计
// 4. StepEventObserver          → on_step_end: 每步事件写入 SessionEvent
// 5. ContextMonitorObserver     → on_step_end: 估算 token 使用量
// 6. CompactionObserver         → on_step_end: 达到阈值时触发上下文压缩
// 7. CheckpointObserver         → on_step_end: 每 N 步保存 checkpoint
// 8. ReflectionObserver         → on_step_end: Agent 自我反思（可选 enabled）
// 9. JudgeObserver              → on_step_end: LLM-as-Judge 评估输出（可选）
// 10. ClarificationObserver     → on_tool_call: 高风险操作强制确认（始终最后）

// cabinet-agent-core:

pub struct AgentLoop {
    gateway: Arc<dyn Provider>,
    tools: Arc<ToolRegistry>,
    codegraph: Arc<CodeGraphIndex>,
    exec: Arc<ExecEngine>,
    sandbox: Arc<dyn SandboxProvider>,
    memory: Arc<MemoryFacade>,
    skills: Arc<SkillRegistry>,
    session: SessionManager,
    observers: Vec<Box<dyn AgentObserver>>,
    config: AgentConfig,
}

impl AgentLoop {
    pub async fn run(&mut self, user_message: &str) -> Result<AgentResult> {
        // 1. 转录提前持久化——用户消息在 LLM 调用前写入 session event
        //    （参考 Claude Code: "crash-resilience: persist transcript early"）
        //
        // 2. Plan Mode 检查
        //    if config.plan_mode && self.session.current_plan().is_none():
        //        → 进入 Plan Mode:
        //          a. Agent 用 codegraph_explore 探索代码库（只读）
        //          b. Agent 输出 Plan（用 todo_write 工具）
        //          c. Agent 调用 enter_plan_mode → 暂停，用户审批
        //
        // 3. 主循环:
        //    while self.session.turn_count() < config.max_turns {
        //      // 组装上下文（CodeGraph 状态 + 记忆 + Skill 索引 + 项目上下文）
        //      // LLM 调用
        //      // 工具分发:
        //      //   - 并发安全的工具 → 并行执行
        //      //   - 写入/破坏性工具 → 串行执行
        //      // Observer 通知
        //    }
        //
        // 4. 会话持久化（事件流写入 + snapshot 更新）
    }
}
```

**Plan Mode 流程（参考 Claude Code）：**

```
用户: "把 auth 模块的错误处理改成 thiserror"

Agent 进入 Plan Mode:
  1. codegraph_explore("auth error handling")  → 理解现有代码
  2. codegraph_impact("AuthError")             → 分析修改影响范围
  3. todo_write([
       {id:1, content:"分析现有错误处理模式", status:"completed"},
       {id:2, content:"添加 thiserror 依赖到 Cargo.toml", status:"pending"},
       {id:3, content:"重构 AuthError enum 使用 #[derive(Error)]", status:"pending"},
       {id:4, content:"更新所有 AuthError 的 match 分支", status:"pending"},
       {id:5, content:"运行 cargo test 验证", status:"pending"},
     ])
  4. enter_plan_mode → TUI 显示计划

用户审批（可以修改步骤、拒绝某一步、全部批准）
  → Agent 退出 Plan Mode，进入执行模式
  → 按计划逐步执行，每完成一步更新 todo 状态
  → 计划外的操作需要额外审批
```

### 5.2 `cabinet-skill`

```rust
// cabinet-skill-types:

pub struct SkillMetadata {
    pub name: String,                      // "rust-error-handling-refactor"
    pub description: String,               // ≤ 60 chars
    pub kind: SkillKind,                   // Prompt | Tool | Composite
    pub created_by: Author,                // User | Agent
    pub allowed_tools: Vec<String>,        // Skill 声明的工具白名单（安全隔离）
    pub requires_tools: Vec<String>,       // 需要的工具不可用时 → 隐藏 Skill
    pub fallback_for_tools: Vec<String>,   // 工具可用时 → 隐藏 Skill（优先用工具）
    pub version: u32,
    pub status: SkillStatus,               // Active | Stale | Archived
    pub last_used: Option<DateTime>,
    pub usage_count: u32,
}

impl SkillMetadata {
    // Skill 有效载荷——三级渐进加载
    pub fn brief(&self) -> String;         // L1: "/skill-name: description (~50 tokens)"
    pub fn full_body(&self) -> String;     // L2: 完整 SKILL.md body
    pub fn references(&self) -> Vec<PathBuf>; // L3: references/ 目录文件路径
    pub fn scripts(&self) -> Vec<PathBuf>;    // L3: scripts/ 目录脚本路径
}

// cabinet-skill-core:

pub struct SkillRegistry { /* 注册 + 发现 + 加载 */ }
pub struct Curator {       /* 自动生命周期管理: Active → Stale(30d) → Archived(90d) */ }
pub struct SkillGenerator { /* Agent 完成复杂任务后自主创建 Skill */ }

impl SkillRegistry {
    // Embedding 匹配加载（参考 jcode）:
    //   不是全量加载所有 Skill，而是根据用户任务计算 embedding
    //   匹配 top-5 相关 Skill 注入 prompt
    pub fn match_for_task(&self, task: &str) -> Vec<&SkillEntry>;

    // 条件显示（参考 Hermes）:
    //   if tool_available(skill.fallback_for_tools) → 隐藏 Skill（用工具更好）
    //   if !tool_available(skill.requires_tools)    → 隐藏 Skill（工具不可用）
    pub fn visible_skills(&self, available_tools: &[&str]) -> Vec<&SkillMetadata>;
}
```

### 5.3 `cabinet-memory`

```rust
// cabinet-memory-core:

// 5 层流水线（保留 Cabinet v2 的最佳设计）:
//
// ShortTermMemory  → 会话 KV + Turn 日志, LRU + TTL 30min
//     ↓
// WriteGate        → 5 级分类:
//                       working:   显式 remember 命令
//                       register:  行为变更、承诺、决策
//                       daily:     稳定事实
//                       transient_noise: 丢弃
//                       structured_prefix: decision_/preference_/milestone_
//     ↓
// CascadeBuffer    → L0 暂存, minCount=3 / maxAge=30min 自动封存
//     ↓
// LongTermMemory   → SQLite + FTS5 + 可选 HNSW 向量索引, 500K 上限
//     ↓
// MemoryDecay      → expire → archive → supersede → prune

pub struct MemoryFacade {
    short_term: ShortTermMemory,
    write_gate: WriteGate,
    cascade: CascadeBuffer,
    long_term: LongTermMemory,
    decay: MemoryDecayService,
    sideagent: Sideagent,                  // 注入前验证相关性（参考 jcode）
    embedding: Option<EmbeddingEngine>,    // 本地 ONNX 或远程 API
}

impl MemoryFacade {
    // 注入前验证——sideagent 检查候选记忆的相关性
    // 过滤掉 relevance < 0.6 的记忆
    pub async fn recall_verified(
        &self, query: &str, session_id: &SessionId
    ) -> Vec<VerifiedMemory>;

    // 与 CodeGraph 集成——记忆可以关联到代码符号
    pub async fn associate_with_symbol(
        &self, memory_id: &str, symbol: &SymbolId
    ) -> Result<()>;
    //   "Captain 偏好使用 Result<T> 而非 panic" → 关联到 error.rs::handle_error
}
```

---

## 六、Application 与 Interface 层

### 6.1 `cabinet-app-core`

```rust
// 三种运行模式:

// 1. 交互模式: cabinet
//    → 启动 TUI，进入交互式对话

// 2. 非交互模式: cabinet run "fix the bug in auth.rs"
//    → 输出到 stdout，适合脚本/CI

// 3. 服务模式: cabinet serve
//    → 启动持久化服务器（cabinet connect 远程连接）
//    → 支持多个 TUI 客户端连接（Swarm 将来使用）

pub struct App {
    config: ConfigV3,
    codegraph: Arc<CodeGraphIndex>,
    agent: Option<AgentLoop>,
    server: Option<Server>,
}

impl App {
    pub async fn new(config: ConfigV3) -> Result<Self> {
        // 1. 加载配置
        // 2. 初始化 CodeGraphIndex → 如果项目目录存在，自动索引
        // 3. 初始化 Provider（根据配置选择）
        // 4. 初始化 Sandbox（Docker / Bwrap / Local）
        // 5. 初始化 ToolRegistry（注册 15 个内置工具）
        // 6. 初始化 MemoryFacade
        // 7. 初始化 SkillRegistry（扫描 ~/.cabinet/skills/ + 项目 .cabinet/skills/）
        // 8. 构建 AgentLoop
    }

    pub async fn run_interactive(&mut self) -> Result<()>;
    pub async fn run_headless(&mut self, prompt: &str) -> Result<String>;
    pub async fn serve(&mut self, addr: SocketAddr) -> Result<()>;
}
```

### 6.2 `cabinet-tui`

```rust
// 使用 ratatui + crossterm
// 参考 Claude Code 的 TUI 架构，但保持简洁

// 主布局:
//
// ┌──────────────────────────────────────────────────────┐
// │  [Plan Mode: ON] [Model: claude-sonnet-4-6] [Session]│ ← Status Bar
// ├──────────────────────────────────────────────────────┤
// │                                                      │
// │  🤖 我来分析 auth 模块的错误处理...                    │ ← 聊天区
// │                                                      │
// │  ▸ 当前使用 String 作为错误类型，建议改用 thiserror   │
// │  ▸ 影响的文件: auth.rs, middleware.rs, handler.rs    │
// │                                                      │
// ├──────────────────────────────────────────────────────┤
// │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  │ ← 侧边栏
// │  📋 Plan                                         │    │   (切换: Tab)
// │  ✓ 分析现有错误处理模式                              │    │
// │  ⏳ 添加 thiserror 依赖                             │    │
// │  ⬜ 重构 AuthError enum                             │    │
// │  ⬜ 更新 match 分支                                  │    │
// │  ⬜ 运行 cargo test                                  │    │
// │                                                    │    │
// │  📊 CodeGraph Impact (auth.rs → 12 callers)         │    │
// │  💾 Memory: "Captain prefers Result<T> over panic"  │    │
// ├──────────────────────────────────────────────────────┤
// │  > _                                           [Send]│ ← 输入区
// └──────────────────────────────────────────────────────┘

pub struct Tui {
    terminal: Terminal<CrosstermBackend<Stdout>>,
    chat: ChatWidget,
    sidebar: SidePanel,
    composer: Composer,
    status_bar: StatusBar,
}

impl Tui {
    pub async fn run(&mut self, app: Arc<App>) -> Result<()>;
}
```

**侧边栏内容（按 Tab 切换）：**

| Tab           | 内容                                     |
| ------------- | ---------------------------------------- |
| **Plan**      | 当前 Plan 的任务列表，每完成一步自动更新 |
| **CodeGraph** | 最近 codegraph 查询的符号和关系图        |
| **Memory**    | 与当前任务相关的记忆                     |
| **Skills**    | 匹配当前任务的 Skill                     |
| **Diff**      | 最近的文件修改（语法高亮）               |

---

## 七、安全架构

### 7.1 5 层安全模型

```
Layer 1: Sandbox
  ├── 文件系统隔离（虚拟路径映射）
  ├── 网络隔离（Shell 执行时自动禁用）
  └── 进程隔离（Docker / Bubblewrap）

Layer 2: ExecPolicy
  ├── 声明式命令规则（Allow / Deny / AskUser）
  ├── 内置安全默认值（rm -rf → Deny, cargo build → Allow）
  └── 用户可自定义（~/.cabinet/execpolicy.toml）

Layer 3: Permissions
  ├── 通配符规则（action + resource + effect）
  ├── Skill 声明 allowed_tools（工具白名单）
  └── 用户持久化规则（~/.cabinet/permissions.toml）

Layer 4: Plan Mode（默认开启）
  ├── Agent 必须先 Plan 后执行
  ├── 计划外操作 → 额外审批
  └── 破坏性操作 → 总是需要审批

Layer 5: Clarification（Observer 管道最后一道防线）
  └── 不明确/高风险操作 → 强制询问用户
```

### 7.2 ExecPolicy 默认规则

```toml
# ~/.cabinet/execpolicy.toml (用户可编辑)

[[rules]]
pattern = "cargo build*"
effect = "allow"
reason = "构建项目是安全操作"

[[rules]]
pattern = "cargo test*"
effect = "allow"

[[rules]]
pattern = "git status*"
effect = "allow"
[[rules]]
pattern = "git diff*"
effect = "allow"
[[rules]]
pattern = "git log*"
effect = "allow"

[[rules]]
pattern = "rm -rf /*"
effect = "deny"
reason = "递归删除根目录——永远禁止"

[[rules]]
pattern = "git push*"
effect = "ask_user"
reason = "推送到远程仓库需要确认"

[[rules]]
pattern = "curl*"
effect = "ask_user"
[[rules]]
pattern = "wget*"
effect = "ask_user"

[[rules]]
pattern = "npm publish*"
effect = "ask_user"
[[rules]]
pattern = "cargo publish*"
effect = "ask_user"
```

---

## 八、MVP 范围与演进

### 8.1 MVP（v0.1.0）——约 8-12 周单人

**Foundation:**

- [x] cabinet-base, cabinet-\*-types (8 个), cabinet-storage, cabinet-otel

**Foundation（核心差异化）:**

- [x] cabinet-codegraph (tree-sitter + SQLite + FTS5 + file watcher)
  - 支持 Rust + TypeScript + Python + Go 四种语言
  - 自动索引、增量更新

**Engine:**

- [x] cabinet-exec (ExecEngine + ExecPolicy + Shell abstraction)
- [x] cabinet-gateway (Provider trait + Anthropic + OpenAI + OpenRouter)
- [x] cabinet-sandbox (DockerSandbox)
- [x] cabinet-session (EventSourcing + Projector + Checkpoint)
- [x] cabinet-tool (ToolRegistry + 15 个内置工具)

**Intelligence:**

- [x] cabinet-agent (AgentLoop + Observer pipeline + Plan Mode)
- [x] cabinet-skill (SkillRegistry——手动创建/加载 Skill)
- [x] cabinet-memory (ShortTerm + WriteGate + LongTerm——不包含 CascadeBuffer 和 Decay)

**Application:**

- [x] cabinet-app-core (CLI: cabinet, cabinet run)

**Interface:**

- [x] cabinet-tui (基本 TUI: 消息 + 输入 + Plan 侧边栏)

**不包含在 MVP 中:**

- cabinet-embedding (本地 ONNX)
- cabinet-plugin (插件系统)
- Curator (Skill 生命周期管理)
- CascadeBuffer + MemoryDecay
- Swarm 多 Agent
- Server 模式 (cabinet serve)

### 8.2 v0.2.0 — 安全增强

- BubblewrapSandbox (Linux 原生，无 Docker 依赖)
- 网络隔离（shell 执行时自动禁用）
- Permissions 规则持久化和用户编辑
- Clarification 机制完善

### 8.3 v0.3.0 — 智能增强

- Curator (Skill 生命周期管理)
- Skill 自动生成 (Agent 从经验创建 Skill)
- CascadeBuffer + MemoryDecay
- 本地 ONNX Embedding
- Sideagent 记忆验证

### 8.4 v0.4.0 — 协作与生态

- Swarm 多 Agent (文件冲突检测 + DM)
- Server 模式 (cabinet serve / connect)
- Plugin Marketplace
- MCP 服务器模式 (cabinet 自身暴露为 MCP Server)
- 跨工具会话导入

---

## 九、待讨论的决策点

### 决策 1：Provider 是否独立 crate

我提议 MVP 阶段 Provider 作为 `cabinet-gateway` 内的独立文件（`src/provider/anthropic.rs`），而不是独立 crate。

**理由：** MVP 只需要 3-4 个 Provider。独立 crate 带来的编译缓存优势在 < 5 个 Provider 时不够显著。当 Provider 数量超过 8 个时再拆分。

### 决策 2：CodeGraph 的语言覆盖

MVP 覆盖 Rust + TypeScript + Python + Go。这是 4 种最常用的语言，也是 codegraph 验证过准确率最高的语言（Python 100%, TypeScript 95.8%, Go 96.6%, Rust 86.7%）。

后续扩展到 20+ 语言可以直接复用 codegraph 社区的 tree-sitter queries。

### 决策 3：TUI 的 Plan Mode 可视化

Plan Mode 是默认行为，TUI 需要让用户清晰地看到：

- Agent 当前在 Plan Mode 还是执行模式
- Plan 的每一步的状态
- 计划外的操作 → 高亮警告，需要审批

### 决策 4：配置文件格式

我提议用 TOML（`~/.cabinet/config.toml`）。理由：

- Rust 原生支持（`toml` crate 是 `cargo` 使用的格式）
- 比 YAML 更简洁（无缩进问题）
- 比 JSON 更可读

### 决策 5：日志和遥测

MVP 阶段：

- 日志用 `tracing` + `tracing-subscriber`，输出到 `~/.cabinet/logs/`（每日文件 + stderr）
- 不发送任何遥测数据（隐私优先）
- 可观测性数据仅本地 SQLite（`cabinet-storage` 的 `CostRepo`、`SessionRepo`）

---

> 这是完整的 v3 架构设计方案。所有设计决策都有明确的来源——来自 Cabinet v2 的经验教训、7 份对标报告的精华、和 CodeGraph 内置的架构决策。
>
> 下一步可以逐 crate 讨论实现细节，或者先对齐 MVP 范围和时间线。
