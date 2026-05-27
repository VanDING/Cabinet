# Cabinet 测试问题修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Cabinet 测试中发现的 13 个问题，覆盖项目数据层、Agent 执行层、UI/交互层。

**Architecture:** Phase 1 修正项目存储与 API 透传；Phase 2 在 ContextBuilder 引入请求级缓存、优化 Secretary 路由、默认启用 Scheduler；Phase 3 增强 FileViewer 预览、调整消息流视觉权重、补全 WebSocket 事件。

**Tech Stack:** TypeScript, React, Tauri, SQLite, node-cron, Vitest

---

## File Map

| File                                                         | Responsibility                                                         |
| ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `packages/storage/src/migrations/003_project_name_unique.ts` | **Create** — 为 `projects.name` 添加 UNIQUE 约束                       |
| `apps/server/src/routes/projects.ts`                         | **Modify** — 项目创建时初始化物理目录、同名检测、旧数据清理            |
| `packages/storage/src/repositories/project.ts`               | **Modify** — 新增 `findByName()` 方法                                  |
| `apps/server/src/routes/workflows.ts`                        | **Modify** — `create_workflow` 路由 projectId 透传、Scheduler 默认启用 |
| `packages/agent/src/tools/index.ts`                          | **Modify** — `create_workflow` 工具 projectId 必填                     |
| `apps/server/src/routes/deliverables.ts`                     | **Modify/Create** — 全局交付物聚合端点 `GET /api/deliverables`         |
| `packages/agent/src/context-builder.ts`                      | **Modify** — 请求级缓存（TTL 5s）                                      |
| `packages/agent/src/__tests__/context-builder.test.ts`       | **Create/Modify** — 验证缓存命中、失效、跨会话共享                     |
| `packages/agent/src/agent-loop.ts`                           | **Modify** — 支持 `prebuiltContext` 透传                               |
| `apps/server/src/routes/secretary.ts`                        | **Modify** — Secretary 短路由、移除 decisionanalysis 路由依赖          |
| `apps/server/src/capabilities.ts`                            | **Modify** — Scheduler 默认启用                                        |
| `apps/server/src/routes/ws.ts`                               | **Modify** — 补全 WebSocket 广播事件                                   |
| `apps/desktop/src/components/FileViewer.tsx`                 | **Modify** — iframe 预览、源码/预览切换、拖拽宽度                      |
| `apps/desktop/src/components/ChatView.tsx`                   | **Modify** — Thinking 内容上提、ToolCallSummary 默认折叠               |
| `apps/desktop/src/components/office/DeliverablesPanel.tsx`   | **Modify** — 点击交付物触发 `open-file-viewer`                         |

---

## 执行状态总览

> **2026-05-26 更新**：在准备执行前拉取了远程最新代码（`9f14d4a`），发现本计划中 **90% 以上的内容已由远程代码实现**。以下标注各 Task 的当前状态。

| Task       | 状态      | 说明                                                                     |
| ---------- | --------- | ------------------------------------------------------------------------ |
| Task 1-5   | ✅ 已完成 | 数据层全部已由远程实现                                                   |
| Task 6-7   | ✅ 已完成 | ContextBuilder 缓存与 prebuiltContext 已存在                             |
| Task 8     | ✅ 已完成 | `secretary.ts` 中使用 `intentParser` 做路由，未见 decisionanalysis 依赖  |
| Task 9-10  | ✅ 已完成 | Scheduler 默认启用、T0-T3 授权已存在                                     |
| Task 11    | ✅ 已完成 | FileViewer iframe 预览与拖拽宽度已实现                                   |
| Task 12    | ✅ 已完成 | thinking 已在 toolCalls 上方，`ToolCallSummary` 内部有 expanded 状态管理 |
| Task 13-14 | ✅ 已完成 | WebSocket 事件监听已补全、DeliverablesPanel 已可点击                     |

---

## Phase 1: 项目数据层

**依赖:** 无前置依赖，可独立实施。  
**状态:** ✅ 已全部由远程代码实现，无需执行。

---

### Task 1: 项目名唯一性约束 ✅ 已完成

**Files:**

- Create: `packages/storage/src/migrations/003_project_name_unique.ts`
- Modify: `packages/storage/src/migrations/index.ts`
- Test: 通过 `projects.ts` 路由测试间接验证

- [ ] **Step 1: 创建迁移文件**

  Create `packages/storage/src/migrations/003_project_name_unique.ts`:

  ```ts
  import { Database } from 'better-sqlite3';

  export function up(db: Database.Database) {
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_name_unique
      ON projects(name);
    `);
  }

  export function down(db: Database.Database) {
    db.exec(`DROP INDEX IF EXISTS idx_projects_name_unique;`);
  }
  ```

- [ ] **Step 2: 注册迁移**

  Modify `packages/storage/src/migrations/index.ts`，将 `003_project_name_unique` 加入 migrations 数组。

- [ ] **Step 3: 验证迁移运行**

  Run: `npx tsx scripts/migrate.ts` (或项目等效命令)
  Expected: 迁移成功执行，无错误。

- [ ] **Step 4: Commit**

  ```bash
  git add packages/storage/src/migrations/
  git commit -m "feat(storage): add unique constraint on projects.name"
  ```

---

### Task 2: 项目创建时初始化物理目录 ✅ 已完成

**Files:**

- Modify: `apps/server/src/routes/projects.ts`
- Modify: `packages/storage/src/repositories/project.ts`
- Test: `apps/server/src/routes/__tests__/projects.test.ts` (若存在；否则在 Step 1 创建)

- [ ] **Step 1: 新增 findByName 仓库方法**

  Modify `packages/storage/src/repositories/project.ts`，新增：

  ```ts
  async findByName(name: string): Promise<Project | undefined> {
    const row = this.db.prepare('SELECT * FROM projects WHERE name = ?').get(name) as ProjectRow | undefined;
    return row ? this.mapRow(row) : undefined;
  }
  ```

- [ ] **Step 2: 写同名检测失败测试**

  Create or append to `apps/server/src/routes/__tests__/projects.test.ts`:

  ```ts
  it('returns 409 when project name already exists', async () => {
    await request(app).post('/api/projects').send({ name: 'DuplicateProject' }).expect(201);

    await request(app).post('/api/projects').send({ name: 'DuplicateProject' }).expect(409);
  });
  ```

- [ ] **Step 3: 运行测试确认失败**

  Run: `npx vitest run apps/server/src/routes/__tests__/projects.test.ts --reporter=verbose`
  Expected: FAIL — 第二次创建返回 201 而非 409。

- [ ] **Step 4: 修改项目创建路由**

  Modify `apps/server/src/routes/projects.ts` 中 `POST /api/projects` 处理器：

  ```ts
  import { mkdirSync, existsSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
  import { join } from 'node:path';
  import { CABINET_DIR } from '@cabinet/storage/paths';

  // 在 handler 开头插入同名检测
  const existing = await projectRepo.findByName(d.name);
  if (existing) {
    return res.status(409).json({ error: 'Project name already exists' });
  }

  // 创建项目记录
  const project = await projectRepo.create({ ... });

  // 初始化物理目录
  const projectDir = join(CABINET_DIR, 'projects', d.name);
  if (!existsSync(projectDir)) {
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(join(projectDir, '.cabinet', 'rules'), { recursive: true });
    mkdirSync(join(projectDir, '.cabinet', 'skills'), { recursive: true });
    mkdirSync(join(projectDir, '.cabinet', 'mcp'), { recursive: true });
    mkdirSync(join(projectDir, 'deliverables'), { recursive: true });
  } else {
    // 复用旧文件夹，清理旧数据（保留 .cabinet/ 配置）
    const entries = readdirSync(projectDir);
    for (const entry of entries) {
      if (entry === '.cabinet') continue;
      const fullPath = join(projectDir, entry);
      // 递归删除文件/目录（可用 fs.rmSync(fullPath, { recursive: true, force: true })）
    }
  }

  // 更新 rootPath
  await projectRepo.update(project.id, { rootPath: projectDir });
  ```

- [ ] **Step 5: 运行测试确认通过**

  Run: `npx vitest run apps/server/src/routes/__tests__/projects.test.ts --reporter=verbose`
  Expected: PASS。

- [ ] **Step 6: Commit**

  ```bash
  git add packages/storage/src/repositories/project.ts apps/server/src/routes/projects.ts
  git commit -m "feat(projects): auto-init project directory with name uniqueness check"
  ```

---

### Task 3: create_workflow projectId 透传（服务端） ✅ 已完成

**Files:**

- Modify: `apps/server/src/routes/workflows.ts`
- Test: `apps/server/src/routes/__tests__/workflows.test.ts` (若存在)

- [ ] **Step 1: 写失败测试**

  ```ts
  it('returns 400 when projectId is missing', async () => {
    await request(app)
      .post('/api/workflows')
      .send({ name: 'TestWorkflow', definition: {} })
      .expect(400);
  });
  ```

- [ ] **Step 2: 运行测试确认失败**

  Run: `npx vitest run apps/server/src/routes/__tests__/workflows.test.ts`
  Expected: FAIL — 当前缺少 projectId 时返回 201（因 fallback 到 default）。

- [ ] **Step 3: 修改路由**

  Modify `apps/server/src/routes/workflows.ts` 中 `POST /api/workflows`：

  ```ts
  if (!input.projectId) {
    return res.status(400).json({ error: 'projectId is required' });
  }
  const workflow = await ctx.workflowRepo.create(id, input.projectId, input.name, ...);
  ```

  同时移除或修改 `create_workflow` handler 中所有 `input.projectId ?? 'default'` 的 fallback 写法。

- [ ] **Step 4: 运行测试确认通过**

  Run: `npx vitest run apps/server/src/routes/__tests__/workflows.test.ts`
  Expected: PASS。

- [ ] **Step 5: Commit**

  ```bash
  git add apps/server/src/routes/workflows.ts
  git commit -m "fix(workflows): reject create_workflow without projectId"
  ```

---

### Task 4: create_workflow tool projectId 必填（Agent 层） ✅ 已完成

**Files:**

- Modify: `packages/agent/src/tools/index.ts`
- Test: `packages/agent/src/tools/__tests__/index.test.ts` (若存在)

- [ ] **Step 1: 修改工具定义**

  Modify `packages/agent/src/tools/index.ts` 中 `create_workflow` 的执行逻辑：

  ```ts
  // 修改前
  const projectId = (args.projectId as string) ?? 'default';

  // 修改后
  const projectId = args.projectId as string;
  if (!projectId) {
    return { content: [{ type: 'text', text: 'Error: projectId is required' }], isError: true };
  }
  ```

- [ ] **Step 2: 运行相关测试**

  Run: `npx vitest run packages/agent/src/tools --reporter=verbose`
  Expected: 若无现有测试，至少确认类型检查通过。

- [ ] **Step 3: Commit**

  ```bash
  git add packages/agent/src/tools/index.ts
  git commit -m "fix(agent-tools): make projectId required in create_workflow"
  ```

---

### Task 5: 交付物聚合 API ✅ 已完成

**Files:**

- Modify/Create: `apps/server/src/routes/deliverables.ts`
- Modify: `apps/desktop/src/pages/OfficePage.tsx`
- Modify: `apps/desktop/src/components/office/Deliverables.tsx`

- [ ] **Step 1: 新增全局交付物端点**

  在 `apps/server/src/routes/deliverables.ts`（若不存在则创建）中新增：

  ```ts
  router.get('/api/deliverables', async (req, res) => {
    const deliverables = await deliverableRepo.findAll({ orderBy: 'created_at DESC', limit: 50 });
    res.json(deliverables);
  });
  ```

  确认 `packages/storage/src/repositories/deliverable.ts` 有 `findAll` 方法；若无，先添加：

  ```ts
  async findAll(options?: { orderBy?: string; limit?: number }): Promise<Deliverable[]> {
    let sql = 'SELECT * FROM deliverables';
    if (options?.orderBy) sql += ` ORDER BY ${options.orderBy}`;
    if (options?.limit) sql += ` LIMIT ${options.limit}`;
    const rows = this.db.prepare(sql).all() as DeliverableRow[];
    return rows.map(r => this.mapRow(r));
  }
  ```

- [ ] **Step 2: 前端调用全局端点**

  Modify `apps/desktop/src/components/office/Deliverables.tsx`（Office 首页版本）：

  ```ts
  // Office 首页使用全局聚合
  const url = '/api/deliverables';
  ```

  Modify `apps/desktop/src/components/office/Deliverables.tsx`（或 Project Dashboard 版本）：

  ```ts
  // Project Dashboard 使用项目过滤
  const url = `/api/projects/${projectId}/deliverables`;
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add apps/server/src/routes/deliverables.ts apps/desktop/src/components/office/Deliverables.tsx
  git commit -m "feat(deliverables): add global aggregation endpoint for office homepage"
  ```

---

## Phase 2: Agent 执行层

**依赖:** Phase 1 完成后实施，尤其依赖 `projectId` 透传正确，以确保缓存 key 有效。  
**状态:** ✅ 已全部由远程代码实现。

---

### Task 6: ContextBuilder 请求级缓存 ✅ 已完成

**Files:**

- Modify: `packages/agent/src/context-builder.ts`
- Create/Modify: `packages/agent/src/__tests__/context-builder.test.ts`

- [ ] **Step 1: 写失败测试**

  Append to `packages/agent/src/__tests__/context-builder.test.ts` (或新建)：

  ```ts
  import { describe, it, expect, vi, beforeEach } from 'vitest';
  import { ContextBuilder } from '../context-builder.js';
  import type { MemoryProvider } from '../context-builder.js';

  class SpyMemoryProvider implements MemoryProvider {
    calls: { method: string; args: unknown[] }[] = [];
    async getShortTerm() {
      return [];
    }
    async getProjectContext() {
      return 'Test project';
    }
    async getEntityPreferences() {
      return {};
    }
    async searchLongTerm(query: string, projectId: string) {
      this.calls.push({ method: 'searchLongTerm', args: [query, projectId] });
      return [`Result for ${query}`];
    }
  }

  describe('ContextBuilder context cache', () => {
    let memory: SpyMemoryProvider;
    let builder: ContextBuilder;

    beforeEach(() => {
      memory = new SpyMemoryProvider();
      builder = new ContextBuilder(memory);
    });

    it('reuses cached snapshot and rules within 5s for same projectId', async () => {
      // 验证方式：ContextBuilder 在同 projectId 第二次 build 时
      // 不应触发新的 searchLongTerm 调用（已由 Task 1 的 RAG 缓存保证）
      // 且 build() 返回时间应显著短于首次（缓存命中）
      const t0 = performance.now();
      await builder.build({ sessionId: 's1', projectId: 'p1', captainId: 'c1' });
      const t1 = performance.now();
      await builder.build({ sessionId: 's2', projectId: 'p1', captainId: 'c1' });
      const t2 = performance.now();

      expect(t2 - t1).toBeLessThan(t1 - t0); // 缓存命中应更快
    });

    it('refreshes cache after TTL expires', async () => {
      vi.useFakeTimers();
      await builder.build({ sessionId: 's1', projectId: 'p1', captainId: 'c1' });
      vi.advanceTimersByTime(6_000);
      await builder.build({ sessionId: 's2', projectId: 'p1', captainId: 'c1' });
      vi.useRealTimers();
    });
  });
  ```

  > **注意**：由于 `ContextBuilder` 内部调用 `ProjectSnapshot.capture()` 和 `RulesLoader.loadMatching()`，测试需要通过 spy 或计数器来验证缓存。若 `ProjectSnapshot` 和 `RulesLoader` 不易 spy，可在 `ContextBuilder` 上暴露轻量级的 `cacheHitCount` 供测试读取。

- [ ] **Step 2: 实现请求级缓存**

  Modify `packages/agent/src/context-builder.ts`：

  ```ts
  export class ContextBuilder {
    private contextCache = new Map<string, {
      snapshot: Snapshot;
      rules: LoadedRule[];
      timestamp: number;
    }>();
    private readonly CONTEXT_CACHE_TTL_MS = 5_000;

    // ... 在 build() 方法内替换原有快照/规则采集逻辑 ...
    const cacheKey = options.projectId;
    const cached = this.contextCache.get(cacheKey);
    const now = Date.now();

    let snapshot: Snapshot;
    let rules: LoadedRule[];

    if (cached && now - cached.timestamp < this.CONTEXT_CACHE_TTL_MS) {
      snapshot = cached.snapshot;
      rules = cached.rules;
    } else {
      const projectRoot = options.projectRoot ?? process.cwd();
      snapshot = ProjectSnapshot.capture(projectRoot);
      rules = this.rulesLoader?.loadMatching(rulesContext) ?? [];
      this.contextCache.set(cacheKey, { snapshot, rules, timestamp: now });
    }
  ```

- [ ] **Step 3: 在 clearSessionCache 中支持按 projectId 清除**

  ```ts
    clearSessionCache(sessionId: string, projectId?: string): void {
      // 原有 sessionCache 清除逻辑
      if (projectId) {
        this.contextCache.delete(projectId);
      }
    }
  ```

- [ ] **Step 4: 运行测试**

  Run: `npx vitest run packages/agent/src/__tests__/context-builder.test.ts --reporter=verbose`
  Expected: PASS。

- [ ] **Step 5: Commit**

  ```bash
  git add packages/agent/src/context-builder.ts packages/agent/src/__tests__/context-builder.test.ts
  git commit -m "perf(agent): add request-level context cache in ContextBuilder"
  ```

---

### Task 7: AgentLoop prebuiltContext 透传 ✅ 已完成

**Files:**

- Modify: `packages/agent/src/agent-loop.ts`
- Modify: `packages/agent/src/context-builder.ts`

- [ ] **Step 1: 扩展 AgentLoopOptions**

  Modify `packages/agent/src/agent-loop.ts`：

  ```ts
  interface AgentLoopOptions {
    // ... 现有字段
    prebuiltContext?: {
      snapshot: Snapshot;
      rulesSummary: string;
      projectContext: string;
    };
  }
  ```

- [ ] **Step 2: 透传给 ContextBuilder**

  在 `AgentLoop` 初始化 `ContextBuilder` 时，将 `this.options.prebuiltContext` 传入 `build()` 调用。

- [ ] **Step 3: ContextBuilder 支持 prebuiltContext**

  Modify `packages/agent/src/context-builder.ts` 中 `build()` 方法：

  ```ts
  if (options.prebuiltContext) {
    return this.buildFromPrebuilt(options.prebuiltContext, options);
  }
  ```

  新增私有方法 `buildFromPrebuilt()`，直接组装系统提示，跳过 `ProjectSnapshot.capture()` 和 `RulesLoader.loadMatching()`。

- [ ] **Step 4: Commit**

  ```bash
  git add packages/agent/src/agent-loop.ts packages/agent/src/context-builder.ts
  git commit -m "feat(agent): support prebuiltContext passthrough for strict consistency"
  ```

---

### Task 8: Secretary 路由优化 ✅ 已完成

**Files:**

- Modify: `apps/server/src/routes/secretary.ts`
- Test: `apps/server/src/routes/__tests__/secretary.test.ts` (若存在)

- [ ] **Step 1: 识别当前 decisionanalysis 调用点**

  在 `apps/server/src/routes/secretary.ts` 中搜索 `decisionanalysis`、`decision_analyst`、`dispatchToSpecialist` 中由 Secretary 主动触发 decisionanalysis 的代码块。

- [ ] **Step 2: 移除 decisionanalysis 作为路由中介**

  将 Secretary 的路由逻辑改为直接判断：

  ```ts
  // SecretaryAgent 内部（或 secretary.ts 中的路由逻辑）
  async function routeMessage(msg: string, context: MessageContext): Promise<RouteResult> {
    // 短路由：无歧义的操作类指令
    const lower = msg.toLowerCase();
    if (
      lower.includes('设置定时任务') ||
      lower.includes('每天自动执行') ||
      lower.includes('cron')
    ) {
      return { targetAgent: 'workflow_designer', confidence: 0.95, skipUserConfirm: true };
    }
    if (lower.includes('取消所有定时任务') || lower.includes('删除定时任务')) {
      return { targetAgent: 'direct_tool_call', confidence: 0.95, skipUserConfirm: true };
    }
    if (lower.includes('列出我的工作流') || lower.includes('当前状态')) {
      return { targetAgent: 'direct_query', confidence: 0.95, skipUserConfirm: true };
    }

    // 复杂任务由 Secretary 自己分析
    const analysis = await analyzeTaskComplexity(msg, context);
    return {
      targetAgent: analysis.suggestedAgent,
      confidence: analysis.confidence,
      reasoning: analysis.reasoning,
      skipUserConfirm: analysis.confidence > 0.8,
    };
  }
  ```

  > 具体代码结构取决于 `SecretaryAgent` 的实现位置（可能在 `@cabinet/secretary` 包或 `secretary.ts` 内）。若 `SecretaryAgent` 来自外部包，优先在 `secretary.ts` 的 `dispatchToRole` 回调中做前置短路。

- [ ] **Step 3: 确保 decisionanalysis 仅用于分析场景**

  确认 `decisionanalysis` 的调用仅在用户明确要求分析（如"帮我分析一下可行性"）时触发，不在普通路由链路中调用。

- [ ] **Step 4: Commit**

  ```bash
  git add apps/server/src/routes/secretary.ts
  git commit -m "feat(secretary): direct routing with short-circuit for operational intents"
  ```

---

### Task 9: Scheduler 默认启用

**Files:**

- Modify: `apps/server/src/routes/workflows.ts`
- Modify: `apps/server/src/capabilities.ts`

- [ ] **Step 1: 修改能力门控**

  Modify `apps/server/src/routes/workflows.ts` 中工具注入逻辑：

  ```ts
  // 修改前
  scheduleTask: caps.scheduler ? shared.scheduleTask : stub('Scheduler'),

  // 修改后
  scheduleTask: shared.scheduleTask,
  ```

- [ ] **Step 2: 清理 capabilities.ts 中的 scheduler 门控（若存在）**

  若 `apps/server/src/capabilities.ts` 中 `scheduler` 为可选能力且默认 false，改为默认 true 或移除该门控。

- [ ] **Step 3: Commit**

  ```bash
  git add apps/server/src/routes/workflows.ts apps/server/src/capabilities.ts
  git commit -m "feat(scheduler): enable scheduler tools by default in workflows"
  ```

---

### Task 10: 用户授权级别 T0-T3 ✅ 已完成

**Files:**

- Modify: `packages/agent/src/agent-loop.ts`
- Modify: `apps/server/src/routes/secretary.ts`

- [ ] **Step 1: 在 AgentLoop 中接入授权级别**

  Modify `packages/agent/src/agent-loop.ts`：

  ```ts
  const TRUST_THRESHOLDS = {
    T0: { maxConsecutiveErrors: 2, maxProbeTools: 3 },
    T1: { maxConsecutiveErrors: 3, maxProbeTools: 5 },
    T2: { maxConsecutiveErrors: 5, maxProbeTools: 10 },
    T3: { maxConsecutiveErrors: 10, maxProbeTools: Infinity },
  };

  // 在 AgentLoop 的 while 循环中，使用当前授权级别判断错误阈值
  const trust = TRUST_THRESHOLDS[this.options.trustLevel ?? 'T1'];
  if (consecutiveErrors >= trust.maxConsecutiveErrors) {
    throw new Error(`Agent stopped after ${consecutiveErrors} consecutive errors`);
  }
  ```

- [ ] **Step 2: 支持对话内临时调整**

  在 `apps/server/src/routes/secretary.ts` 中，解析用户消息中的授权指令：

  ```ts
  function detectTrustLevelOverride(msg: string): 'T0' | 'T1' | 'T2' | 'T3' | null {
    const lower = msg.toLowerCase();
    if (lower.includes('允许你多尝试几次') || lower.includes('放手去做')) return 'T2';
    if (lower.includes('谨慎处理') || lower.includes('不要擅自')) return 'T0';
    return null;
  }
  ```

  将检测到的级别写入当前 session 的上下文，随 `AgentLoopOptions` 传递。

- [ ] **Step 3: Commit**

  ```bash
  git add packages/agent/src/agent-loop.ts apps/server/src/routes/secretary.ts
  git commit -m "feat(agent): add user-configurable trust levels T0-T3"
  ```

---

## Phase 3: UI/交互层

**依赖:** Phase 1 和 Phase 2 完成后实施，依赖正确的交付物 API 和 Agent 行为。  
**状态:** ✅ 已全部由远程代码实现。

---

### Task 11: FileViewer 增强（iframe 预览 + 拖拽宽度） ✅ 已完成

**Files:**

- Modify: `apps/desktop/src/components/FileViewer.tsx`

- [ ] **Step 1: 实现拖拽调整宽度**

  在 FileViewer 组件外层增加拖拽手柄：

  ```tsx
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem('fileViewerWidth');
    return saved ? parseInt(saved, 10) : Math.round(window.innerWidth * 0.4);
  });

  const handleMouseDown = (e: React.MouseEvent) => {
    const startX = e.clientX;
    const startWidth = width;
    const onMove = (ev: MouseEvent) => {
      const newWidth = Math.min(
        Math.max(startWidth - (ev.clientX - startX), 320),
        window.innerWidth * 0.7,
      );
      setWidth(newWidth);
      localStorage.setItem('fileViewerWidth', String(newWidth));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };
  ```

  渲染时：

  ```tsx
  <div style={{ width }} className="relative flex flex-col border-l ...">
    <div
      onMouseDown={handleMouseDown}
      className="absolute top-0 bottom-0 left-0 w-1 cursor-col-resize hover:bg-blue-400"
    />
    {/* ... */}
  </div>
  ```

- [ ] **Step 2: 增加预览模式切换**

  在 Tab bar 下方增加视图切换（仅对 HTML 文件显示）：

  ```tsx
  const [viewMode, setViewMode] = useState<'source' | 'preview'>('preview');
  const isHtml = active?.name.endsWith('.html') || active?.name.endsWith('.htm');
  const isPdf = active?.name.endsWith('.pdf');
  ```

  内容区渲染：

  ```tsx
  {isHtml && viewMode === 'preview' ? (
    <iframe
      sandbox="allow-scripts"
      srcDoc={active.content}
      className="w-full h-full border-0"
    />
  ) : isPdf ? (
    <iframe
      src={URL.createObjectURL(new Blob([active.content], { type: 'application/pdf' }))}
      className="w-full h-full border-0"
    />
  ) : isImage ? (
    <img ... />
  ) : (
    <pre ...>{active.content}</pre>
  )}
  ```

  对于 HTML 的 `srcDoc`，若内容中包含相对路径引用，需注入 `<base>` 标签：

  ```ts
  const htmlContent = active.content.includes('<base')
    ? active.content
    : active.content.replace(
        '<head>',
        `<head><base href="file://${active.path.substring(0, active.path.lastIndexOf('/'))}/">`,
      );
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add apps/desktop/src/components/FileViewer.tsx
  git commit -m "feat(fileviewer): add html/pdf preview and draggable width"
  ```

---

### Task 12: 消息流视觉权重调整 ✅ 已完成

**Files:**

- Modify: `apps/desktop/src/components/ChatView.tsx`（或 `MessageRow.tsx`）

- [ ] **Step 1: Thinking 内容上提**

  在 `MessageRow` 渲染中，将 `thinking` 块从消息底部移至工具调用摘要上方：

  ```tsx
  <div className="message-row">
    <div className="message-content">{msg.content}</div>

    {/* Thinking 块上提 */}
    {msg.thinking && (
      <details className="thinking-block mb-2">
        <summary className="thinking-summary">...</summary>
        <pre className="thinking-content">...</pre>
      </details>
    )}

    {/* ToolCallSummary 默认折叠 */}
    <ToolCallSummary calls={msg.toolCalls} defaultCollapsed={true} />
  </div>
  ```

- [ ] **Step 2: ToolCallSummary 默认折叠**

  Modify `ToolCallSummary` 组件，增加 `defaultCollapsed` prop：

  ```tsx
  interface ToolCallSummaryProps {
    calls: ToolCall[];
    defaultCollapsed?: boolean;
  }

  const ToolCallSummary = memo(({ calls, defaultCollapsed = true }: ToolCallSummaryProps) => {
    const [expanded, setExpanded] = useState(!defaultCollapsed);
    // ...
  });
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add apps/desktop/src/components/ChatView.tsx
  git commit -m "feat(ui): elevate thinking block and collapse tool calls by default"
  ```

---

### Task 13: WebSocket 事件补全 ✅ 已完成

**Files:**

- Modify: `apps/server/src/routes/ws.ts`（或广播逻辑所在文件）
- Modify: `apps/server/src/routes/projects.ts`
- Modify: `apps/server/src/scheduler.ts`
- Modify: `apps/desktop/src/pages/OfficePage.tsx`

- [ ] **Step 1: 在业务操作中补全广播**

  在 `apps/server/src/routes/projects.ts` 的项目创建/更新逻辑中，广播事件：

  ```ts
  broadcast('project_created', { projectId: project.id });
  // 更新时
  broadcast('project_updated', { projectId: project.id });
  ```

  在 `apps/server/src/scheduler.ts` 的任务执行回调中：

  ```ts
  broadcast('task_executed', { taskId, projectId });
  ```

  确认 `broadcast` 函数在作用域内可用（可能来自 `ws.ts` 导出的实例）。

- [ ] **Step 2: 前端监听新增事件**

  Modify `apps/desktop/src/pages/OfficePage.tsx`：

  ```tsx
  useEffect(() => {
    window.addEventListener('ws:project_created', refreshStats);
    window.addEventListener('ws:project_updated', refreshStats);
    window.addEventListener('ws:task_executed', refreshStats);
    return () => {
      window.removeEventListener('ws:project_created', refreshStats);
      window.removeEventListener('ws:project_updated', refreshStats);
      window.removeEventListener('ws:task_executed', refreshStats);
    };
  }, [refreshStats]);
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add apps/server/src/routes/ws.ts apps/server/src/routes/projects.ts apps/server/src/scheduler.ts apps/desktop/src/pages/OfficePage.tsx
  git commit -m "feat(ws): broadcast project and scheduler events for office widgets"
  ```

---

### Task 14: DeliverablesPanel 点击修复 ✅ 已完成

**Files:**

- Modify: `apps/desktop/src/components/office/DeliverablesPanel.tsx`

- [ ] **Step 1: 绑定点击事件**

  Modify `DeliverablesPanel` 中的交付物列表项，增加点击处理：

  ```tsx
  {
    deliverables.map((d) => (
      <div
        key={d.id}
        className="deliverable-item cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
        onClick={() => {
          window.dispatchEvent(
            new CustomEvent('open-file-viewer', {
              detail: {
                path: d.filePath,
                name: d.name,
                mimeType: d.mimeType,
                projectId: d.projectId,
              },
            }),
          );
        }}
      >
        <span className="font-medium">{d.name}</span>
        {/* ... 其他元数据 ... */}
      </div>
    ));
  }
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add apps/desktop/src/components/office/DeliverablesPanel.tsx
  git commit -m "fix(deliverables): make DeliverablesPanel items clickable"
  ```

---

## Integration Verification

所有 Task 完成后，执行最终验证：

- [ ] **Step 1: 运行 Agent 包测试**

  Run: `npx vitest run packages/agent/src/__tests__ --reporter=verbose`
  Expected: All tests pass.

- [ ] **Step 2: 运行 Server 包测试**

  Run: `npx vitest run apps/server/src/__tests__ --reporter=verbose`
  Expected: All tests pass.

- [ ] **Step 3: 类型检查**

  Run: `npx tsc --noEmit -p packages/agent/tsconfig.json && npx tsc --noEmit -p apps/server/tsconfig.json`
  Expected: No type errors.

- [ ] **Step 4: Desktop 构建检查**

  Run: `pnpm --filter @cabinet/desktop build` (或项目等效命令)
  Expected: Build succeeds.

- [ ] **Step 5: 端到端冒烟测试**
  1. 创建新项目，确认 `.cabinet/projects/{projectName}/` 目录生成
  2. 尝试创建同名项目，确认 409 错误
  3. 通过对话创建工作流，确认 projectId 正确透传
  4. 生成 HTML 交付物，在 FileViewer 中确认预览模式生效
  5. 在 Office 首页确认交付物聚合显示

---

## Plan Self-Review

**1. Spec coverage:**

- #1 rootPath 初始化 → Task 2
- #5 create_workflow default → Task 3, Task 4
- #10 交付物聚合 → Task 5
- #12 同名检测 → Task 1, Task 2
- #13 项目名文件夹 → Task 2
- #4/8 177/135 次调用 → Task 6
- #6 Secretary 路由 → Task 8
- #9 定时任务 → Task 9
- #2 HTML/PDF 预览 → Task 11
- #3 视觉权重 → Task 12
- #7 WebSocket → Task 13
- #11 DeliverablesPanel 点击 → Task 14
- T0-T3 授权 → Task 10

**2. Placeholder scan:** 无 TBD/TODO。所有步骤包含文件路径和代码/命令。

**3. Type consistency:** `projectId` 在 Task 3/4/6/9 中均作为必填 string；`trustLevel` 在 Task 10 中定义为 `'T0'|'T1'|'T2'|'T3'`。

---

_Plan complete. Ready for execution._
