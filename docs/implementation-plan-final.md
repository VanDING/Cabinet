# CabinetV2.0 彻底修复 — 最终实施计划

> 版本：FINAL（经两轮严格校验 + 9+4 项修正后定稿）
> 原则：优先使用 Mastra SDK 成熟能力，不保留自写旧代码
> 粒度：原子级（每子任务 = 单一文件 × 单一修改点）

---

## 执行摘要

基于三份审计报告 (2026-06-23 / 06-24 / 06-26) 的全面源码校验，共识别 42 项修复，按系统层分解为 8 个批次。06-26 审计 7 项已全修复；06-24 审计 15 项全未落地；06-23 死代码清理 88% 完成。

核心阻断问题（本计划最优先修复）：

- `main.ts:33` — API Key 小写注入 → Mastra 找不到 key → 对话无反应
- `secretary.ts:45` — 用户选择的 model 被硬编码忽略 → 模型选择功能无效

---

# 批次 0：基础设施预检

## 0.1 CABINET_DIR 路径三处统一

### 0.1.1 `packages/storage/src/paths.ts:6` — 支持 CABINET_HOME

```ts
// 当前
export const CABINET_DIR = join(homedir(), '.cabinet');

// 目标
export const CABINET_DIR =
  process.env.CABINET_HOME?.trim() || undefined
    ? join(process.env.CABINET_HOME!.trim())
    : join(homedir(), '.cabinet');
```

### 0.1.2 `apps/server/src/config.ts:33` + `:9` — import 统一 CABINET_DIR

```ts
// 当前 (line 33)
const CABINET_DIR = join(homedir(), '.cabinet');
const MASTER_KEY_FILE = join(CABINET_DIR, '.master_key');

// 目标
import { CABINET_DIR } from '@cabinet/storage';
const MASTER_KEY_FILE = join(CABINET_DIR, '.master_key');
```

```ts
// 当前 (line 9, loadEnvFile)
const paths = [join(homedir(), '.cabinet', '.env'), join(process.cwd(), '.env')];

// 目标
const paths = [join(CABINET_DIR, '.env'), join(process.cwd(), '.env')];
```

### 0.1.3 `apps/server/src/mastra/index.ts:15` — import 统一路径

```ts
// 当前
const CABINET_DATA = join(homedir(), '.cabinet');

// 目标
import { CABINET_DIR } from '@cabinet/storage';
const CABINET_DATA = CABINET_DIR;
```

**验证**: `CABINET_HOME=/tmp/test-cabinet pnpm dev:server` → 所有数据写入 `/tmp/test-cabinet/`。

---

# 批次 1：Execution（环境接触层）

## 1.1 `main.ts:33` — API Key 大小写修复 【P0 阻断】

```ts
// 当前
process.env[`${k.provider}_API_KEY`] = decrypted;
// → deepseek_API_KEY (小写)

// 目标
process.env[`${k.provider.toUpperCase()}_API_KEY`] = decrypted;
// → DEEPSEEK_API_KEY (大写 — Mastra SDK 约定)
```

**验证**: 启动后 `process.env.DEEPSEEK_API_KEY` 有值，发消息 LLM 正常响应。

## 1.2 `secretary.ts:45` — 用户模型选择生效 【P0 阻断】

```ts
// 当前
model: resolveModel('default'),   // ← 忽略请求体中的 model 字段

// 目标
model: model ?? resolveModel('default'),
```

**验证**: ChatPanel 选 `deepseek/deepseek-v4-pro` → 请求体含此 model → agent.stream 使用它。

## 1.3 `main.ts` (line 41 后) — 启动时 API Key 校验 【依赖 1.1】

```ts
// 在 "} catch (err) { ctx.logger.warn('Failed to load API keys', ...); }" 之后插入:

const MASTRA_PROVIDERS = [
  'DEEPSEEK',
  'OPENAI',
  'ANTHROPIC',
  'GOOGLE',
  'QWEN',
  'MOONSHOT',
  'ZHIPU',
  'BAICHUAN',
];
const availableProviders = MASTRA_PROVIDERS.filter((p) => process.env[`${p}_API_KEY`]);
if (availableProviders.length === 0) {
  ctx.logger.warn('No API keys configured. Add keys in Settings → API Keys.');
} else {
  ctx.logger.info(`API keys available for: ${availableProviders.join(', ')}`);
  process.env.CABINET_PRIMARY_PROVIDER = availableProviders[0]!.toLowerCase();
}
```

**验证**: 无 key → 警告日志。key 存在 → `CABINET_PRIMARY_PROVIDER` 已设。

## 1.4 SSE 编码 — 抽取为共享工具

### 1.4.1 新建 `apps/server/src/mastra/sse-encoder.ts`

从 `secretary.ts` 抽取 100 行手动 SSE chunk 编码为独立的 `createSSEStream()` + `encodeSSEChunk()` 函数。

### 1.4.2 简化 `secretary.ts:43-141`

```ts
import { createSSEStream } from '../mastra/sse-encoder.js';

// 替换约 100 行手动编码为:
const stream = createSSEStream(result.fullStream.getReader(), (text) => {
  sessionManager.addMessage(sessionId, 'assistant', text);
});
return c.newResponse(stream);
```

**SDK 优先理由**: `agent.stream()` 已是 Mastra SDK 调用，仅抽取后续编码为可复用工具。

**验证**: 所有 SSE 事件类型（text/thinking/tool_status/done/error）前端正常解析。

## 1.5 `mastra/workspace.ts:5,8` — 相对路径改绝对路径 【依赖 0.1】

```ts
import { CABINET_DIR } from '@cabinet/storage';
const WORKSPACE_PATH = join(CABINET_DIR, 'workspace');
if (!existsSync(WORKSPACE_PATH)) mkdirSync(WORKSPACE_PATH, { recursive: true });

// 替换 '.' 为 WORKSPACE_PATH
filesystem: new LocalFilesystem({ basePath: WORKSPACE_PATH }),
sandbox: new LocalSandbox({ workingDirectory: WORKSPACE_PATH }),
```

**验证**: Tauri 打包后文件操作在 `~/.cabinet/workspace/` 执行。

## 1.6 `routes/insights.ts:11-30` — 修复幻影表查询

**问题**: `SELECT ... FROM entity_memory` 查的是从未创建的幻影表，被 try/catch 吞没。
**解决**: 改为从 Mastra Observability storage 读取数据（若 API 不可用则返回空数组 stub）。

**验证**: `GET /api/insights` 不报错，前端 InsightsWidget 正常渲染。

## 1.7 `routes/settings/api-keys.ts:53-60` — 扩展测试模型映射

```ts
// 当前：只有 anthropic/google/deepseek 三个分支
// 目标：
const TEST_MODELS: Record<string, string> = {
  anthropic: 'claude-haiku-4-5',  google: 'gemini-2.0-flash',
  deepseek: 'deepseek-chat',      openai: 'gpt-4o-mini',
  qwen: 'qwen-turbo',             moonshot: 'moonshot-v1-8k',
  zhipu: 'glm-4-flash',           baichuan: 'baichuan3-turbo',
};
model: TEST_MODELS[provider] ?? 'default',
```

**验证**: 模型弃用后 key 验证不误报。

---

# 批次 2：Coordination（协调层）

## 2.1 `routes/agents.ts:247-272` — 删除 503 桩

删除 `POST /message` + `POST /message/stream` 两个 503 桩路由。Mastra 已注册对应 A2A 端点（若未注册则 404 比误导性 503 更准确）。

**验证**: 删除后 Mastra 的 `/api/agents/:agentId/generate` 等路由不受影响。

## 2.2 `routes/memory.ts` — 保留路由 + 补充 layers 字段

**修正原因**: 前端 `fetchMemories` 期望 `{ entries, layers, total }` 格式，Mastra 原生格式不兼容。当前 wrapper 已使用 Mastra Memory 底层（`mastraMemory.listThreads()`），架构上满足 SDK 优先。

```ts
// 在 memoryRouter.get('/') 的返回中添加 layers 字段:
return c.json({
  entries: list.map(...),
  layers: { thread: list.length },  // ← 新增
  total: list.length,
});
```

**验证**: MemoryPage 正确显示 layer 统计。

## 2.3 Session — 移除重复消息存储 【关键架构修正】

### 2.3.1-2.3.2 删除重复 `addMessage` 调用

```ts
// secretary.ts:35 — 删除:
sessionManager.addMessage(sessionId, 'user', message);

// secretary.ts:131 — 删除:
sessionManager.addMessage(sessionId, 'assistant', text);
```

Mastra Memory 通过 `agent.stream()` + `memory.thread` 自动持久化所有消息。SessionManager 的 `create/get/close/getChildSessions/taskSessionMapping/contextSlot/events/deliverable` 等功能**完全保留**。

### 2.3.3 `GET /context` 改为从 Mastra 读取

```ts
// 改为从 Mastra Memory 读 thread messages
const memory = (mastra as any)?.memory;
const thread = memory ? await memory.getThreadById?.(sessionId) : null;
// 若 Mastra 不可用，回退到 sessionManager.messages
const source = thread?.messages ?? sessionManager.get(sessionId)?.messages ?? [];
```

**验证**: 服务重启后通过 sessionId 可恢复对话历史；Context 按钮正常显示摘要。

## 2.4 `openapi.ts` — 删除，Mastra 自动生成独占

- 删除 `index.ts:41` import + `:137` route 挂载
- 删除 `apps/server/src/openapi.ts` 文件
- Mastra 自动生成的完整 OpenAPI 规范独占 `/api/openapi.json`

**验证**: `GET /api/openapi.json` 返回含全部 agent/workflow/memory 端点的完整规范。

## 2.5 lintStep 重复 — 抽取共享模块

**新建**: `mastra/workflows/shared/lint-step.ts`

**修改**: `code-review.ts:6-32` + `parallel-example.ts:5-21` → 删除本地定义，import 共享版本。

**验证**: 两个 workflow 的 lint step 行为一致。

---

# 批次 3：Control/Audit（控制审计层）

## 3.1 Port 统一 — 11 处硬编码消除

| #   | 文件                    | 修改                                                                            |
| --- | ----------------------- | ------------------------------------------------------------------------------- |
| 1   | `config.ts:63`          | 保持不变（已是环境变量权威来源）                                                |
| 2   | `openapi.ts:14`         | 随 2.4 整文件删除                                                               |
| 3-4 | `Dockerfile:44-45`      | `ARG PORT=3000` / `ENV PORT=$PORT` / `EXPOSE $PORT`                             |
| 5-6 | `vite.config.ts:12-13`  | `` `http://localhost:${process.env.PORT ?? 3000}` ``                            |
| 7   | `api.ts:15`             | `` `http://localhost:${(globalThis as any).__CABINET_PORT__ ?? 3000}${path}` `` |
| 8-9 | `useWebSocket.ts:21-22` | 同上换成变量 `${port}`                                                          |
| 10  | `tauri.conf.json:33`    | Tauri CSP — 最小改动：保持 3000 不变，添加注释说明                              |
| 11  | `.env.example:2`        | 保持不变                                                                        |

**端口注入方案**: Tauri 后端启动服务后，配置 `index.html` 中注入 `<script>window.__CABINET_PORT__ = 3000;</script>`。在 copy-server.mjs 中读取 PORT 并替换 html 中的注入点。

**验证**: `PORT=3001 pnpm dev:server` → 前端自动连接 3001。

## 3.2 `routes/files.ts:8` — process.cwd() 消除 【依赖 0.1】

```ts
// 当前
const PROJECT_ROOT = join(process.cwd(), '..', '..', '..');

// 目标 (environment var with import.meta fallback)
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const INFERRED_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const PROJECT_ROOT = process.env.CABINET_PROJECT_ROOT ?? INFERRED_ROOT;
```

**验证**: `CABINET_PROJECT_ROOT=/some/project` 启动，文件操作正确。

## 3.3 CABINET_DIR 统一 — 已在 0.1 完成

## 3.4 `mastra/evals/scorers.ts:9` — Provider 大小写

```ts
// 当前
const evalModel = { provider: 'DEEPSEEK', ... };

// 目标
const evalModel = { provider: 'deepseek', ... };
```

> 注：需确认 `@mastra/evals` 对 provider 的大小写预期。若框架内部期望大写则保留。

**验证**: evals 运行时不因大小写导致 provider 匹配失败。

## 3.5 `copy-server.mjs:157` — thread-stream 版本动态化

```ts
// 当前
const tsDir = join(pnpmStore, 'thread-stream@4.2.0', 'node_modules', 'thread-stream');

// 目标 (方案: 从 node_modules 直接解析)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const tsDir = join(require.resolve('thread-stream'), '..');
```

**验证**: 升级 thread-stream 后 copy-server 不中断。

---

# 批次 4：Intelligence（智能适应层）

## 4.1 `mastra/model-config.ts` 重构 【依赖 1.3】

### 4.1.1 删除死代码 (`:57-62`)

删除 `resolveModelForAgent()` 函数（零引用）。

### 4.1.2 `detectProviderFromSettings()` → `detectPrimaryProvider()`

```ts
// 当前：读 settings.json.providers (与 api_keys 表不连通)
function detectProviderFromSettings(): string | null { ... }

// 目标：主路径读 CABINET_PRIMARY_PROVIDER (main.ts 1.3 设置),
//      回退读环境变量大写 API key
function detectPrimaryProvider(): string | null {
  const primary = process.env.CABINET_PRIMARY_PROVIDER;
  if (primary) return primary;
  const providers = ['deepseek','openai','anthropic','google',
    'qwen','moonshot','zhipu','baichuan'];
  return providers.find(p => process.env[`${p.toUpperCase()}_API_KEY`]) ?? null;
}
```

**时序说明**: 模块导入时 `CABINET_PRIMARY_PROVIDER` 未设 → 回退读 `.env` 中的 `*_API_KEY`。运行时 `agent.stream()` 显式传 model 参数覆盖 agent 自身的 fallback model，无功能影响。

### 4.1.3 扩展 `defaultModelForProvider()` 覆盖 10 个 provider

```ts
const models: Record<string, string> = {
  deepseek: 'deepseek/deepseek-chat',
  openai: 'openai/gpt-4o',
  anthropic: 'anthropic/claude-sonnet-4-6',
  google: 'google/gemini-2.0-flash',
  qwen: 'qwen/qwen-plus',
  moonshot: 'moonshot/moonshot-v1-32k',
  zhipu: 'zhipu/glm-4-flash',
  baichuan: 'baichuan/baichuan4',
  openrouter: 'openrouter/anthropic/claude-sonnet-4',
};
```

### 4.1.4 `resolveModel()` 调用 `detectPrimaryProvider()`

```ts
const provider = detectPrimaryProvider(); // 替代 detectProviderFromSettings()
```

**验证**: 仅配 deepseek key → default 模型为 deepseek-chat；加 openai key → 切换到 gpt-4o。

---

# 批次 5：Policy（策略约束层）

## 5.1 CABINET_SECRET 标准化

- `config.ts` envSchema 添加 `CABINET_SECRET: z.string().optional()`，config 导出添加 `cabinetSecret`
- `.env.example` 添加 `# CABINET_SECRET=your-random-secret-here`
- `external-agent.ts:46,63` 改为 `import { config } from '../config.js'; config.cabinetSecret`

**验证**: 设 `CABINET_SECRET=test` → `config.cabinetSecret === 'test'`。

## 5.2 配置一致性 — 已在 4.1 解决

---

# 批次 6：死代码 & 冗余清除

| 操作     | 文件                                                             | 内容                              |
| -------- | ---------------------------------------------------------------- | --------------------------------- |
| 删除文件 | `openapi.ts`                                                     | 手写规范（2.4）                   |
| 删除函数 | `model-config.ts:57-62`                                          | `resolveModelForAgent()`（4.1.1） |
| 删除路由 | `agents.ts:247-272`                                              | 503 桩（2.1）                     |
| 合并重复 | `code-review.ts` + `parallel-example.ts` → `shared/lint-step.ts` | lintStep（2.5）                   |

---

# 批次 7：前端数据完整性

## 7.1 localStorage 添加 TTL

`useSessions.ts` + `useAvailableModels.ts`：localStorage 值包装为 `{ data, timestamp }`，30 分钟过期自动回退 API 重新获取。`apikeys_changed` 事件主动清除 `cabinet-available-models` 缓存。

**验证**: 添加/删除 API key → 缓存清除 → 模型列表刷新。

## 7.2 ChatPanel 模型验证

```ts
// 当前：localStorage 值直接使用，不验证是否在可用列表中
const [selectedModel, setSelectedModel] = useState(
  () => localStorage.getItem('cabinet-selected-model') ?? 'anthropic/claude-sonnet-4-6',
);

// 目标：基于 availableModels 验证
const allModelIds = new Set(availableModels.flatMap((p) => p.models));
const stored = localStorage.getItem('cabinet-selected-model');
// stored 必须在 availableModels 中才使用，否则回退到列表第一个
```

**验证**: 删全部 key → 模型列表为空 → 显示默认值。加新 key → 自动切换。

---

# 批次 8：UX/UI 设计修复

### P0 功能阻断 (6 项)

| #    | 文件                        | 问题                                  | 修复                       |
| ---- | --------------------------- | ------------------------------------- | -------------------------- |
| P0-1 | `SettingsPage.tsx`          | API Keys/Budget 在 Workbench 不可发现 | 在 Settings 页添加入口     |
| P0-2 | `ProjectPage.tsx:1-34`      | 空页面                                | 集成文件浏览 + 活动 widget |
| P0-3 | `ChatView.tsx:662-704`      | Adopt/Reject/Approve 按钮无操作       | 对接 decisions API         |
| P0-4 | `WorkflowsPage.tsx:118-170` | Import/Export 死功能                  | 删除或对接 Mastra workflow |
| P0-5 | `EmployeesPage.tsx:179-212` | 三项菜单同功能                        | 区分三种创建流程           |
| P0-6 | `ChatPanel.tsx:143`         | 模型选择不同步                        | 已在 7.2 + 1.2 修复        |

### 信息架构 (3 项)

- `MemoryPage.tsx:462-466`: Tab 标签从 slug 改为可读名
- `MemoryPage.tsx:469`: projectId 从 activeProject context 读取
- `OthersTab.tsx`: 拆分为独立入口

### 交互增强 (4 项)

- `ChatPanel.tsx`: 拖拽上传文件
- `ChatView.tsx`: 代码块 Copy 按钮
- `FactoryPage.tsx`: Canvas zoom/fit-view 控件
- `SecretaryOrb.tsx:50-55`: 点击前检查 activeSessionId

### 代码架构 (4 项)

- `ChatPanel.tsx` (725行) → 拆分为 ChatPanel + ModelSelector + SkillSelector + FileUpload
- `ChatContext.tsx:260-625` → 拆分 streamParser + messageBuilder + skillDetector
- `MemoryPage.tsx` (710行) → 提取 EntityCard / ProjectCard / ThreadList
- `SecretaryBubble.tsx:18-30` → 颜色改用 Design Token

### 视觉标准 (5 项)

- `text-[10px]`/`text-[11px]` → `text-xs` (≥12px)
- `WorkbenchPage.tsx:22-36` → 复用 `<Tabs>` 组件
- 全局 → Skeleton Loading
- `ChatView.tsx:150-151` → 全部展开 tool calls
- `ChatView.tsx:648-657` → `<details>` → 自定义折叠动画

---

# 执行顺序

```
Batch 0  基础设施      0.1.1 → 0.1.2 → 0.1.3
Batch 1  Execution     1.1, 1.2 并行 → 1.3 (依赖 1.1) → 1.4~1.7 并行
Batch 2  Coordination  2.1~2.5 可并行（均依赖 Batch 1 完成）
Batch 3  Control       3.1~3.5 可并行（3.1,3.2 依赖 0.1）
Batch 4  Intelligence  4.1 (依赖 1.3)
Batch 5  Policy        5.1~5.2 可并行
Batch 6  Dead Code     随时可做
Batch 7  Frontend      7.1, 7.2 (依赖 1.2)
Batch 8  UX/UI         可并行
```

每批次完成后的门禁验证：

| 批次 | 门禁                                               |
| ---- | -------------------------------------------------- |
| 0    | `CABINET_HOME` 环境变量生效                        |
| 1    | 发消息 → LLM 响应；切换模型 → 使用选定模型         |
| 2    | SSE 流正常；Memory 页正常；DELETE /memory/:id 生效 |
| 3    | 改 PORT → 前后端同步连接                           |
| 4    | 仅配 deepseek key → 默认 deepseek-chat             |
| 5    | 生产模式 `CABINET_SECRET` 生效                     |
| 6    | 无 import 错误、无 404                             |
| 7    | 清 localStorage → 模型列表 API 刷新                |
| 8    | 各页面按钮可用、交互正常                           |

---

_计划版本: FINAL · 8 批次 × 42 原子任务 · 已通过两轮严格交叉校验_
