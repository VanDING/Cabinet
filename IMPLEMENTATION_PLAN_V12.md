# Cabinet V12 Mastra 能力全量集成计划

> 目标：将 Mastra 框架未启用的高价值和中价值能力全部集成到 Cabinet。
> 原则：先质量体系 → 再流程增强 → 再生态对接 → 最后运维增强。

---

## 第一阶段：质量体系 — Structured Output + Evals

> 目标：建立 Agent 输出的可量化、可回归验证体系。

### 2.1 定义 Structured Output Schema

为每个 Agent 定义 Zod schema：

```typescript
// 示例：Secretary Agent
const secretaryOutputSchema = z.object({
  response: z.string(),
  actions: z.array(
    z.object({
      type: z.enum(['decision_created', 'task_scheduled', 'file_modified', 'delegated']),
      id: z.string(),
      summary: z.string(),
    }),
  ),
  confidence: z.number().min(0).max(1),
});

// 示例：Analyst Agent
const analystOutputSchema = z.object({
  findings: z.array(
    z.object({
      category: z.string(),
      detail: z.string(),
      severity: z.enum(['info', 'warning', 'critical']),
    }),
  ),
  recommendation: z.string(),
  codeReferences: z.array(z.string()).optional(),
});
```

### 2.2 配置 Agent structuredOutput

```typescript
// secretary.ts
export const secretaryAgent = new Agent({
  // ... existing config
  structuredOutput: {
    schema: secretaryOutputSchema,
  },
});
```

### 2.3 集成 Mastra Evals

#### 2.3.1 创建 Eval 数据集

创建 `apps/server/src/mastra/evals/datasets/`：

```
datasets/
  secretary-evals.json     → 30 组 Secretary 对话 + 期望输出
  analyst-evals.json       → 20 组代码分析场景
  writer-evals.json        → 15 组文档生成场景
  guardrail-evals.json     → 注入测试用例（PromptInjection/PII/Unicode）
```

每组包含：`{ input: string, expectedOutput?: string, expectedActions?: string[] }`

#### 2.3.2 注册预建 Scorers

```typescript
// mastra/evals/scorers.ts
import { prebuilt } from '@mastra/evals/scorers/prebuilt';

export const scorers = {
  helpfulness: prebuilt.HelpfulnessScorer,
  accuracy: prebuilt.AccuracyScorer,
  relevance: prebuilt.RelevanceScorer,
  toxicity: prebuilt.ToxicityScorer,
  completeness: prebuilt.CompletenessScorer,
  toolCallAccuracy: prebuilt.ToolCallAccuracyScorer,
};
```

#### 2.3.3 创建评估任务

```typescript
// mastra/evals/run.ts
export async function runSecretaryEvals() {
  const dataset = loadDataset('secretary-evals.json');
  const results = await runEvals(secretaryAgent, dataset, {
    scorers: [scorers.helpfulness, scorers.accuracy, scorers.relevance],
    model: 'deepseek/deepseek-chat',
  });
  return results; // { scores, failures, recommendations }
}
```

#### 2.3.4 创建 Trajectory 评分

验证 Agent 的工具调用路径是否正确：

```typescript
const trajectoryScorer = {
  expectedTools: ['queryKnowledgeGraph', 'search', 'readFile'],
  expectedOrder: true, // 必须按顺序
  allowExtraTools: true, // 允许额外工具调用
};
```

#### 2.3.5 CLI 命令

```bash
# 运行全部评估
pnpm evals:run

# 运行特定数据集
pnpm evals:run --dataset secretary

# 运行 guardrail 评估
pnpm evals:run --dataset guardrails

# 回归检查
pnpm evals:gate  # 失败时 CI 阻断
```

在 `package.json` 中添加 scripts。

### 2.4 Evals 路由

创建 `apps/server/src/routes/evals.ts` 路由：

- `POST /api/evals/run` — 运行评估
- `GET /api/evals/results` — 查询历史评估结果
- `GET /api/evals/datasets` — 列出数据集
- `POST /api/evals/gate` — CI gate 检查

### 验证

```
pnpm evals:run
pnpm typecheck
```

---

## 第二阶段：Workflow 高级控制流 — HITL + 并行/分支/循环

> 目标：让 Factory DAG 可视化编辑器的每个节点类型都有实际的 Mastra 执行能力。

### 3.1 实现 suspend/resume (Human-in-the-Loop)

#### 3.1.1 创建 Human Approval Step

```typescript
const humanApprovalStep = createStep({
  id: 'humanApproval',
  inputSchema: z.object({
    decisionTitle: z.string(),
    options: z.array(z.object({ id: z.string(), label: z.string() })),
    deadlineMinutes: z.number().optional(),
  }),
  execute: async ({ inputData, suspend }) => {
    // HumanNode — 创建 Decision 后挂起等待人工决策
    const decision = decisionService.create({
      id: `dec_${Date.now()}`,
      title: inputData.decisionTitle,
      options: inputData.options,
      classification: {
        involvesPermissions: true,
        fromExternalAgent: false,
        operationType: 'human_approval',
        ...
      },
    });

    // 广播到 WebSocket 通知 Desktop
    broadcast('workflow_awaiting_approval', {
      workflowId, runId, decisionId: decision.id
    });

    // 挂起等待
    const approval = await suspend(decision.id);

    return { decisionId: decision.id, approved: approval.approved };
  },
});
```

#### 3.1.2 创建 Resume 端点

```typescript
// routes/workflows.ts
POST /api/workflows/:runId/resume
  body: { decisionId, approved, chosenOptionId }

// 恢复挂起的工作流
mastra.resumeWorkflow(runId, { approved, chosenOptionId });
```

#### 3.1.3 集成到 Decision 框架

现有 `DecisionService` 的 callback 回调中，当 workflow approval decision 被批准时，自动调用 `mastra.resumeWorkflow()` 恢复执行。

### 3.2 实现并行执行

```typescript
const processFile = createStep({
  id: 'processFile',
  execute: async ({ inputData }) => {
    const { files } = inputData;
    const steps = files.map((file, i) => fileAnalysisStep.with({ filename: file.name, index: i }));
    return steps;
  },
}).parallel(); // ← 并行处理多个文件
```

### 3.3 实现条件分支

```typescript
const routeByLanguage = createStep({
  id: 'routeByLanguage',
  execute: async ({ inputData }) => {
    // 根据检测到的语言选择不同的分析步骤
    return inputData.language;
  },
}).branch([
  [(lang) => lang === 'python', pythonAnalysisStep],
  [(lang) => lang === 'typescript', typescriptAnalysisStep],
  [(lang) => lang === 'rust', rustAnalysisStep],
  [() => true, defaultAnalysisStep], // fallback
]);
```

### 3.4 实现循环 (dowhile)

```typescript
const retryOnFailure = createStep({
  id: 'retryOnFailure',
  execute: async ({ inputData }) => {
    return inputData;
  },
}).dowhile((output) => {
  return output.status === 'failed' && output.retryCount < 3;
});
```

### 3.5 更新 Factory 前端

> Desktop 的 Factory 可视化编辑器 (`apps/desktop/src/factory/`) 已有 18 个节点类型（ParallelNode、BranchNode、LoopNode、HumanNode 等）。现在后端有能力执行后：

- `ParallelNode` → 输出 `step.parallel()` Mastra 定义
- `BranchNode` → 输出 `step.branch(conditions)` Mastra 定义
- `LoopNode` → 输出 `step.dowhile() / .dountil()` Mastra 定义
- `HumanNode` → 输出 `humanApprovalStep` 挂起型 step
- 更新 `factory/converter.ts` 的导出格式适配

### 验证

```
pnpm typecheck
# 创建含 HumanNode / Parallel / Branch 的 workflow → 运行
```

---

## 第三阶段：中价值能力集成

> 按价值从高到低依次集成。

### 3.1 Agent Signals（事件驱动 Agent 触发）

```
场景：当 Decision 被创建时，自动触发 Analyst Agent 分析
场景：每日定时触发 Curator Agent 清理记忆
场景：Webhook 触发 Secretary Agent 处理外部事件
```

```typescript
// mastra/signals.ts
import { createSignal } from '@mastra/core/signals';

export const decisionCreatedSignal = createSignal({
  id: 'decision.created',
  description: 'Trigger agent when a new decision is created',
  agentId: 'secretary',
  filter: (event) => event.type === 'decision_created',
});
```

在 `decisions.ts` 路由中，`broadcast('decision_created', ...)` 时同步触发 Signal。

### 3.2 Background Tasks（后台任务）

```
场景：Agent 调用的长时间工具（如 LLM 分析大文件）在后台执行
场景：工作流中的重 I/O 步骤不阻塞后续步骤
```

```typescript
// 创建支持后台执行的工具
const longRunningTool = createTool({
  id: 'analyzeLargeCodebase',
  execute: async ({ path }) => {
    // 返回 backgroundTask 让 Mastra 异步执行
    return backgroundTask(async () => {
      const results = await analyzeCodebase(path);
      return { summary: results };
    });
  },
});
```

### 3.3 Mastra Studio（可视化调试）

```
场景：开发时可视化观察 Agent 执行流程
场景：Trace 查看每次调用的完整工具链
场景：Memory 查看观察记忆和工作记忆内容
```

```typescript
// mastra/index.ts - 添加 Studio 配置
export const mastra = new Mastra({
  // ... existing config
  studio: {
    enabled: true,
    port: 3001,
    auth: {
      provider: 'simple',
      apiKeys: [process.env.STUDIO_API_KEY],
    },
  },
});
```

### 3.4 Mastra Auth（统一认证）

```
场景：替换当前 Hono authMiddleware + MASTER_PW 方案
场景：API Key 管理、RBAC、限流集成
```

```typescript
// mastra/auth.ts
import { SimpleAuth } from '@mastra/core/auth';

const auth = new SimpleAuth({
  apiKeys: async () => {
    const { apiKeyRepo } = getServerContext();
    return apiKeyRepo.findAll().map((k) => ({
      key: k.key_hash,
      name: k.name,
      permissions: k.permissions,
    }));
  },
});

// main.ts
mastra.configure({ auth });
mastraServer.registerAuthMiddleware();
```

### 3.5 Agent Browser（原生浏览器自动化）

```
场景：替代当前 Playwright MCP，减少外部依赖
场景：Agent 需要截图/操作网页时自动获取 Browser 工具
```

```typescript
// mastra/index.ts
secretaryAgent.setBrowser(
  new MastraBrowser({
    headless: true,
    viewport: { width: 1280, height: 720 },
  }),
);
```

---

## 第四阶段：验证与文档

### 6.1 全量验证

```
pnpm build
pnpm typecheck
pnpm lint
pnpm lint:arch
pnpm evals:run
pnpm -r test
```

### 6.2 更新 README

新增"已启用的 Mastra 能力"章节，列出所有已集成的特性。

### 6.3 删除旧 plan 文档

删除 `IMPLEMENTATION_PLAN_V9.md` 和 `IMPLEMENTATION_PLAN_V10.md`（已完成），保留 V11 作为切换记录，V12 为当前计划。

---

## 阶段概览

| 阶段     | 内容                                                           | 预计行数  |
| -------- | -------------------------------------------------------------- | --------- |
| 一       | Structured Output + Evals（Schema 定义 + 5 数据集 + CLI gate） | +600      |
| 二       | Workflow HITL + 并行/分支/循环 + Factory 适配                  | +500      |
| 三       | Signals + Background Tasks + Studio + Auth + Browser           | +500      |
| 四       | 验证与文档                                                     | +100      |
| **合计** |                                                                | **+1700** |
