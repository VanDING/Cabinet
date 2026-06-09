# CABINET.md — Cabinet 项目操作手册

## 构建与测试

- 构建全部: `pnpm build` (等价于 `pnpm -r build`，每个包内执行 `tsc -b`)
- 类型检查: `pnpm typecheck` (等价于 `pnpm -r typecheck`，每个包内执行 `tsc --noEmit`)
- 运行测试: `pnpm test` (等价于 `pnpm -r test`，每个包内执行 `vitest run`)
- E2E 测试: `cd tests/e2e && vitest run`
- 桌面应用开发模式: `cd apps/desktop && pnpm tauri:dev`
- 单个包操作: `pnpm -F @cabinet/<name> <script>`，例如 `pnpm -F @cabinet/agent test`
- 架构检查: `pnpm lint:arch` — 验证 4 层依赖规则，所有错误信息包含修复指令

## 架构约束（不可违反）

### 4 层依赖方向: Layer 1 → Layer 2 → Layer 3 → Layer 4

```
Layer 4 (Interface):   ui, server, desktop, cli       ← 用户/网络边界
Layer 3 (Business):    decision, secretary, workflow, harness, organize (source empty, pending removal)  ← 业务逻辑
Layer 2 (Agent Core):  gateway, agent, memory, agent-sdk  ← AI 交互核心
Layer 1 (Infra):       graph, types, events, storage      ← 基础设施
```

- 下层绝不依赖上层。如果 Layer 1 的代码 import 了 Layer 3，就是 bug。
- 同层之间可以互相依赖。
- `types` 包是唯一所有层都可以依赖的包，但它不能依赖任何其他包。
- 新包必须声明它属于哪一层，依赖只能指向同层或下层。

### 包命名与导出

- 所有包使用 `@cabinet/` scope: `@cabinet/<name>`
- 每个包的入口: `dist/index.js`，类型: `dist/index.d.ts`
- 包的公共 API 通过 `index.ts` (barrel export) 暴露。内部模块不得被其他包直接 import。
- 新包创建后必须加入 `pnpm-workspace.yaml` 的 workspace 列表。

### 技术栈（不可替换）

- 运行时: Node.js (ES2022)，前端: React 19
- 构建: TypeScript 5.9+ (composite projects), Vite 6
- 包管理: pnpm (workspace protocol)
- 数据库: SQLite (better-sqlite3)，AES-256 加密
- 桌面壳: Tauri 2.0 (Rust 后端 + React 前端)
- 服务端: Hono (REST + WebSocket)
- LLM 网关: Vercel AI SDK (多 provider)
- 样式: Tailwind CSS 4.3
- 测试: Vitest

### TypeScript 约束

- `strict: true` — 全局开启，不可关闭
- `noUncheckedIndexedAccess: true` — 所有索引访问需处理 undefined
- `verbatimModuleSyntax: true` — import 类型时必须用 `import type`
- 使用 `tsc -b` (composite/build mode) 做构建，不要用 `tsc` (plain mode)
- `*.tsbuildinfo` 在 `.gitignore` 中，不要提交

### 模块行数上限

- 单个文件不超过 500 行（不含测试）。超过 800 行必须拆分新模块。
- 这条规则尤其在 `packages/agent/`、`apps/server/src/routes/`、`apps/desktop/src/pages/` 中适用，这些目录已有高频修改的大文件。

## 代码约定

- 新功能优先复用现有包的模式，不要引入新的抽象层或第三方库，除非有明确的必要性说明。
- 不要在代码中写 JSDoc 注释块和多行注释，除非要解释"为什么"（不是"是什么"）。
- 公共 API 的类型定义放在 `packages/types/`，不要散落在各包中重复定义。
- 数据库迁移按顺序编号，写入 `packages/storage/` 的 migrations 目录。迁移不可逆（不写 down 迁移）。
- 新增路由请向 `apps/server/src/routes/` 添加文件，然后在 `apps/server/src/index.ts` 注册。

## 禁止事项

- 不要修改 `.claude/settings.local.json` 除非用户明确要求。
- 不要提交包含 API key 或密码的文件。检查 `.env` 和 `*.local.*` 已在 `.gitignore` 中。
- 不要直接 import `better-sqlite3` —— 统一通过 `@cabinet/storage` 访问数据库。
- 不要在前端代码中直接调用 LLM API —— 必须通过 `@cabinet/gateway` → server 路由。
- 不要在 Layer 1/2 的包中 import React 或任何 UI 依赖。

## Git 约定

- Commit message 使用中文或英文均可，但同一分支保持一致。
- 不要 force push 到 main。
- `src-tauri/target/` 和 `dist/` 不提交（已在 `.gitignore`）。
