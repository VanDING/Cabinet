# Cabinet ↔ jcode 全维度深度对比分析报告

> 生成日期：2026-06-12
> 分析范围：jcode（7k+ Star，1jehuang，Rust）与 Cabinet v2.0（TypeScript 重写后）
> 目的：逐层、逐模块、逐设计识别差距与改进机会

---

## 目录

1. [项目概览与定位对比](#一项目概览与定位对比)
2. [架构层对比](#二架构层对比)
3. [Agent 核心执行对比](#三agent-核心执行对比)
4. [多 Agent / Swarm 系统对比](#四多-agent--swarm-系统对比)
5. [记忆系统对比](#五记忆系统对比)
6. [工具与 Provider 对比](#六工具与-provider-对比)
7. [用户界面与交互对比](#七用户界面与交互对比)
8. [独特能力对比](#八独特能力对比)
9. [性能哲学对比](#九性能哲学对比)
10. [工程纪律对比](#十工程纪律对比)
11. [关键设计差异总结表](#十一关键设计差异总结表)
12. [优先级改进建议](#十二优先级改进建议)
13. [结论](#十三结论)

---

## 一、项目概览与定位对比

### 1.1 基本信息

| 维度                   | jcode                                                                               | Cabinet                                |
| ---------------------- | ----------------------------------------------------------------------------------- | -------------------------------------- |
| **全称**               | jcode                                                                               | Cabinet — "Your AI Council"            |
| **作者/组织**          | 1jehuang（个人开发者）                                                              | Cabinet Dev                            |
| **一句话描述**         | "Coding Agent Harness" — 下一代编码 Agent 驾驭框架                                  | "Your AI Council"（你的 AI 内阁）      |
| **定位**               | **极致性能**的编码 Agent 驾驭框架——多会话工作流、Swarm 多 Agent 协作、自修改/自构建 | AI 驱动的项目管理与自主执行平台        |
| **开源时间**           | 2026-01-05                                                                          | 未公开                                 |
| **GitHub Star**        | 7,000+                                                                              | —                                      |
| **Fork**               | 787                                                                                 | —                                      |
| **Open Issues**        | 147                                                                                 | —                                      |
| **主语言**             | **Rust**                                                                            | TypeScript                             |
| **代码规模**           | **70+ crates**（Cargo workspace）                                                   | 15 packages + 2 apps（pnpm workspace） |
| **运行时**             | 原生二进制                                                                          | Node.js (ES2022)                       |
| **构建系统**           | Cargo                                                                               | pnpm + tsc -b                          |
| **UI**                 | **ratatui TUI** + 自研 Handterm 终端 + iOS 计划中                                   | Tauri 桌面应用 + Hono 服务端           |
| **内存占用（单会话）** | **27.8 MB**                                                                         | ~100-200 MB（Node.js 基线）            |
| **License**            | MIT                                                                                 | MIT                                    |
| **安装**               | Shell 脚本 / Homebrew / Windows PowerShell / cargo                                  | pnpm install + pnpm build              |
| **默认分支**           | `master`                                                                            | `main`                                 |

### 1.2 设计哲学对比

| 设计理念         | jcode                                                                                                      | Cabinet                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Agent 架构**   | 单 Agent 驾驭框架 + 可选 Swarm 多 Agent 模式。Agent 可自主修改和重载自身                                   | 多 Agent 内阁：Secretary → Dispatcher → Decision → Workflow             |
| **核心追求**     | **极致性能**——27.8MB 内存、14ms 首帧、每次额外会话 +10.4MB                                                 | **治理完整性**——4 层架构、Decision L0-L3、VSM 控制论                    |
| **代码哲学**     | **70+ 细粒度 crate**——类型/实现分离（xxx-types + xxx-core）。底层库重新实现（自研 Mermaid 渲染、自研终端） | **4 层架构**——依赖单向流动。复用成熟库（Vercel AI SDK、better-sqlite3） |
| **交互范式**     | TUI 终端 + `jcode run` 非交互模式 + `jcode serve/connect` 持久化服务                                       | 桌面应用 + Web UI。用户是 Captain，关注交付物                           |
| **自进化**       | ✅ **Self Dev Mode**——Agent 修改源码 → 构建 → 重载自己的二进制 → 跨会话继续                                | ✅ Harness 质量反馈 + AutoAdjuster 自调参                               |
| **跨工具互操作** | ✅ **跨 harness 会话恢复**——从 Claude Code/Codex/OpenCode/pi 恢复会话                                      | ✅ A2A 协议 + CLI Adapter                                               |

### 1.3 核心交集

- Agent 编排与生命周期管理
- 工具系统（文件、Shell、Web、MCP）
- 多 Agent 协作机制
- 记忆/上下文管理
- 流式响应
- 斜杠命令系统

**根本差异：** jcode 是"一人开发的极致性能 Rust 编码 Agent"——追求毫秒级响应、MB 级内存、可自修改。Cabinet 是"团队构建的项目管理 AI 平台"——追求治理完整性、控制论框架、多 Agent 内阁。

---

## 二、架构层对比

### 2.1 总体架构模式

```
jcode 架构（70+ crate + 分层 re-export）:
  src/main.rs (CLI binary wrapper)
    └── jcode-tui (TUI 前端)
          └── jcode-app-core (应用核心)
                └── jcode-base (基础层)

  横向 crate 按领域分离:
    crates/
      ├── jcode-core              → 核心逻辑
      ├── jcode-agent-runtime     → Agent 运行时
      ├── jcode-swarm-core        → Swarm 多 Agent
      ├── jcode-plan              → 计划/规划
      ├── jcode-protocol          → 协议 (ACP)
      ├── jcode-storage           → 存储
      ├── jcode-tool-core/types   → 工具系统
      ├── jcode-compaction-core   → 上下文压缩
      ├── jcode-embedding         → 本地 Embedding (ONNX)
      ├── jcode-memory-types      → 记忆类型定义
      ├── jcode-provider-* (8个)   → LLM Provider 插件
      ├── jcode-tui-* (14个)      → TUI 子系统
      ├── jcode-*-types (10个)    → 类型定义
      └── jcode-mobile-core       → iOS 移动端

  模式: xxx-types (纯类型) + xxx-core (实现) → 清晰 API 边界

Cabinet 架构（15 package + 4 层）:
  Layer 4: ui, server, desktop, cli
  Layer 3: decision, secretary, workflow, harness
  Layer 2: gateway, agent, memory, agent-sdk
  Layer 1: graph, types, events, storage
```

| 对比点            | jcode                                                                              | Cabinet                               | 评价                                                     |
| ----------------- | ---------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------- |
| **Crate/包数量**  | **70+ crates**——极细粒度                                                           | 15 packages——粗粒度                   | jcode 的分离更利于独立测试和编译缓存                     |
| **类型/实现分离** | ✅ **xxx-types + xxx-core 模式**——10+ 独立 types crate                             | ❌ 类型集中在 `@cabinet/types` 一个包 | **jcode 的模式更清晰**——类型变更不影响实现编译           |
| **分层模型**      | 隐式 re-export 链（base → app-core → tui → root）                                  | 显式 4 层架构 + lint:arch 自动校验    | **Cabinet 更好**——依赖方向有自动化保证                   |
| **Provider 架构** | ✅ **8 个独立 provider crate**——每个 LLM 后端独立编译、独立测试                    | ❌ 集中在单一 AISDKAdapter 文件       | **jcode 更好**——添加 Provider 不影响其他 Provider 的编译 |
| **TUI 架构**      | ✅ **14 个 TUI 子 crate**——markdown/mermaid/messages/permissions/render 等各自独立 | ❌ 无 TUI                             | jcode 的 TUI 模块化更精细                                |
| **移动端**        | ✅ jcode-mobile-core + jcode-mobile-sim + iOS 计划                                 | ❌ 无                                 | **jcode 独有**——移动端规划                               |
| **ACP 协议**      | ✅ `jcode-protocol` + `src/cli/acp.rs`——Agent Communication Protocol               | ✅ A2A 协议                           | 各有 Agents 间通信协议                                   |

### 2.2 jcode 的独特架构决策

#### 2.2.1 Handterm：自研终端

因为标准终端在自定义滚动区域中不支持平滑的部分行滚动，jcode 的作者**从头构建了一个终端模拟器**。

```
Handterm:
  - 原生滚动 API（标准终端不具备）
  - 平滑的部分行滚动
  - 作为 jcode TUI 的渲染后端
```

#### 2.2.2 自研 Mermaid 渲染器

```
jcode-tui-mermaid:
  - 纯 Rust 实现
  - 比浏览器/TypeScript 方案快 1800 倍
  - 无外部依赖（无 Chromium、无 Node.js）
  - 在 TUI 侧边栏中直接渲染
```

#### 2.2.3 Self Dev Mode

```
Self Dev Mode:
  1. Agent 修改 jcode 自己的源代码
  2. cargo build → 编译新二进制
  3. 热重载（hot_exec.rs）→ 替换运行中的进程
  4. 跨会话继续工作
```

### 2.3 建议

1. **P2：考虑类型/实现分离**——参考 jcode 的 xxx-types + xxx-core 模式，将 `@cabinet/types` 中的大型类型域拆分为独立包（如 `@cabinet/types-agent`、`@cabinet/types-decision`）
2. **P2：Provider 独立化**——将每个 LLM Provider 拆分为独立文件/模块，降低耦合
3. **保持 Cabinet 的 4 层架构 + lint:arch**——jcode 没有等效的自动化依赖校验

---

## 三、Agent 核心执行对比

### 3.1 执行循环

```
jcode Agent 执行:
  jcode-agent-runtime:
    - 交互模式: TUI 中实时对话
    - 非交互模式: jcode run "任务描述"
    - 持久化模式: jcode serve → jcode connect (client-server)
    - 后台模式: ambient mode (记忆整合、过期检查、冲突解决)

  工具循环:
    LLM 调用 → tool_call 返回
    → 工具分发 (jcode-tool-core)
    → 结果注入
    → 循环

  特殊模式:
    - Self Dev: Agent 修改源码 → 构建 → 热重载
    - Swarm: Agent 作为协调者 → spawn worker
    - Overnight: jcode-overnight-core (后台长期任务)

Cabinet Agent 执行:
  AgentLoop._execute() → AsyncGenerator
    while (stepCount < maxSteps) {
      LLM call → tools → Observer Pipeline
    }
```

| 对比点         | jcode                                                  | Cabinet                            | 评价                                            |
| -------------- | ------------------------------------------------------ | ---------------------------------- | ----------------------------------------------- |
| **执行模式**   | ✅ **4 种模式**——交互/非交互/持久化/后台               | ✅ 交互式 + Daemon pull-mode       | jcode 的 overnight/ambient 后台模式更系统       |
| **性能**       | ✅ **14ms 首帧、27.8MB 内存**——Rust 原生性能           | ❌ ~200-500ms 启动、~100MB+ 基线   | **jcode 碾压**——这是 Rust vs Node.js 的天然优势 |
| **热重载**     | ✅ **hot_exec.rs**——Agent 修改自己后热重载二进制       | ❌ 无                              | **jcode 独有**——Self Dev Mode 的核心能力        |
| **持久化服务** | ✅ `jcode serve` / `jcode connect`——标准 client-server | ✅ Hono Server + WebSocket         | 一致                                            |
| **上下文压缩** | ✅ `jcode-compaction-core`——独立 crate                 | ✅ ContextHandoff + ContextMonitor | jcode 的压缩作为独立 crate 更便于测试           |

### 3.2 建议

1. **P3：增加 overnight/ambient 后台模式**——Agent 在后台持续执行低优先级任务
2. **P2：将上下文压缩独立为包**——参考 jcode 的独立 compaction crate

---

## 四、多 Agent / Swarm 系统对比

### 4.1 架构对比

```
jcode Swarm 系统 (jcode-swarm-core):
  多 Agent 在同一仓库中协作:
    ├── 文件冲突检测: 如果 Agent A 编辑了 Agent B 打开的文件
    │   → 服务器通知 Agent B → Agent B 可检查 diff
    ├── Agent 间通信:
    │   ├── DM (直接消息)
    │   └── Broadcast (广播)
    ├── 自主 Worker Spawn:
    │   └── 主 Agent 通过 swarm 工具 spawn worker
    │       → 主 Agent 变为协调者角色
    └── 服务器管理: 所有 Agent 通过 jcode server 管理

  多会话并发:
    - 10 个并发会话仅增加 ~104MB（每会话 +10.4MB）
    - 对比 Claude Code: 10 会话增加 ~2127MB（每会话 +212.7MB）

Cabinet Squad 系统:
  SquadRouter: 队长 → 队员负载均衡 + 能力匹配
  Daemon: pull-mode 任务队列
  Dispatcher: Single/Pipeline/Parallel 模式
```

| 对比点           | jcode                                                       | Cabinet                                    | 评价                                        |
| ---------------- | ----------------------------------------------------------- | ------------------------------------------ | ------------------------------------------- |
| **文件冲突检测** | ✅ **自动检测 + 通知**——Agent 的文件被其他 Agent 修改时通知 | ❌ 无                                      | **jcode 独有**——多 Agent 协作的关键安全机制 |
| **Agent 间通信** | ✅ **DM + Broadcast**——Agent 间直接消息和广播               | ❌ 通过 EventBus 间接通信                  | **jcode 的 AM/Broadcast 更直接**            |
| **Worker Spawn** | ✅ 主 Agent 通过 swarm 工具自主 spawn worker                | ❌ 通过外部 Dispatcher 调度                | **jcode 的自主 spawn 更灵活**               |
| **并发效率**     | ✅ **每会话 +10.4MB**——极低的并发内存开销                   | ❌ 每 AgentLoop 是完整 Node.js 实例        | **jcode 碾压**——Rust 的内存效率             |
| **Squad 路由**   | ❌ 无——Swarm 是平级的                                       | ✅ SquadRouter——队长→队员负载均衡+能力匹配 | **Cabinet 更好**——有结构化的团队层级        |
| **Daemon 模式**  | ❌ 无 pull-mode 队列                                        | ✅ Daemon——任务队列 + WebSocket + 心跳     | **Cabinet 更好**——适合 CI/CD 类任务         |

### 4.2 建议

1. **P1：增加文件冲突检测**——多 Agent 编辑同一文件时自动检测和通知。这是 jcode Swarm 最实用的特性
2. **P2：增加 Agent 间直接消息（DM）**——不仅是 EventBus 的 pub/sub
3. **P2：Agent 自主 spawn worker**——通过 swarm 工具让 Agent 自主决定何时 spawn
4. **保持 Cabinet 的 Squad 层级路由和 Daemon pull-mode**——这些是 jcode 没有的优势

---

## 五、记忆系统对比

### 5.1 架构对比

```
jcode 记忆系统:
  语义向量图 (Semantic Vector Graph):
    每轮对话 → Embedding (jcode-embedding: 本地 ONNX + tokenizer)
      → 存储为图节点
      → 关系边连接相关记忆
      → Cosine Similarity 检索相关上下文

  记忆 Sideagent:
    - 在注入记忆前验证相关性
    - 防止无关记忆污染上下文

  提取时机:
    - 周期性 (ambient mode)
    - 会话结束时

  Ambient Mode (jcode-ambient-types + jcode-overnight-core):
    - 后台整合 (consolidation)
    - 过期检查 (staleness checks)
    - 冲突解决 (conflict resolution)

  显式记忆工具:
    - Agent 可通过工具主动搜索/存储记忆

  Embedding:
    - 默认关闭本地 embedding (jcode-embedding feature flag)
    - 关闭时使用远程 API embedding
    - 开启时使用本地 ONNX 模型（降低延迟 + 隐私）

Cabinet 记忆系统:
  MemoryFacade → 5 层流水线:
    ShortTermMemory → WriteGate → CascadeBuffer
    → LongTermMemory (SQLite + FTS5 + HNSW 向量索引)
    → KnowledgeGraph (实体关系图 + 矛盾检测)
  + EntityMemory + ProjectMemory
  + MemoryDecayService + ConsolidationService
```

| 对比点             | jcode                                                     | Cabinet                                                 | 评价                                                     |
| ------------------ | --------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------- |
| **存储模型**       | ✅ **语义向量图**——图结构存储记忆和关系边                 | ✅ SQLite + HNSW 向量索引 + FTS5                        | 各有千秋。图结构更适合关系型记忆；向量索引更适合语义搜索 |
| **本地 Embedding** | ✅ **jcode-embedding**——ONNX 本地推理，降低延迟和隐私风险 | ❌ 依赖远程 API (OpenAI text-embedding-3-small)         | **jcode 更好**——本地 embedding 更快、更隐私              |
| **Sideagent 验证** | ✅ **记忆 sideagent**——注入前验证相关性                   | ❌ 无验证层                                             | **jcode 独有**——防止无关记忆污染上下文                   |
| **Ambient Mode**   | ✅ 后台整合 + 过期检查 + 冲突解决                         | ✅ ConsolidationService + MemoryDecayService            | jcode 的 ambient mode 更"常驻后台"；Cabinet 的衰减更系统 |
| **写入门控**       | ❌ 依赖 sideagent 验证（注入时）                          | ✅ **WriteGate 5 级分类**——写入时过滤                   | **Cabinet 更好**——写入时过滤比注入时验证更前置           |
| **知识图谱**       | ✅ 语义向量图天然支持关系                                 | ✅ 实体关系图 + 矛盾检测 + LLM 语义矛盾检查             | **Cabinet 更好**——矛盾检测是独特能力                     |
| **记忆衰减**       | ❌ 过期检查（staleness check）——较简单                    | ✅ 完整的衰减生命周期（expire/archive/supersede/prune） | **Cabinet 更好**                                         |
| **项目隔离**       | ❌ 未明确                                                 | ✅ ProjectIsolation——key 前缀 + metadata 过滤           | **Cabinet 更好**                                         |

### 5.2 建议

1. **P2：增加记忆注入前验证层**——参考 jcode 的 sideagent 模式，在将记忆注入 prompt 前做相关性检查
2. **P2：考虑本地 embedding 支持**——参考 jcode 的 ONNX 本地推理，降低延迟和 API 成本
3. **保持 Cabinet 的 WriteGate、知识图谱矛盾检测、记忆衰减**——这些是优势

---

## 六、工具与 Provider 对比

### 6.1 Provider 架构

```
jcode Provider 系统:
  jcode-provider-core          → Provider 抽象接口
  jcode-provider-metadata      → Provider 元数据
  jcode-provider-env           → 环境变量检测

  独立 Provider crate:
    jcode-provider-anthropic   → Claude (直接 API)
    jcode-provider-openai      → OpenAI (直接 API)
    jcode-provider-gemini      → Google Gemini
    jcode-provider-copilot     → GitHub Copilot
    jcode-provider-bedrock     → AWS Bedrock
    jcode-provider-openrouter  → OpenRouter (15+ OpenAI兼容模型)
    jcode-provider-antigravity → Antigravity
    jcode-provider-azure-auth  → Azure 认证

  本地运行时:
    Ollama, LM Studio

  自定义端点:
    provider add 命令 → 写入 ~/.jcode/config.toml
    支持注入额外请求体字段 (如 NVIDIA NIM reasoning settings)

  认证:
    订阅制 OAuth + 直接 API Key
    --no-browser 模式 (SSH/headless) —— 打印 URL 或 QR 码
    两步可脚本化认证模式
    多账号切换

Cabinet Provider 系统:
  AISDKAdapter (单一文件):
    8 个 Provider 硬编码
    createOpenAICompatible 通用适配
  无独立 Provider 模块
```

| 对比点            | jcode                                                       | Cabinet                                                   | 评价                                       |
| ----------------- | ----------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------ |
| **Provider 架构** | ✅ **8 个独立 crate**——每个 Provider 独立编译和测试         | ❌ 集中在单一 `ai-sdk-adapter.ts` 文件                    | **jcode 更好**——添加 Provider 不碰其他代码 |
| **Provider 注册** | ✅ `provider add` CLI 命令——用户可动态添加自定义端点        | ❌ 需修改源码                                             | **jcode 更好**——用户可自助添加 Provider    |
| **认证灵活性**    | ✅ OAuth + API Key + --no-browser + QR 码 + 脚本化 + 多账号 | ❌ 环境变量 API Key                                       | **jcode 更好**——认证方式更灵活             |
| **本地运行时**    | ✅ Ollama + LM Studio 支持                                  | ❌ 无                                                     | **jcode 更好**——支持完全离线运行           |
| **成本控制**      | ❌ 未明确                                                   | ✅ **CostTracker (RMB) + BudgetGuard + RateLimitTracker** | **Cabinet 更好**——成本控制全面             |
| **Fallback**      | ❌ 未明确                                                   | ✅ **FallbackChain**——指数退避 + 模型降级                 | **Cabinet 更好**                           |

### 6.2 工具系统

```
jcode 工具系统:
  jcode-tool-core + jcode-tool-types:
    30+ 内置工具
    浏览器自动化: Firefox Agent Bridge (16+ actions)
    MCP 支持
    Skill 动态加载 (embedding 匹配)

Cabinet 工具系统:
  ToolExecutor + 13 个分类文件:
    80+ 注册工具
    可选 Playwright (通过 MCP)
    MCP 支持
    Skill 三级渐进加载
```

| 对比点           | jcode                                                                        | Cabinet                      | 评价                                                |
| ---------------- | ---------------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------- |
| **浏览器自动化** | ✅ **内置 Firefox Agent Bridge**——16+ action (click/type/screenshot/eval 等) | ❌ 可选——通过 MCP Playwright | **jcode 更好**——内置浏览器工具，零配置              |
| **工具数量**     | 30+                                                                          | 80+                          | **Cabinet 更丰富**                                  |
| **Skill 加载**   | ✅ **Embedding 匹配**——动态按语义匹配 Skill，非全量加载                      | ✅ L1→L2→L3 三级渐进加载     | jcode 的 embedding 匹配更智能；Cabinet 的三级更精细 |

### 6.3 建议

1. **P2：Provider 独立化**——参考 jcode 的独立 Provider crate 模式。每个 LLM Provider 独立文件
2. **P2：支持本地运行时**——Ollama/LM Studio，允许完全离线
3. **P2：Skill 动态匹配**——参考 jcode 的 embedding 匹配模式
4. **P3：内置浏览器工具**——参考 jcode 的 Firefox Agent Bridge
5. **保持 Cabinet 的成本控制优势**——CostTracker + BudgetGuard + RateLimitTracker + FallbackChain

---

## 七、用户界面与交互对比

### 7.1 界面覆盖

| 界面类型         | jcode                                                                                        | Cabinet                    |
| ---------------- | -------------------------------------------------------------------------------------------- | -------------------------- |
| **TUI**          | ✅ **ratatui**——14 个 TUI 子 crate（markdown/mermaid/messages/permissions/render/animation） | ❌ 无                      |
| **桌面应用**     | ✅ jcode-desktop crate                                                                       | ✅ **Tauri** + React       |
| **移动端**       | ✅ **iOS 计划中**（Tailscale 远程访问）                                                      | ❌ 无                      |
| **非交互模式**   | ✅ `jcode run "任务"`                                                                        | ❌ 无                      |
| **持久化服务**   | ✅ `jcode serve` / `jcode connect`                                                           | ✅ Hono Server + WebSocket |
| **自研终端**     | ✅ **Handterm**——原生滚动 API 的自定义终端                                                   | ❌ 无                      |
| **Mermaid 渲染** | ✅ **自研 Rust 渲染器**——1800x faster, 无浏览器依赖                                          | ❌ 无                      |
| **侧边栏**       | ✅ 侧边栏渲染 Mermaid 图、diff、实时文件内容                                                 | ❌ 无持久侧边栏            |
| **Info Widgets** | ✅ 仅占用"负空间"，空间不足时自动隐藏                                                        | ❌ 无                      |

### 7.2 jcode 的 UI 创新

**Handterm 终端：**

```
标准终端问题: 在自定义滚动区域中无法平滑滚动部分行
jcode 解决方案: 从头构建原生滚动 API 的终端模拟器
```

**Mermaid 渲染器：**

```
浏览器方案: ~数秒渲染时间 + Chromium 依赖
jcode 方案: 纯 Rust, 1800x faster, 0 外部依赖, TUI 内直接渲染
```

**Info Widgets：**

```
传统方案: 固定的信息栏占用屏幕空间
jcode 方案: 仅在"负空间"（未被聊天内容占用的区域）显示，空间不足时消失
```

### 7.3 建议

1. **P3：考虑 jcode 的 Mermaid 渲染方案**——如果需要在 TUI/桌面中渲染图表
2. **P3：Info Widgets 概念**——在 UI 中仅使用负空间显示辅助信息
3. **保持 Cabinet 的桌面应用优势**——Tauri + React 是成熟的桌面方案

---

## 八、独特能力对比

### 8.1 jcode 独有，Cabinet 完全缺失

| 能力                    | 说明                                                            | 重要性     |
| ----------------------- | --------------------------------------------------------------- | ---------- |
| **Self Dev Mode**       | Agent 修改 jcode 源码 → cargo build → 热重载二进制 → 跨会话继续 | ⭐⭐⭐⭐⭐ |
| **Handterm**            | 自研终端模拟器，原生滚动 API                                    | ⭐⭐⭐     |
| **Mermaid 渲染器**      | 纯 Rust，1800x faster，0 外部依赖                               | ⭐⭐⭐     |
| **跨 Harness 会话恢复** | 从 Claude Code / Codex / OpenCode / pi 恢复会话                 | ⭐⭐⭐⭐   |
| **文件冲突检测**        | Swarm 中实时检测文件被其他 Agent 修改                           | ⭐⭐⭐⭐   |
| **Agent 间 DM**         | 直接 Agent-to-Agent 消息                                        | ⭐⭐⭐     |
| **本地 ONNX Embedding** | 本地推理，低延迟 + 隐私                                         | ⭐⭐⭐     |
| **记忆 Sideagent**      | 注入前验证记忆相关性                                            | ⭐⭐⭐⭐   |
| **iOS 移动端**          | Tailscale 远程访问的 iOS 应用                                   | ⭐⭐       |

### 8.2 Cabinet 独有，jcode 完全缺失

| 能力                | 说明                                                               | 重要性     |
| ------------------- | ------------------------------------------------------------------ | ---------- |
| **Decision 状态机** | L0-L3 分级决策 + DelegationTier + AuditLog + PolicyEngine          | ⭐⭐⭐⭐⭐ |
| **Workflow 引擎**   | 18 种节点类型 + DAG + 人工节点 + 外部 Agent 节点                   | ⭐⭐⭐⭐⭐ |
| **知识图谱**        | 实体关系图 + 矛盾检测 + LLM 语义矛盾检查                           | ⭐⭐⭐⭐   |
| **WriteGate**       | 5 级记忆分类过滤                                                   | ⭐⭐⭐⭐   |
| **MemoryDecay**     | 完整的记忆衰减生命周期                                             | ⭐⭐⭐⭐   |
| **成本控制**        | CostTracker (RMB) + BudgetGuard + RateLimitTracker + FallbackChain | ⭐⭐⭐⭐   |
| **控制论框架**      | VSM 5 层映射 + 8 条原则 + PIS 评分 + 83/100 自评                   | ⭐⭐⭐⭐   |
| **A2A 协议**        | Agent-to-Agent 互操作 + 外部 Agent CLI Adapter                     | ⭐⭐⭐     |
| **人工节点**        | 可配置的人类协作者抽象                                             | ⭐⭐⭐⭐   |

---

## 九、性能哲学对比

这是 jcode 与 Cabinet **最根本的差异维度**。

### 9.1 jcode 的性能数据

| 指标             | jcode                    | Claude Code                 | 倍率                     |
| ---------------- | ------------------------ | --------------------------- | ------------------------ |
| **单会话 RAM**   | 27.8 MB                  | 386.6 MB                    | **13.9× less**           |
| **10 会话 RAM**  | +104 MB (每会话 +10.4MB) | +2,127 MB (每会话 +212.7MB) | **20.4× more efficient** |
| **首帧时间**     | 14.0 ms                  | ~3.4 s                      | **245.5× faster**        |
| **Mermaid 渲染** | 1800× faster             | (浏览器)                    | 1800×                    |

### 9.2 性能优化策略

**jcode 的策略：**

```
1. Rust 零成本抽象——无 GC、无 JIT 预热
2. 自研替代方案——不依赖浏览器渲染 Mermaid、不依赖标准终端
3. 编译期 profile 调优——特定 crate 的 opt-level=3 覆盖
4. 可选 jemalloc——替换默认分配器
5. Feature flag 控制——本地 embedding 默认关闭，按需开启
6. 细粒度 crate——未使用的 Provider 不编译、不链接、不占内存
```

**Cabinet 的策略：**

```
1. TypeScript + Node.js——快速迭代优先于极致性能
2. 复用成熟库——Vercel AI SDK、better-sqlite3、Hono
3. pnpm workspace——增量构建
4. tsc -b composite projects——类型检查缓存
5. 无显式性能优化——关注治理完整性而非资源效率
```

### 9.3 性能差距分析

| 维度           | jcode                | Cabinet                  | 根本原因                           |
| -------------- | -------------------- | ------------------------ | ---------------------------------- |
| **启动时间**   | 14ms (原生二进制)    | ~200-500ms (Node.js JIT) | Rust vs V8 启动                    |
| **内存基线**   | 27.8MB               | ~100-200MB               | 无 GC vs V8 GC                     |
| **每会话增量** | +10.4MB              | +50-100MB                | Rust 的紧凑数据结构 vs JS 对象开销 |
| **并发效率**   | 极高（Tokio async）  | 中等（Node.js 事件循环） | Tokio 多线程 vs 单线程事件循环     |
| **二进制大小** | ~50-100MB (静态链接) | ~5MB (JS bundle)         | Rust 静态链接所有依赖              |

### 9.4 建议

1. **性能不是 Cabinet 的核心追求**——TypeScript/Node.js 的技术栈选择是刻意的（快速迭代 > 极致性能）
2. **P3：考虑性能关键路径的 Rust/WASM 优化**——如 embedding 计算、文本处理
3. **P2：借鉴 jcode 的 feature flag 控制**——可选模块不编译、不加载

---

## 十、工程纪律对比

| 对比点               | jcode                                             | Cabinet                 | 评价                           |
| -------------------- | ------------------------------------------------- | ----------------------- | ------------------------------ |
| **语言**             | Rust                                              | TypeScript              | Rust 正确性保证更强            |
| **Crate/Package 数** | 70+ crates                                        | 15 packages             | jcode 更细粒度                 |
| **类型/实现分离**    | ✅ xxx-types + xxx-core                           | ❌ 单一 types 包        | **jcode 更好**                 |
| **测试**             | ✅ Rust test + `test-support` feature             | ✅ Vitest               | 一致                           |
| **CI/CD**            | ✅ GitHub Actions + codemagic (iOS)               | ✅ GitHub Actions       | jcode 多了 iOS CI              |
| **Lint**             | ✅ clippy (Rust 编译器级)                         | ✅ eslint + tsc         | 一致                           |
| **架构校验**         | ❌ 无——依赖 crate 边界                            | ✅ `lint:arch` 自动验证 | **Cabinet 更好**               |
| **行数限制**         | ❌ 无明确限制                                     | ✅ 500 行/文件上限      | **Cabinet 更好**               |
| **控制论自评**       | ❌ 无                                             | ✅ VSM 8 条原则，83/100 | **Cabinet 独有**               |
| **Commit 格式**      | 未明确                                            | 中文/英文均可           | —                              |
| **Profile 优化**     | ✅ 精细的 Cargo profile（特定 crate opt-level=3） | ❌ 无                   | **jcode 更好**——编译期性能调优 |

---

## 十一、关键设计差异总结表

| 设计维度           | jcode 优势                                      | Cabinet 优势                                     | 建议优先级                     |
| ------------------ | ----------------------------------------------- | ------------------------------------------------ | ------------------------------ |
| **性能**           | **14ms 首帧、27.8MB、245× faster**              | Node.js 基线                                     | P3: 性能关键路径优化           |
| **Provider**       | 8 个独立 crate + 动态注册 + 本地 Ollama         | CostTracker + BudgetGuard + FallbackChain        | P2: Provider 独立化            |
| **Swarm/多 Agent** | **文件冲突检测 + AM 间 DM + 自主 Worker Spawn** | Squad 层级路由 + Daemon pull-mode                | P1: 文件冲突检测 P2: DM        |
| **记忆**           | 语义向量图 + 本地 ONNX + Sideagent 验证         | **WriteGate + 知识图谱 + 衰减 + 项目隔离**       | P2: Sideagent + 本地 embedding |
| **自我进化**       | **Self Dev Mode**——修改源码→构建→热重载         | Harness 质量反馈 + AutoAdjuster                  | P3: Self Dev 概念              |
| **UI**             | TUI 14 crate + Handterm + Mermaid 1800x         | Tauri Desktop + Web UI                           | 各有场景                       |
| **决策/治理**      | ❌ 无                                           | **Decision L0-L3 + Workflow + 控制论**           | Cabinet 独有                   |
| **跨工具**         | 跨 Harness 会话恢复                             | A2A + External Agent Adapter                     | 各有千秋                       |
| **类型安全**       | Rust 编译时                                     | TypeScript strict                                | Rust 更强                      |
| **工程纪律**       | Profile 优化 + 类型/实现分离                    | lint:arch + 行数限制 + 控制论                    | 各有优势                       |
| **移动端**         | iOS 计划中                                      | ❌ 无                                            | jcode 独有                     |
| **成本控制**       | ❌ 无                                           | **CostTracker + BudgetGuard + RateLimitTracker** | Cabinet 独有                   |

---

## 十二、优先级改进建议

### P1 — 架构增强（1-2 周）

| #   | 改进项             | 参考 jcode 模块                           | 工作量       | 说明                                               |
| --- | ------------------ | ----------------------------------------- | ------------ | -------------------------------------------------- |
| 1   | **文件冲突检测**   | `jcode-swarm-core`——多 Agent 文件冲突通知 | 中（3-5 天） | 在 Workflow 或 Squad 中增加文件编辑冲突检测        |
| 2   | **记忆注入前验证** | Sideagent——验证相关性再注入               | 小（1-2 天） | 在 MemoryFacade.getSessionContext 中增加相关性阈值 |

### P2 — 体验优化（按需）

| #   | 改进项                      | 参考 jcode 模块           | 工作量       |
| --- | --------------------------- | ------------------------- | ------------ |
| 3   | **Provider 独立化**         | 8 个独立 provider crate   | 中（3-5 天） |
| 4   | **Agent 间直接消息 (DM)**   | Swarm DM/Broadcast        | 小（1-2 天） |
| 5   | **Agent 自主 Worker Spawn** | swarm 工具 + 协调者模式   | 中（3-5 天） |
| 6   | **本地 Embedding 支持**     | `jcode-embedding` (ONNX)  | 中（3-5 天） |
| 7   | **Skill Embedding 匹配**    | 动态 embedding 匹配加载   | 小（1-2 天） |
| 8   | **支持本地运行时**          | Ollama + LM Studio        | 小（1-2 天） |
| 9   | **类型/实现分离**           | xxx-types + xxx-core 模式 | 大（1-2 周） |
| 10  | **上下文压缩独立包**        | `jcode-compaction-core`   | 中（3-5 天） |

### P3 — 战略方向（长期）

| #   | 改进项                         | 参考 jcode 模块                                | 说明                                     |
| --- | ------------------------------ | ---------------------------------------------- | ---------------------------------------- |
| 11  | **Overnight/Ambient 后台模式** | `jcode-overnight-core` + `jcode-ambient-types` | 后台常驻 Agent                           |
| 12  | **性能关键路径优化**           | jcode 的 profile 调优策略                      | Rust/WASM 优化 embedding、文本处理       |
| 13  | **Self Dev 概念**              | hot_exec.rs                                    | Agent 修改 Cabinet 自身配置/规则并热重载 |
| 14  | **跨 Harness 会话导入**        | 跨工具会话恢复                                 | 从 Claude Code/Codex 等导入会话历史      |
| 15  | **内置浏览器工具**             | Firefox Agent Bridge                           | 零配置的浏览器自动化                     |

---

## 十三、结论

### 13.1 总体评价

**jcode** 是一个由个人开发者构建的**极致性能 Rust 编码 Agent 驾驭框架**。它的优势在于：

- **性能碾压**——14ms 首帧、27.8MB 内存、245× faster than Claude Code。Rust 的原生性能无可匹敌
- **Swarm 多 Agent 创新**——文件冲突检测、Agent 间 DM/Broadcast、自主 Worker Spawn
- **Self Dev Mode**——Agent 可修改并重载自身。这是 Agent 自主性的终极体现
- **基础设施自研**——Handterm 终端、Mermaid 1800x 渲染器、本地 ONNX Embedding
- **跨 Harness 互操作**——从 Claude Code/Codex/OpenCode 恢复会话
- **移动端规划**——iOS 应用

它的不足（从 Cabinet 视角）在于：

- 无 Decision 状态机——编码 Agent 不需要项目级决策治理
- 无 Workflow 引擎——没有结构化的多步骤编排
- 无知识图谱——记忆是图结构（语义向量图）但无矛盾检测
- 无 WriteGate——记忆质量管理依赖 sideagent 验证而非写入时过滤
- 无成本控制——没有预算和速率限制管理
- 无控制论框架——没有系统级的自我认知和评估

### 13.2 Cabinet 的最大收获

jcode 给 Cabinet 的三个最大启示：

1. **多 Agent 协作需要冲突检测**——当多个 Agent 在同一文件系统上工作时，文件冲突检测是最基本的安全机制。Cabinet 的 Squad 和 Workflow 系统目前缺少这个
2. **记忆注入需要验证层**——不是所有检索到的记忆都应该注入 prompt。Sideagent 做相关性验证可以显著减少上下文噪音
3. **性能是一种功能**——14ms 首帧和 27.8MB 内存意味着 Agent 可以在资源受限的环境中运行（Raspberry Pi、低配 VPS）。虽然 Cabinet 选择了 TypeScript 的快速迭代优势，但性能关键路径值得投入优化

### 13.3 两项目的互补关系

| 维度              | jcode 更强                      | Cabinet 更强                         |
| ----------------- | ------------------------------- | ------------------------------------ |
| **性能**          | ✅ Rust 原生，14ms/27.8MB       | ❌                                   |
| **编码场景**      | ✅ TUI + Self Dev + 30+ tools   | ❌                                   |
| **项目管理**      | ❌                              | ✅ Decision + Workflow + Deliverable |
| **记忆治理**      | ❌                              | ✅ WriteGate + 衰减 + 矛盾检测       |
| **多 Agent 协作** | ✅ 冲突检测 + DM + Worker Spawn | ✅ Squad 路由 + Daemon + Decision    |
| **成本控制**      | ❌                              | ✅ CostTracker + BudgetGuard         |
| **自主性**        | ✅ Self Dev Mode                | ✅ Harness + AutoAdjuster            |
| **移动端**        | ✅ iOS 计划                     | ❌                                   |
| **治理框架**      | ❌                              | ✅ VSM 控制论 + PIS                  |

jcode 和 Cabinet 是 AI Agent 光谱上的两个极端：

- **jcode** 代表了"**极致个人工具**"——一个人开发的、性能最优的、可自修改的编码 Agent
- **Cabinet** 代表了"**组织级平台**"——带有完整决策治理、工作流编排和记忆管理的内阁系统

---

> 报告结束。如需针对某个具体模块编写详细实现方案，请指定模块名称。
