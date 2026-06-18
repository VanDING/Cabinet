# Cabinet v3 — CodeGraph 智能功能设计

> 版本：v0.1.0
> 定位：基于已有 CodeGraph 数据 + 生态知识的智能开发工具
> 依赖：`cabinet-codegraph` + `cabinet-tui` + `web_fetch` + `web_search`
> 核心原则：所有功能基于 CodeGraph 已有数据——不做新数据采集，只换更聪明的输出格式
> 日期：2026-06-13

---

## 设计理念

CodeGraph 已在 SQLite 中存储了完整的符号图（`symbols` + `edges` + `files` 三表）。以下全部功能基于这些已有数据，外加编译时嵌入的生态知识库和 web_search 兜底。

**这些功能是只有内置 CodeGraph 的 Coding Agent 才能做到的。** 8 个对标产品（Claude Code / ADK-Rust / Claw Code / Hermes / DeerFlow / Codex CLI / OpenCode / jcode）无一具备——因为它们没有代码智能层，Agent 每次都要 grep/read/ls 拼凑代码结构。

---

## 一、架构依赖可视化 (`codegraph_visualize`)

### 1.1 定位

基于 `symbols` + `edges` + `files` 三表，生成项目依赖图。三种输出形态覆盖不同场景。

### 1.2 新增工具 #23

```
codegraph_visualize:
  category: ReadOnly
  is_concurrency_safe: true
  description: "可视化代码库的依赖关系图。支持模块级聚焦、深度控制、格式选择。"

参数:
  focus: string (可选)          — 聚焦的模块/crate名称
  depth: u8 (默认 3)             — 依赖追踪深度
  direction: "dependencies" | "dependents" (默认 "dependencies")
  format: "mermaid" | "json" (默认 "mermaid")
  check_violations: bool (默认 true)
```

### 1.3 三种输出形态

**TUI ASCII 依赖树：**

```
/codegraph tree → Sidebar: CodeGraph Tab [Deps]

  cabinet-agent ──────────────────────────── 89▲
  ├── cabinet-gateway ────────────────────── 17
  │   ├── cabinet-base ────────────────────── 8
  │   │   ├── error.rs
  │   │   ├── config.rs
  │   │   └── paths.rs
  │   └── cabinet-gateway-types ───────────── 9
  ├── cabinet-tool ───────────────────────── 34
  │   ├── cabinet-codegraph ──────────────── 12
  │   │   ├── cabinet-base ────────────────── 8
  │   │   └── cabinet-storage ─────────────── 4
  │   ├── cabinet-sandbox ─────────────────── 8
  │   ├── cabinet-exec ────────────────────── 8
  │   └── cabinet-gateway ─────────────────── 6
  └── ...

  ╔═══════════════════════════════════════════╗
  ║ ⚠ 架构违规 (1)                            ║
  ║ cabinet-session ──→ cabinet-agent         ║
  ║   Engine 层不应依赖 Intelligence 层        ║
  ║   session.rs:234 → agent_loop.rs:56       ║
  ╚═══════════════════════════════════════════╝

  ↑↓ 移动  Enter 展开/折叠  / 搜索  v 违规视图  e 导出HTML
```

**Agent Mermaid（Agent 在 Plan 中使用）：**

Agent 调用 `codegraph_visualize(format="mermaid")` → 得到 Mermaid 文本 → LLM 解析依赖结构 → 指导 Plan 决策。

**浏览器 D3.js（深度分析）：**

`/codegraph visualize --export html` → 自包含 HTML (D3.js force-directed graph) → 浏览器打开。拖拽/缩放/搜索/Hover 详情/违规高亮。

### 1.4 架构违规检测

```
依赖方向规则:
  Foundation → Engine → Intelligence → Application → Interface

检测类型:
  1. 依赖方向违规: 右侧依赖左侧 → 报告 + 建议修复方式
  2. 循环依赖检测: A → B → ... → A → 报告环路
  3. 依赖权重分析: call_count > 20 的单一依赖 → 建议评估拆分

用户项目规则:
  .cabinet/architecture.toml (可选)
  用户可为自己的项目定义层级规则——对所有语言生效
```

### 1.5 多语言支持

| 语言       | 模块边界检测                              | 用户规则 |
| ---------- | ----------------------------------------- | -------- |
| Rust       | `Cargo.toml` workspace members → crate 级 | ✅       |
| Python     | `__init__.py` → package 级                | ✅       |
| TypeScript | `package.json` → package 级 (monorepo)    | ✅       |
| Go         | `go.mod` module path → package 级         | ✅       |
| JavaScript | `package.json` → package 级               | ✅       |

依赖图生成是语言无关的——`symbols` 和 `edges` 表不关心语言。

---

## 二、生态文档查询 (`docs`)

### 2.1 定位

Agent 的训练数据可能过时。`docs` 工具实时抓取最新官方文档，确保生成的代码使用最新 API。

### 2.2 新增工具 #24

```
docs:
  category: ReadOnly
  is_concurrency_safe: true
  description: "查询第三方库的最新官方文档。返回 API 用法和示例。"

参数:
  library: string               — 库名称 ("axum", "prisma", "pandas")
  query: string                 — 搜索内容 ("extract path parameters")
```

### 2.3 三层查询递进

```
docs("axum", "extract path parameters"):

  ① 用户学习注册表 (~/.cabinet/docs_registry_learned.toml)
     → 命中 → 直接使用 ✅

  ② 社区 Skill 注册表 (skills/docs-registry/registry.toml, ~200 库)
     → 命中 → 使用 + 追加到 ① ✅

  ③ 自动推断 (语言 URL 模板)
     Rust crate → https://docs.rs/{name}/latest/{name}/?search={query}
     TS package → https://www.npmjs.com/package/{name} → extract homepage
     Python pkg → https://pypi.org/project/{name}/ → extract docs URL
     Go module  → https://pkg.go.dev/{name}?q={query}
     → 命中 → 使用 + 追加到 ① ✅

  ④ web_search("{library} documentation {query}") 兜底
```

### 2.4 内置注册表 (编译时嵌入 ~50 个高频库)

```
Rust:     tokio, axum, actix, serde, sqlx, clap, reqwest, tower, tracing
TypeScript: react, next.js, prisma, express, zod, tailwind, vitest
Python:   fastapi, django, pydantic, sqlalchemy, pytest, httpx, typer
Go:       gin, echo, gorm, chi, cobra
```

### 2.5 持续更新

- 用户注册表自动学习（每次未命中后追加）
- 社区 Skill `docs-registry` 通过 Git 分发和更新
- 内置注册表随 Cabinet 发布更新

---

## 三、堆栈追踪展开 (`stacktrace`)

### 3.1 定位

将运行时错误堆栈与 CodeGraph 调用链关联，自动展开每层代码上下文 + 变量推断。

### 3.2 新增工具 #25

```
stacktrace:
  category: ReadOnly
  is_concurrency_safe: true
  description: "将堆栈追踪展开为代码级调用链分析。显示每层的源码和可能的修复方向。"

参数:
  entry_point: string            — 堆栈入口 (文件:行号)
  stack_text: string (可选)      — 原始堆栈文本。如果未提供，从最近的 bash 调用中获取
```

### 3.3 工作流程

```
Agent 运行 bash("cargo test") → 返回 panic! 堆栈
  → Agent: stacktrace("src/auth/tests.rs:18")

  → CodeGraph trace(test_login → authenticate → TokenManager::validate)
  → 每层展开源码片段 + 错误上下文:

ToolResult:
  "## Stack Trace Analysis

   [test] auth::tests::test_login:18
     let result = authenticate("user", "wrong_password");

   [fn]  auth::service::authenticate:42
     let valid = TokenManager::validate(token)?;
     → 返回 Err(AuthError)

   [impl] TokenManager::validate:128
     let stored = self.db.find_token(token)?;
     → self.db.find_token() 返回了 Err——数据库中找不到此 token

   ### 建议修复方向
   1. 检查测试 setUp 是否已插入测试 token
   2. 检查 TokenManager::validate 的 find_token 逻辑
   3. 考虑使用 mock database 做单元测试"
```

### 3.4 对标

| 纯 bash 做法                             | 原生 CodeGraph 做法                      |
| ---------------------------------------- | ---------------------------------------- |
| 手动 read_file 3 个文件 + 手动追踪调用链 | `trace()` 自动追踪 + 每层源码 + 修复方向 |

---

## 四、智能测试 (`test`)

### 4.1 定位

基于 CodeGraph 影响分析，只跑受修改影响的测试；结构化解析测试结果，关联失败到源码。

### 4.2 新增工具 #26

```
test:
  category: Exec
  is_concurrency_safe: false
  description: "运行受当前修改影响的测试。自动检测测试框架，仅跑相关测试。"

参数:
  scope: "auto" | "all" | "file" | "function" (默认 "auto")
  files: string[] (可选)          — scope="file" 时指定文件
  function: string (可选)         — scope="function" 时指定测试函数名
```

### 4.3 工作流程

```
Agent: test(scope="auto")     ← 修改了 src/auth/token.rs

  → CodeGraph impact("TokenManager") → 受影响的测试:
     auth::tests::test_login
     auth::tests::test_token_expiry
     api::tests::test_auth_endpoint
  → 只跑这 3 个测试

ToolResult:
  ## Test Results
  ✅ auth::tests::test_login                  (0.12s)
  ✅ auth::tests::test_token_expiry           (0.08s)
  ❌ api::tests::test_auth_endpoint            (0.45s)

  ### Failing: api::tests::test_auth_endpoint:34
  expected: 200 OK, got: 401 Unauthorized

  ### Related Code (via CodeGraph)
  src/api/handler.rs:56 → 调用了 TokenManager::validate
  src/auth/token.rs:128 → validate 逻辑最近被修改
```

### 4.4 框架自动检测

```
Rust:     cargo test → 检测 #[test] 属性
Python:   pytest → 检测 test_*.py 文件
TypeScript: vitest / jest → 检测 vitest.config.ts / jest.config.js
Go:       go test → 检测 *_test.go 文件
```

---

## 五、模式推荐 (`suggest`)

### 5.1 定位

基于 CodeGraph 代码模式检测 + 生态知识库，推荐成熟的开源替代方案。减少"不知道有这个库所以手写了一个"的情况。

### 5.2 新增工具 #27

```
suggest:
  category: ReadOnly
  is_concurrency_safe: true
  description: "分析项目代码，推荐成熟的开源替代方案或生态最佳实践。"

参数:
  query: string                  — 需求描述 ("HTTP client", "JSON parsing", "ORM")
  scope: "project" | "ecosystem" | "all" (默认 "all")
  language: string (可选)        — 语言过滤
```

### 5.3 两层分析

**第一层：代码模式检测（本地、零延迟、零 API 调用）**

```
suggest("HTTP client"):

  → CodeGraph 扫描:
    ✗ 项目无 HTTP 客户端依赖
    ✓ 检测到手动 HTTP 实现:
       src/downloader.rs → 200 行裸 TCP + HTTP 解析
       src/api_client.rs → 150 行手动 HTTP 请求

  → 推荐: reqwest
    原因: 350 行手动实现 → 15 行 reqwest
    Cargo.toml: reqwest = { version = "0.12", features = ["rustls-tls"] }
```

**第二层：生态对比搜索（web_search + web_fetch）**

```
suggest("rust database ORM", scope="ecosystem"):

  → web_search("rust ORM comparison 2026")

  ## Rust ORM 生态对比

  | 库 | ★ | 适用场景 | 项目匹配度 |
  |---|---|---|---|
  | sqlx | 15K | 编译时 SQL，async | ✅ 项目已用 tokio |
  | Diesel | 14K | 类型安全 DSL，sync | ❌ 项目异步 |
  | SeaORM | 8K | ActiveRecord，async | ⚠️ 学习曲线 |

  推荐: sqlx
  Cargo.toml: sqlx = { version = "0.8", features = ["runtime-tokio-rustls", "postgres"] }
```

### 5.4 内置模式注册表 (编译时嵌入 ~30 个模式)

```toml
[[patterns]]
name = "manual_http"
detection = "tcp_connect + http_headers_manual + no_http_client_dep"
suggestion = "reqwest (Rust) / axios (JS) / httpx (Python)"

[[patterns]]
name = "manual_json_parsing"
detection = "regex_functions + string_splitting + no_serde_json_dep"
suggestion = "serde_json (Rust) / JSON.parse (JS, builtin) / json (Python, builtin)"

[[patterns]]
name = "unsafe_password_hashing"
detection = "sha256 + password_context + no_argon2_bcrypt_dep"
suggestion = "argon2 (Rust) / bcrypt (JS/Python)"

[[patterns]]
name = "manual_sql_concatenation"
detection = "format!(...) + sql_keywords + no_sqlx_diesel_dep"
suggestion = "sqlx (Rust, async) / Diesel (Rust, sync)"
reason = "SQL 字符串拼接 → SQL 注入风险 → 参数化查询"

[[patterns]]
name = "no_logging"
detection = "println! + eprintln! + no_tracing_log_dep"
suggestion = "tracing (Rust) / pino (JS) / structlog (Python)"

[[patterns]]
name = "manual_cli_parsing"
detection = "std::env::args + manual_parsing + no_clap_dep"
suggestion = "clap (Rust) / commander (JS) / typer (Python)"
```

### 5.5 三层知识递进

```
suggest(query):
  ① 代码模式注册表（编译时嵌入 ~30 个模式）→ 本地、零延迟
  ② 生态知识库（编译时嵌入 ~200 个库分类）→ 本地、零延迟
  ③ web_search + web_fetch（实时搜索最佳实践）→ 兜底
```

---

## 六、用法搜索 (`examples`)

### 6.1 定位

搜索项目内和生态内的具体 API 用法。项目内通过 CodeGraph 直接完成（零 API 调用），生态内通过 web_search 兜底。

### 6.2 新增工具 #28

```
examples:
  category: ReadOnly
  is_concurrency_safe: true
  description: "搜索项目中或生态内的 API 使用模式。"

参数:
  symbol: string                 — API/模式名称 ("tokio::spawn", "useState")
  scope: "project" | "ecosystem" | "all" (默认 "project")
```

### 6.3 项目内搜索（零 API 调用）

```
examples("tokio::spawn", scope="project"):

  → CodeGraph search("tokio::spawn") → 12 call sites → 按模式分组:

  ## Usage: tokio::spawn (12 call sites, 3 patterns)

  ### 并发任务 (8 uses)
  src/worker.rs:45
    tokio::spawn(async move { process(item).await });

  ### 后台清理 (3 uses)
  src/cache.rs:120
    tokio::spawn(async { cleanup_expired().await });

  ### 错误处理 (1 use)
  src/main.rs:34
    let handle = tokio::spawn(async { run_server().await });
    if let Err(e) = handle.await { ... }
```

---

## 七、Agent 组合模式

以下功能不需要新工具——Agent 组合已有 CodeGraph 数据即可完成。记录于此作为 Agent 系统提示词中的预设模式。

### 7.1 PR 影响范围标注

```
Agent 模式: 收到 "审查 PR" 或 "这个修改会影响什么" 时:

  1. git diff → 获取修改的文件和函数
  2. impact(每个修改的函数, depth=2) → 获取影响范围
  3. 检查: 所有直接调用方是否都在本次 diff 中？
     → 有遗漏 → 标注 "⚠️ 未修改"

输出:
  ## 影响范围 (CodeGraph)

  直接影响:
    ✅ src/auth/service.rs:42 — 已修改
    ❌ src/middleware/auth.rs:89 — **漏改！仍需更新**

  间接影响: src/router.rs, src/main.rs
  受影响测试: test_login, test_token_expiry
```

### 7.2 新人引导地图

```
Agent 模式: 收到 "帮我理解这个项目" / "onboarding" 时:

  1. explore(项目入口) → 找到 main() / 路由 / 配置
  2. callers(核心类型) → 按被依赖次数排序 — 先读最核心的
  3. framework 检测 → 标注项目类型
  4. 按依赖关系组织为"先看A，再看B"的顺序

输出: 按阅读顺序排列的项目入口地图
```

### 7.3 文档/代码同步检查

```
Agent 模式: 收到 "检查文档是否过期" 时:

  1. search(kind=Symbol, has_docstring=true) → 找到有文档的符号
  2. 对比 docstring 中的签名 vs 实际签名
  3. 报告不一致的

输出: 过期的文档注释清单
```

### 7.4 死代码检测

```
Agent 模式: 收到 "找死代码" 时:

  1. search(unused=true) → CodeGraph 返回 0 callers 的符号
  2. 分类: 无调用者 / 仅测试引用 / pub fn (可能是公共 API)
  3. git log 推断最后使用时间

输出: 分类的死代码清单 + 删除建议
```

### 7.5 关联文档同步检查

```
场景: 修改了函数签名，关联的 .md 文档仍描述旧用法

Agent 模式: 完成一批修改后，在 Plan 的验证步骤中自动执行:

  1. git diff → 提取本次修改的符号名 (函数名/struct名/trait名)
  2. codegraph_search(每个符号名, 限制到 .md 文件)
     → FTS5 搜索所有文档中出现的符号引用
  3. 对比: 文档中描述的签名/行为 vs 当前实际签名
     → 不一致 → 标注需要更新

Agent 在 Plan 结束前:
  "## 需要更新的文档 (CodeGraph 检测)

   本次修改了 3 个符号，影响 2 份文档:

   ⚠️ README.md:45 — 示例代码仍使用旧签名
      旧: validate(token: &str) -> Result<bool>
      新: validate(token: &Token, db: &Database) -> Result<AuthResult>

   ⚠️ docs/architecture.md:120 — 返回值描述已过时
      旧: "TokenManager::validate 返回 bool 表示是否有效"
      新: "返回 AuthResult 包含验证详情和过期时间"

用户 /approve → Agent 执行代码修改 + 同步更新关联文档"

实现: CodeGraph 已有 symbols_fts (FTS5 全文搜索)。扩展索引范围到 .md 文件的内容即可——符号名出现在哪些文档中，与出现在哪些代码中，查询方式相同。
```

---

## 八、工具总览

| #   | 工具                  | 类别     | 数据源                | 对标优势                 |
| --- | --------------------- | -------- | --------------------- | ------------------------ |
| 23  | `codegraph_visualize` | ReadOnly | CodeGraph 三表        | 8 个对标产品无一具备     |
| 24  | `docs`                | Costly   | 注册表 + web_fetch    | 替代 Context7 MCP        |
| 25  | `stacktrace`          | ReadOnly | CodeGraph trace()     | 替代手动 read_file 追踪  |
| 26  | `test`                | Exec     | CodeGraph impact()    | 跑受影响的测试（非全量） |
| 27  | `suggest`             | Costly   | 模式检测 + web_search | 代码模式自动检测         |
| 28  | `examples`            | Costly   | CodeGraph search()    | 项目内零 API 调用        |

Agent 组合模式（不新增工具，Agent 用已有工具自主完成）:
├── PR 影响范围标注 (impact + git diff)
├── 新人引导地图 (explore + callers + framework)
├── 文档/代码同步检查 (search + docstring 对比)
├── 死代码检测 (search(unused=true) + git log)
└── 关联文档同步检查 (search in .md + 签名对比)
| 28 | `examples` | Costly | CodeGraph search() | 项目内零 API 调用 |

### 数据来源

```
编译时嵌入（本地、零延迟）:
  ├── 代码模式注册表 (~30 个反模式 → 替代建议)
  ├── 生态知识库 (~200 个库分类)
  ├── 文档 URL 模板 (4 种语言自动推断)
  ├── 架构违规规则 (5 层依赖方向)
  └── 50 个高频库的文档注册表

运行时（CodeGraph 已有数据）:
  ├── symbols 表 → 符号搜索、模式检测
  ├── edges 表   → trace、impact、依赖图
  └── files 表   → 模块边界检测

外部（web_search/web_fetch 兜底）:
  └── 实时文档、生态对比、最佳实践
```

### 内置工具总数

|          | 之前 | 现在   |
| -------- | ---- | ------ |
| 内置工具 | 22   | **28** |

---

---

## 九、未来：GUI CodeGraph 分层全景图

> 版本：v1.0+（GUI 阶段）
> 核心思路：当前 TUI 中 6 个独立工具，在 GUI 中是**同一个 CodeGraph 视图上叠加 7 层信息**。数据层从头到尾不变——只是渲染方式从"文本流"进化到"空间画布"。

### 9.1 概念

```
┌─ CodeGraph ──────────────────────────────────────────────────────┐
│                                                                   │
│  Layers:  [✓] Symbols  [✓] Dependencies  [ ] Dead Code           │
│           [ ] Tests    [ ] Architecture  [✓] Changes              │
│                                                                   │
│  Focus: [auth::TokenManager________________] [Explore]            │
│                                                                   │
│  ┌─ Project View ───────────────────────┬─ Detail Panel ────────┐ │
│  │                                     │                        │ │
│  │  src/                               │ TokenManager::validate │ │
│  │  ├── auth/                          │ src/auth/token.rs:128  │ │
│  │  │   ├── service.rs  ⬤             │                        │ │
│  │  │   │   ├── authenticate()  ⬤     │ Callers (3):           │ │
│  │  │   │   ├── login()               │  authenticate()        │ │
│  │  │   │   └── logout()              │  auth_handler()        │ │
│  │  │   ├── token.rs ⚠                │  auth_middleware()     │ │
│  │  │   │   ├── TokenManager ▓        │                        │ │
│  │  │   │   │   ├── new()             │ Callees (4):           │ │
│  │  │   │   │   ├── validate() ◀ 选中 │  sqlx::query()         │ │
│  │  │   │   │   ├── rotate_key() ☠    │  argon2::verify()      │ │
│  │  │   │   │   └── revoke()          │  config::get_secret()  │ │
│  │  │   │   └── ...                   │  tracing::warn()       │ │
│  │  │   └── mod.rs                    │                        │ │
│  │  ├── api/    ⚡                     │ Tests (1/2):           │ │
│  │  │   ├── handler.rs  ⬤             │ ✅ test_login           │ │
│  │  │   └── middleware.rs  ⬤   🔴     │ ☐ test_token_expiry    │ │
│  │  ├── ...                           │                        │ │
│  │  │                                 │ Recent Changes:        │ │
│  │  │                                 │ 2h ago - rotate_key()  │ │
│  │  │                                 │   added by @user       │ │
│  │  │                                 │                        │ │
│  │  │                                 │ Architecture:          │ │
│  │  │                                 │ Engine → Intelligence  │ │
│  │  │                                 │ ⚠ 违规: session依赖   │ │
│  │  │                                 │ agent (session.rs:234) │ │
│  │  └─────────────────────────────────┴────────────────────────┘ │
│                                                                   │
│  Legend:  ⬤ 已测试  ☠ 死代码  ⚠ 无测试  ⚡ 架构违规  🔴 最近修改 │
│           ▓ 已修改但未测试                                         │
└───────────────────────────────────────────────────────────────────┘
```

### 9.2 七层可独立切换的视图

同一项目树，不同信息密度——每一层是一个可开可关的视觉叠加：

```
Layer 1: 符号树（基础层——始终可见）
  ├── 项目文件树 + 每个文件内的符号
  ├── 粒度: fn → struct → impl → trait → const → type
  └── 嵌套缩进展示结构层次

Layer 2: 依赖图
  ├── 开关: 显示/隐藏调用边
  ├── 箭头从 caller → callee
  ├── 线粗细 = 调用频率
  ├── 红色线 = 跨层违规依赖
  └── Click 边 → 显示该调用在源码中的位置

Layer 3: 死代码
  ├── 开关: 高亮未使用的符号
  ├── 灰色 + 删除线 = 确认无调用者
  ├── 橙色 = 仅测试引用（可能是测试辅助函数）
  └── Hover 显示: "last used: 6 months ago (git log)"

Layer 4: 测试覆盖
  ├── 开关: 热力图模式
  ├── ⬤ 绿色 = 有测试覆盖
  ├── ⚠ 黄色 = 部分覆盖（函数有测试，但某分支未覆盖）
  ├── 🔴 红色 = 完全无测试
  ├── ▓ 灰色块 = 最近修改但未更新测试
  └── 状态栏: "覆盖率 67% (142/213 symbols)"

Layer 5: 架构
  ├── 开关: 架构违规检测
  ├── 红色边框闪烁 = 依赖方向违规
  ├── 黄色虚线 = 循环依赖
  ├── 紫色 = 依赖权重过高（单依赖 > 20 次调用）
  └── Click 违规 → 展开违规详情 + 修复建议

Layer 6: 变更感知
  ├── 开关: git 时间戳颜色
  ├── 蓝色边框 = 今天修改
  ├── 绿色边框 = 本周修改
  ├── 灰色 = >30 天未修改
  └── Hover 显示: "last modified 2h ago by @user: fix auth bug"

Layer 7: 聚焦/展开
  ├── 选中符号 → Detail Panel 全信息
  ├── 调用者 + 被调用者 + 测试状态 + git 变更 + 架构层 + 文档
  └── 双击 → 新 Tab 聚焦视图（以该符号为中心的子图）
```

### 9.3 交互模型

```
左侧项目树:
  ├── 单击符号 → Detail Panel 更新
  ├── 双击符号 → 新 Tab "聚焦视图"（仅此符号相关的子图）
  ├── 右键菜单:
  │   ├── "Trace from here"
  │   ├── "Find all callers"
  │   ├── "Find impact"
  │   ├── "Open in $EDITOR"
  │   ├── "Run tests for this symbol"
  │   ├── "Show usage examples"
  │   └── "Open docs"
  └── 拖拽符号到搜索框 → 设为当前 focus

右上搜索:
  ├── 符号名 → 实时过滤 + 高亮匹配
  ├── "dead:true" → 仅显示死代码
  ├── "tested:false" → 仅显示无测试覆盖
  ├── "layer:Engine" → 仅显示 Engine 层
  └── "changed:today" → 仅显示今天修改

底部状态栏:
  ├── 图层切换: 1=符号 2=依赖 3=死代码 4=测试 5=架构 6=变更
  ├── 缩放滑块 / 重置视图
  └── 统计: "213 symbols, 89 edges, 3 violations, 12 dead, 67% tested"
```

### 9.4 各层数据来源

```
全部基于同一 CodeGraph 数据:

  symbols 表  → Layer 1 (符号树)
  edges 表    → Layer 2 (依赖图) + Layer 5 (架构)
  callers()   → Layer 3 (死代码检测)
  kind=Test   → Layer 4 (测试覆盖)  + Layer 6 (变更，来自 git log)

  suggest 生态知识库 → Detail Panel "替代建议"
  docs 文档注册表    → Detail Panel "Open docs"

外部数据（可选叠加）:
  git log    → Layer 6 (变更时间戳 + 作者)
  test runner → Layer 4 (真实覆盖率数据)
```

### 9.5 TUI 工具 → GUI 视图映射

| TUI 工具 (v0.1.0)     | GUI 等价 (v1.0+)                                 |
| --------------------- | ------------------------------------------------ |
| `codegraph_visualize` | Layer 2: 依赖图 + Layer 5: 架构（同时开启）      |
| `stacktrace`          | 右键 "Trace from here" → 自动展开整条调用链      |
| `test`                | Layer 4: 测试覆盖热力图（实时更新）              |
| `audit deadcode`      | Layer 3: 死代码灰色高亮                          |
| `audit coverage`      | Layer 4: 热力图 + 状态栏百分比                   |
| `suggest`             | 选中反模式符号 → Detail Panel "替代建议"         |
| `examples`            | 右键 "Show usage examples" → 弹出项目内/生态用法 |
| `docs`                | Detail Panel 中 "Open docs" → 内嵌浏览器打开     |
| 代码导航              | 搜索框 + 单击跳转 + Detail Panel                 |

### 9.6 实现路径

```
v0.1.0: TUI 工具层
  └── 6 个独立 CodeGraph 智能工具，每个返回文本/结构化数据

v0.x.0: TUI 分层视图（CodeGraph Tab [Deps] 子 Tab）
  └── ASCII 依赖树 + 违规检测 + 展开/折叠 + 键盘导航

v1.0.0: GUI CodeGraph 全景图
  └── 7 层可切换视图 + 交互式项目浏览
  └── 基于 Tauri/Electron + D3.js/Canvas/WebGL
  └── 同一 CodeGraph 后端，不同前端渲染
  └── 数据层从头到尾不变
```

---

> 设计结束。6 个 CodeGraph 智能工具（v0.1.0 TUI）+ 7 层 GUI 全景图（v1.0+ 目标）。全部基于 `symbols` + `edges` + `files` 三表——数据层不变，渲染层随产品形态进化。
