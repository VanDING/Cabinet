# Cabinet 测试问题修复设计文档

> **日期**: 2026-05-25  
> **范围**: 项目数据层、Agent 执行层、UI/交互层  
> **实施策略**: Phase 1（数据层）→ Phase 2（执行层）→ Phase 3（UI 层），顺序推进

---

## 目录

1. [背景与问题汇总](#1-背景与问题汇总)
2. [Phase 1：项目数据层](#2-phase-1-项目数据层)
3. [Phase 2：Agent 执行层](#3-phase-2-agent-执行层)
4. [Phase 3：UI/交互层](#4-phase-3-ui交互层)
5. [实施顺序与依赖](#5-实施顺序与依赖)
6. [风险评估](#6-风险评估)

---

## 1. 背景与问题汇总

本次设计覆盖 9 项测试发现的问题及 2 项补充问题：

| 编号 | 问题                                             | 根因归类 | 解决 Phase |
| ---- | ------------------------------------------------ | -------- | ---------- |
| #1   | 新建项目 `rootPath` 为空，缺少物理文件夹         | 数据层   | Phase 1    |
| #5   | `create_workflow` 固定使用 `projectId='default'` | 数据层   | Phase 1    |
| #10  | 交付物只在项目页显示，Office 首页为空            | 数据层   | Phase 1    |
| #12  | 系统缺失同名项目检测                             | 数据层   | Phase 1    |
| #13  | 项目存储应以项目名命名文件夹                     | 数据层   | Phase 1    |
| #4   | Workflow Designer 调用 177 个工具                | 执行层   | Phase 2    |
| #6   | Secretary 路由绕弯，调用 decisionanalysis        | 执行层   | Phase 2    |
| #8   | Organize 调用 135 个工具                         | 执行层   | Phase 2    |
| #9   | Agent 无法设置定时任务                           | 执行层   | Phase 2    |
| #2   | 无法预览 HTML/PDF 交付物                         | UI 层    | Phase 3    |
| #3   | 路由折叠窗口工具调用挤占思考内容                 | UI 层    | Phase 3    |
| #7   | Office 首页小组件缺少 WebSocket 推送             | UI 层    | Phase 3    |
| #11  | DeliverablesPanel 无法点击                       | UI 层    | Phase 3    |

---

## 2. Phase 1：项目数据层

### 2.1 项目目录结构（解决 #1, #13）

**现状**：`.cabinet/projects/` 下只有 `{projectId}.json` 索引文件，`rootPath` 默认为空字符串。

**目标**：创建项目时自动初始化物理工作目录。

**目录结构**：

```
~/.cabinet/projects/
├── MyProject/                       ← 项目物理根目录（rootPath）
│   ├── .cabinet/                    ← 项目级配置
│   │   ├── rules/
│   │   ├── skills/
│   │   └── mcp/
│   ├── deliverables/                ← 交付物存储目录
│   └── project.json                 ← 元数据冗余备份
├── AnotherProject/
│   └── ...
```

**关键约束**：

- 全局索引文件 `.cabinet/projects/{projectId}.json` **继续保留**，不影响现有读取逻辑
- `Project.rootPath` 在创建时自动设置为 `join(CABINET_DIR, 'projects', projectName)`
- 项目名称作为文件夹名，**不随项目重命名而变更**（避免路径断裂）
- **现有交付物不迁移**，仅新交付物存入新项目目录下的 `deliverables/`
- **删除项目后再创建同名项目**：复用原有文件夹，但创建前清理文件夹内旧数据（保留 `.cabinet/` 配置子目录）

### 2.2 项目名称唯一性检测（解决 #12）

在 `POST /api/projects` 中增加前置检查：

```ts
const existing = await projectRepo.findByName(d.name);
if (existing) {
  return res.status(409).json({ error: 'Project name already exists' });
}
```

- 数据库层：`projects.name` 增加 `UNIQUE` 约束（需要迁移文件）
- 应用层：创建前显式检查，返回 409 冲突
- UI 层：创建表单实时校验

### 2.3 `create_workflow` projectId 透传（解决 #5）

**修复点**：

1. **工具层**（`packages/agent/src/tools/index.ts`）：移除 `?? 'default'`，`projectId` 改为必填参数
2. **服务端路由**（`apps/server/src/routes/workflows.ts`）：从请求上下文中提取当前 `projectId`，若无法确定返回 400 错误，不再 fallback
3. **调用链路**：Secretary / Organize / Workflow Designer 调用 `create_workflow` 时必须显式传入 `projectId`

### 2.4 交付物聚合查询（解决 #10）

调整 API 端点：

- `GET /api/deliverables`（Office 首页）：**不加** `projectId` 过滤，返回所有项目交付物，按时间倒序
- `GET /api/projects/:id/deliverables`（Project Dashboard）：**加** `projectId` 过滤，只返回当前项目

前端对应调整：

- Office 首页 `Deliverables` 调用 `/api/deliverables`
- Project Dashboard `Deliverables` 调用 `/api/projects/${pid}/deliverables`

---

## 3. Phase 2：Agent 执行层

### 3.1 ContextBuilder 请求级缓存（解决 #4, #8）

**根因**：每个 AgentLoop 启动时，`ContextBuilder.build()` 都会重新触发 `RulesLoader.loadMatching()` 和 `ProjectSnapshot.capture()`，导致 Secretary → Specialist → Reviewer 链路中同一项目的上下文被重复采集。

**方案**：在 `ContextBuilder` 内部实现请求级缓存（TTL 5 秒），以 `projectId` 为 key。

```ts
private contextCache = new Map<string, {
  snapshot: Snapshot;
  rules: LoadedRule[];
  timestamp: number;
}>();
private readonly CONTEXT_CACHE_TTL_MS = 5_000;
```

**缓存逻辑**：

```ts
const cacheKey = options.projectId;
const cached = this.contextCache.get(cacheKey);
const now = Date.now();

if (cached && now - cached.timestamp < this.CONTEXT_CACHE_TTL_MS) {
  snapshot = cached.snapshot;
  rules = cached.rules;
} else {
  snapshot = ProjectSnapshot.capture(projectRoot);
  rules = this.rulesLoader?.loadMatching(rulesContext) ?? [];
  this.contextCache.set(cacheKey, { snapshot, rules, timestamp: now });
}
```

**失效策略**：

- `clearSessionCache()` 中清除对应 `projectId` 的缓存条目
- 超过 5 秒 TTL 自动失效
- 缓存未命中时回退到原有自采集逻辑

### 3.2 `prebuiltContext` 可选透传（有限透传方案）

在 `AgentLoopOptions` 中增加可选字段：

```ts
interface AgentLoopOptions {
  prebuiltContext?: {
    snapshot: Snapshot;
    rulesSummary: string;
    projectContext: string;
  };
}
```

**使用策略**：

- 正常路径（Secretary → Specialist）：不传递，依赖 3.1 的缓存自动复用
- 严格一致性场景（如决策事务）：由调用方显式传递，ContextBuilder 完全跳过自采集

```ts
build(options: BuildOptions): Promise<ContextBuildResult> {
  if (options.prebuiltContext) {
    return this.buildFromPrebuilt(options.prebuiltContext, options);
  }
  return this.buildFromScratch(options);
}
```

### 3.3 Secretary 路由优化（解决 #6）

**根因**：当前 Secretary 将路由判断外包给 `decisionanalysis`，导致链路冗长（user → secretary → decisionanalysis → confirm → organize）。

**修正**：路由是 Secretary 的核心职责，`decisionanalysis` 只用于决策分析（方案对比、可行性评估），绝不参与 Agent 分派。

**Secretary 路由逻辑**：

```ts
async handleMessage(msg: string, context: MessageContext): Promise<RouteResult> {
  // 1. 短路由：无歧义的操作类指令
  const directIntent = this.recognizeDirectIntent(msg);
  if (directIntent.confidence > 0.9) {
    return {
      targetAgent: directIntent.target,
      confidence: directIntent.confidence,
      skipUserConfirm: true,
    };
  }

  // 2. Secretary 自己分析复杂任务（不调用 decisionanalysis）
  const analysis = await this.analyzeTaskComplexity(msg, context);
  return {
    targetAgent: analysis.suggestedAgent,
    confidence: analysis.confidence,
    reasoning: analysis.reasoning,
    skipUserConfirm: analysis.confidence > 0.8,
  };
}
```

**短路由规则**（仅覆盖无歧义的操作类指令）：

| 用户指令                | Secretary 行为                                                             |
| ----------------------- | -------------------------------------------------------------------------- |
| "设置每天8点运行工作流" | 直接调用 `schedule_task`                                                   |
| "取消所有定时任务"      | 直接调用 `cancel_scheduled_task`                                           |
| "列出我的工作流"        | 直接查询后回复                                                             |
| "帮我设计 workflow"     | Secretary 自己分析，判断 `workflow_designer` 或 `organize`，必要时询问用户 |

**decisionanalysis 的正确定位**：仅在用户明确要求分析时使用（如"帮我分析这两个方案的优劣"）。

### 3.4 Scheduler 能力默认启用（解决 #9）

**修复点**：

1. **默认注入**：在 `apps/server/src/routes/workflows.ts` 中移除 `caps.scheduler` 门控：

   ```ts
   // 修改前
   scheduleTask: caps.scheduler ? shared.scheduleTask : stub('Scheduler');
   // 修改后
   scheduleTask: shared.scheduleTask;
   ```

2. **系统记忆补充**：在系统记忆库（`system self-knowledge memory`）中补充 scheduler 工具能力描述，由 `ContextBuilder` 自动注入，不在 Agent prompt 中硬编码。

3. **projectId 透传联动**：`schedule_task` 的 `projectId` 参数从当前会话上下文正确透传（与 2.3 联动）。

### 3.5 用户授权级别（T0-T3）

**目标**：替代硬编码的角色信任级别，改为用户可调的授权阀门。

**级别定义**：

| 级别            | 连续错误中止 | 系统探测工具上限 | 场景                     |
| --------------- | ------------ | ---------------- | ------------------------ |
| **T0** 保守     | 2 次         | 3 次             | 用户明确说"谨慎处理"     |
| **T1** 标准     | 3 次         | 5 次             | 默认级别                 |
| **T2** 宽松     | 5 次         | 10 次            | 用户说"你可以多尝试几次" |
| **T3** 完全信任 | 10 次        | 无上限           | 调试模式                 |

**调整方式**：

- **全局设置**：用户在设置面板中选择默认级别（默认 T1）
- **对话内临时调整**：用户通过自然语言指令调整（如"这次允许你多试几次" → 临时提升到 T2）
- **不按任务提供 UI 选择**：不在发起工作流前弹窗打扰用户

**实现**：`AgentLoop` 启动时读取当前生效的授权级别，应用到错误阈值和工具上限。

---

## 4. Phase 3：UI/交互层

### 4.1 FileViewer 增强：WebView 预览（解决 #2）

**现状**：`FileViewer` 对所有非图片文件一律用 `<pre>` 显示，HTML/PDF 只能看到源码。

**方案**：增强现有 `FileViewer`，使其支持多模式渲染，而非新增独立面板。

**渲染策略**：

| 文件类型        | 默认视图 | 可切换       | 渲染方式                                       |
| --------------- | -------- | ------------ | ---------------------------------------------- |
| `.html`, `.htm` | **预览** | 可切源码     | `iframe` + Blob URL，`sandbox="allow-scripts"` |
| `.pdf`          | **预览** | 不可切       | `iframe` + Blob URL，浏览器内置阅读器          |
| 图片            | **预览** | 不可切       | 现有 `<img>`                                   |
| `.md`           | 源码     | 二期可接渲染 | 现有 `<pre>`                                   |
| 代码/文本       | 源码     | 不可切       | 现有 `<pre>`                                   |

**安全隔离**：

- `sandbox="allow-scripts allow-same-origin"`
- 禁用 `allow-top-navigation allow-popups allow-forms`
- Blob URL 隔离本地文件系统路径

**拖拽调整宽度**：

- 在面板左边缘增加 4px 拖拽手柄
- 最小 320px，最大 70vw
- 用户偏好存入 `localStorage`

**触发方式统一**：所有文件打开统一走 `open-file-viewer` 事件，FileViewer 内部根据文件类型自动选择初始视图：

- Explorer 点击 → FileViewer
- Deliverables / DeliverablesPanel 点击 → FileViewer
- Chat 消息中的文件路径（自动检测为可点击链接）→ FileViewer

### 4.2 消息流视觉权重优化（解决 #3）

**现状**：`ToolCallSummary` 在消息流中展开后占满可视区域，思考内容（`thinking`）被挤到下方或不可见。

**优化方案**：

1. **Thinking 内容上提**：将 `thinking` 块从消息底部移至**工具调用摘要上方**，确保用户首先看到 Agent 的推理过程
2. **ToolCallSummary 默认折叠**：完成后的工具调用摘要默认折叠为单行（`▶ 3 tools executed`），点击展开查看详情
3. **运行时工具调用紧凑化**：流式过程中，正在执行的工具以 inline pill 形式展示（已有行为），但限制最多同时显示 3 个，其余折叠为 `+N more`
4. **视觉层级**：Thinking 块使用更醒目的边框或背景色，与工具调用列表区分

### 4.3 WebSocket 事件补全（解决 #7）

**现状**：Office 首页小组件依赖 `ws:*` 事件刷新，但部分业务操作未广播对应事件。

**补全方案**：在以下业务操作中增加 WebSocket 广播：

| 业务操作     | 当前是否广播                  | 需要广播的事件            |
| ------------ | ----------------------------- | ------------------------- |
| 交付物创建   | 是 (`ws:deliverable_created`) | —                         |
| 工作流完成   | 是 (`ws:workflow_completed`)  | —                         |
| 会议创建     | 是 (`ws:meeting_created`)     | —                         |
| 决策创建     | 是 (`ws:decision_created`)    | —                         |
| 成本更新     | 是 (`ws:cost_updated`)        | —                         |
| 项目创建     | **否**                        | 新增 `ws:project_created` |
| 项目状态变更 | **否**                        | 新增 `ws:project_updated` |
| 定时任务触发 | **否**                        | 新增 `ws:task_executed`   |

**兜底策略**：若 WebSocket 连接断开或事件遗漏，Office 首页保留现有的**定时轮询**（每 60 秒刷新一次 `/api/dashboard/summary`），确保数据最终一致。

### 4.4 DeliverablesPanel 点击修复（解决 #11）

**现状**：`DeliverablesPanel` 中的交付物项不可点击。

**修复**：为 `DeliverablesPanel` 中的每个交付物项绑定 `onClick` 事件，触发 `open-file-viewer` 事件（与 `Deliverables` 组件行为统一）。

同时调整 Deliverables 数据流：

- Office 首页 `Deliverables` 调用 `/api/deliverables`（全局聚合）
- Project Dashboard `Deliverables` 调用 `/api/projects/${pid}/deliverables`（项目过滤）

---

## 5. 实施顺序与依赖

```
Phase 1: 项目数据层
├── 项目目录初始化
├── 同名检测 + 唯一约束
├── create_workflow projectId 透传
└── 交付物聚合 API 调整
    │
    ▼
Phase 2: Agent 执行层
├── ContextBuilder 请求级缓存
├── prebuiltContext 可选透传
├── Secretary 路由优化（移除 decisionanalysis 依赖）
├── Scheduler 默认启用
└── 用户授权级别 T0-T3
    │
    ▼
Phase 3: UI/交互层
├── FileViewer 增强（iframe 预览 + 拖拽宽度）
├── 消息流视觉权重调整
├── WebSocket 事件补全
└── DeliverablesPanel 点击修复
```

**关键依赖**：

- Phase 2 的 ContextBuilder 缓存 key 依赖正确的 `projectId`，因此必须在 Phase 1 的 `create_workflow` 透传修复之后实施
- Phase 3 的 Deliverables 数据流依赖 Phase 1 的聚合 API 调整

---

## 6. 风险评估

| 风险                                    | 影响    | 缓解措施                                                               |
| --------------------------------------- | ------- | ---------------------------------------------------------------------- |
| 项目文件夹命名与现有 `.json` 索引冲突   | Phase 1 | 保留现有索引文件，新增文件夹并行存储，互不干扰                         |
| ContextBuilder 缓存导致文件变更延迟感知 | Phase 2 | TTL 仅 5 秒，且提供 `clearSessionCache()` 手动清除                     |
| Secretary 短路由误判复杂任务            | Phase 2 | 仅对无歧义的操作类指令启用短路由，设计/创建类一律由 Secretary 自己分析 |
| iframe 预览 HTML 存在 XSS 风险          | Phase 3 | `sandbox` 限制 + 禁用顶层导航 + Blob URL 隔离                          |
| FileViewer 拖拽宽度与现有布局冲突       | Phase 3 | 使用 flex 布局，拖拽仅改变 FileViewer 的 `style.width`，不影响其他区域 |

---

_文档版本: v1.0_  
_待用户审阅确认后，进入 implementation plan 阶段。_
