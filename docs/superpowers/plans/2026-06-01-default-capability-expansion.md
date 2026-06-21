# Cabinet 默认能力边界补齐实施计划（修订版）

> 制定日期：2026-06-01
> 修订日期：2026-06-01
> 范围：Phase 0（前置修复）+ Phase 1（文件感知层）+ Phase 2（网络行动层）+ Phase 3（系统行动层）
> 状态：待评审

---

## 修订说明

本次修订基于架构审查的 6 项发现：

1. **ToolPruner 冲突**：当前 `maxTools: 16`，新增 20+ 工具会导致新工具被静默裁剪。必须在 Phase 0 解决。
2. **Secretary 路由重复构建 ToolDependencies**：`secretary.ts` 独立实现了 file/web/shell callbacks，与 `capabilities.ts` 重复。新增工具需改两处，易遗漏。
3. **BrowserPool 并发安全**：系统为多会话 server 架构，`BrowserPool` 的"单活跃 page"模型会导致会话间互相干扰。
4. **PPT 解析选型问题**：`pptx-parser` 维护不活跃，改为复用 `adm-zip` + 手动 XML 解析。
5. **系统工具安全边界**：`startProcess` 使用 `shell: true` 且无危险命令检测；`killProcess` 有跨平台权限风险。
6. **工期偏乐观**：原 30 日未计入 ToolPruner 重构、并发安全设计、Tauri Playwright PoC、跨平台测试等实际开销。

---

## 实施总览

| Phase     | 主题                 | 预估工期      | 新增文件 | 修改文件 | 新增依赖 |
| :-------- | :------------------- | :------------ | :------- | :------- | :------- |
| Phase 0   | 前置修复与架构统一   | 3 工作日      | 0        | 4        | 0        |
| Phase 1   | 文件感知层           | 10 工作日     | 3        | 6        | 4        |
| Phase 2   | 网络行动层（核心）   | 12 工作日     | 3        | 6        | 1-2      |
| Phase 2.5 | 通信增强（RSS/邮件） | 4 工作日      | 1        | 3        | 2        |
| Phase 3   | 系统行动层           | 10 工作日     | 2        | 6        | 2        |
| **合计**  |                      | **39 工作日** | **9**    | **25**   | **9-11** |

**排期建议**：

- Phase 0 必须先完成，否则后续每阶段都会遇到 ToolPruner 和重复代码问题。
- Phase 1 可与 Phase 2 前半段（BrowserPool PoC）并行。
- Phase 2.5（RSS/邮件）可独立排期，不阻塞主线。
- Phase 3 建议等 Phase 2 稳定后再启动（Tauri 桥接经验可复用）。

---

## Phase 0：前置修复与架构统一（3d）

**目标**：消除新增工具的基础架构障碍。

### Task 0.1：修复 ToolPruner 工具上限

**修改文件**：`apps/server/src/context.ts:2213`

当前配置：

```typescript
const toolPruner = gateway ? new ToolPruner({ gateway, maxTools: 16, minTools: 8 }) : undefined;
```

**问题**：新增约 20 个工具后，总数达 60+，新工具 embedding 无历史数据，relevance score 低，会被静默裁剪。

**决策**：提升上限并增加核心工具白名单。经评估，当前 LLM（Claude Sonnet 4.6 / GPT-4o）在 24 个工具内的选择准确率仍可接受。

**修改后**：

```typescript
const toolPruner = gateway
  ? new ToolPruner({
      gateway,
      maxTools: 24,
      minTools: 8,
      alwaysInclude: [
        // 核心文件工具（几乎所有任务都会用到）
        'read_file',
        'write_file',
        'edit_file',
        'list_directory',
        'glob',
        'grep',
        // 核心上下文工具
        'query_system_knowledge',
        'recall',
        'remember',
        // 核心项目工具
        'get_project_context',
        'set_project_context',
      ],
    })
  : undefined;
```

**验收标准**：

- [ ] `pnpm build` / `typecheck` 通过
- [ ] 注册全部工具后，`toolPruner.prune()` 返回的列表包含所有 `alwaysInclude` 工具

### Task 0.2：统一 Secretary 路由的 ToolDependencies 构建

**修改文件**：`apps/server/src/routes/secretary.ts`

**问题**：`secretary.ts:369` 的 `buildToolDependencies` 独立实现了 file/web/shell callbacks（line 789 起），与 `capabilities.ts` 中的 `createFileCapabilities` / `createWebCapabilities` / `createShellCapabilities` 重复。原计划在 Task 1.8 才"检查是否需要同步"，实际上这是已确认的架构债务。

**决策**：重构 `secretary.ts`，使其复用 `capabilities.ts` 的 factory 函数。

**具体步骤**：

1. 在 `secretary.ts` 顶部导入 factory 函数：
   ```typescript
   import {
     createFileCapabilities,
     createWebCapabilities,
     createShellCapabilities,
     createKnowledgeCapabilities,
     createSchedulerCapabilities,
   } from '../capabilities.js';
   ```
2. 在 `buildToolDependencies` 中，用 factory 函数替换独立实现的 file/web/shell/knowledge/scheduler callbacks。
3. 保留 decision/workflow/meeting/memory/employee/agent/project 等 callbacks（这些涉及 secretary 特有的业务逻辑，不属于 capabilities 层的职责）。
4. 确保 factory 生成的 capabilities 与 secretary 原有实现的接口完全兼容（参数、返回值、错误处理模式一致）。

> **注意**：`secretary.ts` 的 `readFile` 二进制文件上限是 5MB（`context.ts` 中是 50MB），`writeFile` 上限也是 5MB（`context.ts` 中是 50MB）。统一时以 `capabilities.ts` 的 50MB 为准，还是保留 secretary 的 5MB？
>
> **决策**：统一为 `capabilities.ts` 的 50MB。secretary 的 5MB 限制是历史遗留，没有明确的产品理由。统一后减少不一致的困惑。

**验收标准**：

- [ ] `secretary.ts` 中不再出现 `resolveSafePath`、`MIME_MAP`、`isTextFile`、`readTextFile` 等 capability 层逻辑
- [ ] `pnpm build` / `typecheck` 通过
- [ ] secretary 路由的端到端行为不变（文件读写、web fetch、shell exec 正常）

### Task 0.3：确认应用并发模型并记录

**新建文件**：`docs/superpowers/notes/concurrency-model.md`

Cabinet 是一个基于 HTTP/WebSocket 的 server 应用，支持：

- 多个 Captain 会话并发（`SessionManager` 管理）
- 后台 Curator 任务与前台请求并发
- 工作流执行中的并行子任务（`parallel` 节点）

** implications**：

- BrowserPool 必须为每个会话维护独立的 `Page`/`Context`。
- 系统工具（剪贴板、通知、进程）的操作影响范围是"整个 OS"，不是会话隔离的。需要确认是否只允许单用户桌面模式使用。

**验收标准**：

- [ ] 文档记录并发模型
- [ ] 如果桌面端和 server 端部署模式有差异，记录差异对 Phase 3 系统工具的影响

---

## Phase 1：文件感知层（10d）

**目标**：让 Agent 能读取当前无法处理的常见文件格式。

### 技术选型（修订）

| 格式 | 选型                 | 版本   | 理由                                                                               |
| :--- | :------------------- | :----- | :--------------------------------------------------------------------------------- |
| PDF  | `pdf-parse`          | latest | 最流行，返回 `{ text, numpages, info }`                                            |
| DOCX | `mammoth`            | latest | 纯 JS，无原生依赖，提取文本+样式                                                   |
| XLSX | `xlsx` (SheetJS)     | latest | 标准库，返回 JSON/CSV，支持 stream                                                 |
| PPTX | `adm-zip` + 手动 XML | 已安装 | 放弃 `pptx-parser`（维护不活跃），复用已有 `adm-zip` 解压后读取 `ppt/slides/*.xml` |
| ZIP  | `adm-zip`            | 已安装 | `apps/server/package.json` 中已存在                                                |

**关于 OCR**：本阶段**不引入** `tesseract.js`。PDF 扫描件暂不支持；图片 OCR 通过多模态 LLM vision 能力解决（Agent 已有 `read_file` 返回 base64，后续由上层选择是否调用 vision model）。如需离线 OCR，作为 Phase 1.5 独立迭代。

### Task 1.1：安装依赖

在 `apps/server` 目录执行：

```bash
pnpm add pdf-parse mammoth xlsx
pnpm add -D @types/pdf-parse
```

> `pdf-parse` 的 TypeScript 类型不完整，需在 `apps/server/src/types/pdf-parse.d.ts` 中补充声明，或使用 `@ts-expect-error` 并在注释中说明原因。

### Task 1.2：创建 `packages/agent/src/tools/document-tools.ts`

**新增文件**。

定义 `DocumentToolDeps` 接口和 `createDocumentTools` 函数，包含 4 个工具：

```typescript
export interface DocumentToolDeps {
  readPdf: (path: string) => Promise<{ text: string; pages: number; info: Record<string, unknown> }>;
  readDocx: (path: string) => Promise<{ text: string; styles: string[] }>;
  readXlsx: (path: string, sheet?: string) => Promise<{ sheets: string[]; data: unknown[][] }>;
  readPptx: (path: string) => Promise<{ slides: { text: string; notes: string }[] }>;
}

export function createDocumentTools(deps: DocumentToolDeps): ToolDefinition[] { ... }
```

**工具参数设计**：

| 工具名      | 输入参数                           | 返回结构                              |
| :---------- | :--------------------------------- | :------------------------------------ |
| `read_pdf`  | `{ path: string }`                 | `{ text, pages, info, path }`         |
| `read_docx` | `{ path: string }`                 | `{ text, styles, path }`              |
| `read_xlsx` | `{ path: string, sheet?: string }` | `{ sheets, data, path, sheet }`       |
| `read_pptx` | `{ path: string }`                 | `{ slides: [{ text, notes }], path }` |

**错误处理**：所有工具统一返回 `{ error: string }` 模式，与现有工具一致。具体实现中，capability 层捕获异常并转为 `error` 字段，不在 agent 层抛异常。

### Task 1.3：创建 `packages/agent/src/tools/archive-tools.ts`

**新增文件**。

```typescript
export interface ArchiveToolDeps {
  listZip: (path: string) => Promise<{ name: string; size: number; isDirectory: boolean }[]>;
  extractZip: (path: string, targetDir: string, entries?: string[]) => Promise<{ extracted: string[] }>;
}

export function createArchiveTools(deps: ArchiveToolDeps): ToolDefinition[] { ... }
```

- `read_zip`：列出 ZIP 内容（文件名、大小、是否目录）
- `extract_zip`：解压指定条目或全部，需 `target_dir` 参数

> 复用点：`adm-zip` 已在 `apps/server/package.json` 中，server 层直接复用。

### Task 1.4：修改 `packages/agent/src/tools/index.ts`

**修改文件**。

1. 导入新增模块：

   ```typescript
   import { createDocumentTools, type DocumentToolDeps } from './document-tools.js';
   import { createArchiveTools, type ArchiveToolDeps } from './archive-tools.js';
   ```

2. 扩展 `ToolDependencies` 接口：

   ```typescript
   export interface ToolDependencies
     extends
       FileToolDeps,
       WebToolDeps,
       ShellToolDeps,
       SchedulerToolDeps,
       KnowledgeToolDeps,
       EvaluationToolDeps,
       LSPToolDeps,
       SystemKnowledgeToolDeps,
       DocumentToolDeps,   // 新增
       ArchiveToolDeps {   // 新增
   ```

3. 在 `createCabinetTools` 中展开新工具（放在 `createFileTools` 之后）：

   ```typescript
   // ═══════════════════════════════════════════════════════════
   // Document Tools
   // ═══════════════════════════════════════════════════════════
   ...createDocumentTools(deps),

   // ═══════════════════════════════════════════════════════════
   // Archive Tools
   // ═══════════════════════════════════════════════════════════
   ...createArchiveTools(deps),
   ```

### Task 1.5：创建 `apps/server/src/capabilities.ts` 中的 document/archive capabilities

**修改文件**：`apps/server/src/capabilities.ts`

新增两个 capability factory：

```typescript
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import AdmZip from 'adm-zip';

export function createDocumentCapabilities() {
  return {
    readPdf: async (path: string) => {
      const buffer = await fs.promises.readFile(path);
      const data = await pdfParse(buffer);
      return { text: data.text, pages: data.numpages, info: data.info };
    },
    readDocx: async (path: string) => {
      const result = await mammoth.extractRawText({ path });
      return { text: result.value, styles: [] };
    },
    readXlsx: async (path: string, sheetName?: string) => {
      const workbook = XLSX.readFile(path);
      const sheet = sheetName || workbook.SheetNames[0]!;
      const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheet]!, { header: 1 });
      return { sheets: workbook.SheetNames, data };
    },
    readPptx: async (path: string) => {
      const zip = new AdmZip(path);
      const entries = zip.getEntries();
      const slideEntries = entries
        .filter((e) => e.entryName.startsWith('ppt/slides/slide') && e.entryName.endsWith('.xml'))
        .sort((a, b) => a.entryName.localeCompare(b.entryName));

      const slides: { text: string; notes: string }[] = [];
      for (const entry of slideEntries) {
        const xml = zip.readAsText(entry);
        // 提取所有 <a:t> 文本节点
        const texts: string[] = [];
        const textMatches = xml.matchAll(/<a:t>([^<]*)<\/a:t>/g);
        for (const match of textMatches) {
          if (match[1]) texts.push(match[1]);
        }
        slides.push({ text: texts.join(' ').trim(), notes: '' });
      }
      return { slides };
    },
  };
}

export function createArchiveCapabilities() {
  return {
    listZip: async (path: string) => {
      const zip = new AdmZip(path);
      return zip.getEntries().map((e) => ({
        name: e.entryName,
        size: e.header.size,
        isDirectory: e.isDirectory,
      }));
    },
    extractZip: async (path: string, targetDir: string, entries?: string[]) => {
      const zip = new AdmZip(path);
      if (entries && entries.length > 0) {
        zip.extractAllTo(targetDir, true);
        // TODO: AdmZip 不支持单文件 extract，如需精确控制需用 node:stream
        // 当前实现解压全部，返回请求的条目列表
      } else {
        zip.extractAllTo(targetDir, true);
      }
      return { extracted: entries ?? zip.getEntries().map((e) => e.entryName) };
    },
  };
}
```

> **PPTX 降级说明**：放弃 `pptx-parser`，改用 `adm-zip` + 正则提取 `<a:t>` 文本节点。这只能提取纯文本，不能保留格式和布局信息，但满足 Agent"读取 PPT 内容"的最低需求。如果未来需要更复杂的解析，再引入专用库。

### Task 1.6：修改 `apps/server/src/context.ts` 和 `secretary.ts` 注入新 capabilities

**修改文件**：`apps/server/src/context.ts`、`apps/server/src/routes/secretary.ts`

在构建 `ToolDependencies` 对象时注入新的 capabilities。由于 Phase 0.2 已完成统一，只需在 `capabilities.ts` 的 factory 调用处展开：

```typescript
import { createDocumentCapabilities, createArchiveCapabilities } from './capabilities.js';

const docCaps = createDocumentCapabilities();
const archiveCaps = createArchiveCapabilities();

const toolDeps: ToolDependencies = {
  ...existingDeps,
  ...docCaps,
  ...archiveCaps,
};
```

### Task 1.7：Agent 角色权限同步

**修改文件**：`packages/agent/src/agent-roles.ts`

将新工具加入相关角色的 `allowedTools`：

- `SECRETARY_ROLE`：增加 `read_pdf`, `read_docx`, `read_xlsx`, `read_pptx`, `read_zip`, `extract_zip`
- `CURATOR_ROLE`：增加 `read_pdf`（用于索引文档内容）
- `REVIEWER_ROLE`：增加 `read_pdf`（用于验证输出中的文档引用）
- `ORGANIZE_ROLE`：增加全部文档和压缩工具

> 有删除权限的 `extract_zip` 不加入 `MEETING_CHAIR_ROLE`（该角色只有读取权限）。

### Phase 1 验收标准

```
- [ ] Agent 能读取 PDF 并提取全文和页数
- [ ] Agent 能读取 Word 文档并提取纯文本
- [ ] Agent 能读取 Excel 并返回指定 sheet 的数据（JSON 数组）
- [ ] Agent 能读取 PowerPoint 并逐页提取文本
- [ ] Agent 能列出 ZIP 内容并选择性解压
- [ ] 所有新工具在错误时返回 { error: string }，不抛异常
- [ ] ToolPruner 的 alwaysInclude 包含核心工具，新工具在 relevance 足够时能被选中
- [ ] pnpm build 通过
- [ ] pnpm typecheck 通过
- [ ] 新增 capability 的单元测试覆盖（至少 happy path + error path）
```

---

## Phase 2：网络行动层（核心）（12d）

**目标**：让 Agent 能主动操作浏览器，从"读网页"升级到"用网页"。

### 前置依赖：Playwright 依赖位置修正 + Tauri 打包 PoC

**关键发现**：`playwright` 当前在 `packages/harness/package.json` 的 `devDependencies` 中。

**决策**：将 `playwright` 移到 `dependencies`，因为 browser 工具是运行时能力。

```bash
# 在 packages/harness 目录执行
pnpm remove -D playwright
pnpm add playwright
```

**Tauri 打包 PoC（Gate）**：在投入大量编码之前，必须先验证 Playwright 的 Chromium 在 Tauri 打包后能否正常启动。这是本 Phase 的最高风险点。

**PoC 步骤**（1-2 工作日）：

1. 写最小脚本：用 Playwright 启动 Chromium，访问 `https://example.com`，提取标题，关闭。
2. 在桌面端打包（`pnpm tauri build`）。
3. 在干净环境（未安装 Playwright 的虚拟机）运行打包产物。
4. 观察 Chromium 是否能自动下载/启动。

**PoC 结果决策**：

- **通过**：继续 Phase 2 正常实施。
- **失败**：改用 `puppeteer-core` + 系统自带 Chrome（要求用户预先安装 Chrome/Edge），或放弃打包后的浏览器能力（仅保留开发/服务器模式）。

### Task 2.1：创建 `packages/harness/src/browser-pool.ts`

**新增文件**。

设计目标：复用浏览器实例，避免每次工具调用都 launch/close（2-3秒降到 200ms）。**支持多会话隔离**。

```typescript
import type { Browser, BrowserContext, Page } from 'playwright';

export interface BrowserPoolOptions {
  maxContexts?: number;
  browser?: 'chromium' | 'firefox' | 'webkit';
}

export interface SessionPage {
  context: BrowserContext;
  page: Page;
  lastUsedAt: number;
}

export class BrowserPool {
  private browser: Browser | null = null;
  private sessions = new Map<string, SessionPage>();
  private readonly maxContexts: number;
  private readonly browserType: string;

  constructor(options: BrowserPoolOptions = {}) {
    this.maxContexts = options.maxContexts ?? 3;
    this.browserType = options.browser ?? 'chromium';
  }

  async initialize(): Promise<void>;

  /** Acquire or create a page for the given sessionId. */
  async acquire(sessionId: string): Promise<Page>;

  /** Release a session's page (close page, keep browser alive). */
  async release(sessionId: string): Promise<void>;

  /** Shut down the entire browser instance. */
  async shutdown(): Promise<void>;

  /** Clean up idle sessions older than maxAgeMs. */
  async pruneIdleSessions(maxAgeMs?: number): Promise<number>;
}
```

**关键变更（对比原计划）**：

- 所有方法增加 `sessionId` 参数，用 `Map<string, SessionPage>` 隔离不同会话的 page/context。
- 增加 `pruneIdleSessions` 方法，防止内存泄漏。
- `maxContexts` 默认从 2 提升到 3，因为会话隔离后单个用户可能同时持有多个 context（如秘书会话 + 工作流执行）。

### Task 2.2：创建 `packages/agent/src/tools/browser-tools.ts`

**新增文件**。

```typescript
export interface BrowserToolDeps {
  browserNavigate: (sessionId: string, url: string, waitFor?: string) => Promise<{ title: string; url: string }>;
  browserClick: (sessionId: string, selector: string) => Promise<{ clicked: boolean }>;
  browserType: (sessionId: string, selector: string, text: string, submit?: boolean) => Promise<{ typed: boolean }>;
  browserRead: (sessionId: string, selector?: string) => Promise<{ text: string; links: { text: string; href: string }[] }>;
  browserScreenshot: (sessionId: string, selector?: string) => Promise<{ base64: string; mimeType: string }>;
  browserEvaluate: (sessionId: string, script: string) => Promise<{ result: unknown }>;
}

export function createBrowserTools(deps: BrowserToolDeps): ToolDefinition[] { ... }
```

**状态管理**：每个工具调用都携带 `session_id`（由 AgentLoop 从当前 session 注入）。BrowserPool 内部按 `sessionId` 隔离 page，避免多会话互相干扰。

### Task 2.3：修改 `apps/server/src/capabilities.ts`（BrowserPool 初始化）

**修改文件**。

```typescript
import { BrowserPool } from '@cabinet/harness';

let sharedBrowserPool: BrowserPool | null = null;

export function getBrowserPool(): BrowserPool {
  if (!sharedBrowserPool) {
    sharedBrowserPool = new BrowserPool({ maxContexts: 3 });
  }
  return sharedBrowserPool;
}

export function createBrowserCapabilities() {
  const pool = getBrowserPool();
  return {
    browserNavigate: async (sessionId, url, waitFor) => {
      await pool.initialize();
      const page = await pool.acquire(sessionId);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      if (waitFor) await page.waitForSelector(waitFor, { timeout: 10000 });
      const title = await page.title();
      return { title, url: page.url() };
    },
    browserClick: async (sessionId, selector) => {
      const page = await pool.acquire(sessionId);
      await page.click(selector);
      return { clicked: true };
    },
    browserType: async (sessionId, selector, text, submit) => {
      const page = await pool.acquire(sessionId);
      await page.fill(selector, text);
      if (submit) await page.press(selector, 'Enter');
      return { typed: true };
    },
    browserRead: async (sessionId, selector) => {
      const page = await pool.acquire(sessionId);
      const target = selector ? await page.$(selector) : page;
      const text = target ? ((await target.textContent()) ?? '') : '';
      const links = await page.$$eval('a', (as) =>
        as.map((a) => ({ text: a.textContent ?? '', href: a.href })),
      );
      return { text, links };
    },
    browserScreenshot: async (sessionId, selector) => {
      const page = await pool.acquire(sessionId);
      const screenshot = selector
        ? await (await page.$(selector))?.screenshot({ encoding: 'base64' })
        : await page.screenshot({ encoding: 'base64', fullPage: false });
      return { base64: screenshot ?? '', mimeType: 'image/png' };
    },
    browserEvaluate: async (sessionId, script) => {
      const page = await pool.acquire(sessionId);
      const result = await page.evaluate((s) => eval(s), script);
      return { result };
    },
  };
}
```

**安全边界**：`browserEvaluate` 允许执行任意 JS，属于高风险操作。应在 AgentRole 中限制（仅 `SECRETARY_ROLE` 和 `ORGANIZE_ROLE` 可用，且需要 decision approval）。

**优雅关闭**：在 `context.ts` 的 `shutdown()` 中增加 `await getBrowserPool().shutdown()`。

**空闲清理**：在 `context.ts` 的定时器区段增加 BrowserPool 空闲会话清理（每 10 分钟）：

```typescript
const browserPoolCleanupTimer = setInterval(
  () => {
    getBrowserPool()
      .pruneIdleSessions(10 * 60 * 1000)
      .catch(() => {});
  },
  10 * 60 * 1000,
);
browserPoolCleanupTimer.unref();
```

### Task 2.4：修改 `packages/agent/src/tools/index.ts` 注入浏览器工具

**修改文件**。

1. 导入 `BrowserToolDeps` 和 `createBrowserTools`
2. 扩展 `ToolDependencies` 接口
3. 在 `createCabinetTools` 中展开：
   ```typescript
   // 放在 createWebTools 之后
   ...createBrowserTools(deps),
   ```

### Task 2.5：修改 Agent 角色 allowedTools

**修改文件**：`packages/agent/src/agent-roles.ts`

将新工具加入：

- `SECRETARY_ROLE`：`browser_navigate`, `browser_click`, `browser_type`, `browser_read`, `browser_screenshot`, `browser_evaluate`
- `ORGANIZE_ROLE`：全部浏览器工具
- `REVIEWER_ROLE`：`browser_navigate`, `browser_read`, `browser_screenshot`（用于独立验证）

> `browser_evaluate` **不加入** `MEETING_CHAIR_ROLE` 和 `CURATOR_ROLE`。

### Phase 2 验收标准

```
- [ ] Tauri 打包 PoC 通过（Chromium 能启动并访问网页）
- [ ] BrowserPool 初始化后，单次浏览器操作 < 1 秒（不含页面加载）
- [ ] 两个并发会话同时操作不同页面互不干扰
- [ ] Agent 能导航到 SPA 页面并提取渲染后的内容
- [ ] Agent 能填写表单并提交
- [ ] Agent 能对网页截图（base64 返回）
- [ ] Agent 能执行 JS 并获取结果
- [ ] BrowserPool 在 server 关闭时正确清理
- [ ] 空闲会话超过 10 分钟自动释放
- [ ] pnpm build / typecheck 通过
- [ ] BrowserPool 单元测试（会话隔离、空闲清理、错误处理）
```

---

## Phase 2.5：通信增强（RSS/邮件）（4d，可选）

**目标**：Agent 能读取 RSS 和发送邮件。与 Phase 2 无依赖，可独立排期。

### Task 2.5.1：安装依赖

```bash
pnpm add rss-parser nodemailer
pnpm add -D @types/rss-parser @types/nodemailer
```

### Task 2.5.2：创建 `packages/agent/src/tools/communication-tools.ts`

**新增文件**。

```typescript
export interface CommunicationToolDeps {
  fetchRss: (url: string, limit?: number) => Promise<{ entries: { title: string; link: string; pubDate?: string; content?: string }[] }>;
  sendEmail: (to: string, subject: string, body: string, bodyType?: 'text' | 'html') => Promise<{ sent: boolean; messageId?: string }>;
}

export function createCommunicationTools(deps: CommunicationToolDeps): ToolDefinition[] { ... }
```

### Task 2.5.3：Server 层实现

**修改文件**：`apps/server/src/capabilities.ts`

```typescript
import Parser from 'rss-parser';
import nodemailer from 'nodemailer';

export function createCommunicationCapabilities(ctx: CapabilitiesContext) {
  const rssParser = new Parser();

  // SMTP 配置从 settings 表读取
  const getSmtpConfig = () => {
    const settings = ctx.settingsRepo.get('smtp_config');
    return settings ? JSON.parse(settings) : null;
  };

  return {
    fetchRss: async (url, limit) => {
      const feed = await rssParser.parseURL(url);
      return { entries: (feed.items ?? []).slice(0, limit ?? 20) };
    },
    sendEmail: async (to, subject, body, bodyType) => {
      const config = getSmtpConfig();
      if (!config) throw new Error('SMTP not configured. Set smtp_config in settings.');
      const transporter = nodemailer.createTransport(config);
      const result = await transporter.sendMail({
        from: config.from,
        to,
        subject,
        [bodyType === 'html' ? 'html' : 'text']: body,
      });
      return { sent: true, messageId: result.messageId };
    },
  };
}
```

> **安全**：SMTP 密码存储在 DB settings 中，应复用现有的 API key 加密机制（`encryptApiKey`/`decryptApiKey`），不要明文存储。

### Task 2.5.4：Agent 角色权限同步

- `SECRETARY_ROLE`：增加 `fetch_rss`, `send_email`
- `ORGANIZE_ROLE`：增加 `fetch_rss`, `send_email`

### Phase 2.5 验收标准

```
- [ ] Agent 能读取 RSS feed 并返回结构化条目
- [ ] Agent 能发送邮件（配置 SMTP 后）
- [ ] SMTP 密码加密存储，不暴露明文
- [ ] pnpm build / typecheck 通过
```

---

## Phase 3：系统行动层（10d）

**目标**：让 Agent 能与操作系统深度交互。

### 技术选型

| 能力       | 选型                       | 理由                                           |
| :--------- | :------------------------- | :--------------------------------------------- |
| 剪贴板     | `clipboardy`               | 纯 Node.js，跨平台，无需 Tauri                 |
| 文件对话框 | Tauri `dialog` plugin      | 必须 GUI，命令行无法替代                       |
| 系统通知   | `node-notifier`            | 简单跨平台；Tauri notification 更原生但需 Rust |
| 后台进程   | `node:child_process.spawn` | 原生模块，零安装                               |

### Task 3.1：安装依赖

```bash
# 在 apps/server 目录执行
pnpm add clipboardy node-notifier
pnpm add -D @types/node-notifier
```

### Task 3.2：创建 `packages/agent/src/tools/system-tools.ts`

**新增文件**。

```typescript
export interface SystemToolDeps {
  readClipboard: () => Promise<{ text: string }>;
  writeClipboard: (text: string) => Promise<{ written: boolean }>;
  sendNotification: (title: string, message: string) => Promise<{ sent: boolean }>;
  startProcess: (command: string, args?: string[], cwd?: string) => Promise<{ pid: number }>;
  killProcess: (pid: number) => Promise<{ killed: boolean }>;
  showOpenDialog: (options?: { multiple?: boolean; filters?: { name: string; extensions: string[] }[] }) => Promise<{ paths: string[] }>;
}

export function createSystemTools(deps: SystemToolDeps): ToolDefinition[] { ... }
```

**关键变更（对比原计划）**：

- `startProcess` 签名从 `(command: string, cwd?: string)` 改为 `(command: string, args?: string[], cwd?: string)`，**禁止 `shell: true`**。
- `showOpenDialog` 是桌面端专用工具，在纯 server 模式下返回 `{ error: 'Dialog only available in desktop mode' }`。

### Task 3.3：Tauri 文件对话框桥接

**涉及文件**：

- `apps/desktop/src-tauri/src/lib.rs` — 新增 Rust command
- `apps/desktop/src-tauri/tauri.conf.json` — 注册权限
- `apps/desktop/src/` — 前端 WebSocket 桥接
- `apps/server/src/routes/` — 复用现有 WebSocket handler

**架构设计**：

采用 **WebSocket 请求-响应模式**：

1. Server 收到 `show_open_dialog` 工具调用
2. Server 通过 WebSocket 向前端发送 `request:show_dialog` 事件
3. 前端调用 Tauri `open` dialog API
4. 用户选择后，前端通过 WebSocket 回传 `response:show_dialog`
5. Server 将结果返回给 Agent

**Rust 侧（`apps/desktop/src-tauri/src/lib.rs`）**：

```rust
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
async fn show_open_dialog(
    app: tauri::AppHandle,
    multiple: bool,
    filters: Option<Vec<(String, Vec<String>)>>,
) -> Result<Vec<String>, String> {
    let mut dialog = app.dialog().file();
    if multiple {
        dialog = dialog.add_filter("All Files", &["*"]);
    }
    if let Some(f) = filters {
        for (name, exts) in f {
            dialog = dialog.add_filter(&name, &exts.iter().map(|s| s.as_str()).collect::<Vec<_>>());
        }
    }
    dialog.pick_files()
        .map(|paths| paths.into_iter().map(|p| p.to_string_lossy().to_string()).collect())
        .ok_or_else(|| "No file selected".to_string())
}
```

**前端桥接**：在 WebSocket handler 中监听 server 的 dialog 请求事件，调用 Tauri command，结果回传 server。

**简化回退方案**：如果 WebSocket 双向通道实现复杂，可改为前端轮询（见原计划）。

### Task 3.4：修改 `apps/server/src/capabilities.ts`（系统能力）

**修改文件**。

```typescript
import clipboardy from 'clipboardy';
import notifier from 'node-notifier';
import { spawn } from 'node:child_process';
import { detectDangerousCommand } from './capabilities.js'; // 复用已有安全检测

export function createSystemCapabilities(isDesktopMode: boolean) {
  return {
    readClipboard: async () => ({ text: await clipboardy.read() }),
    writeClipboard: async (text: string) => {
      await clipboardy.write(text);
      return { written: true };
    },
    sendNotification: async (title: string, message: string) => {
      notifier.notify({ title, message });
      return { sent: true };
    },
    startProcess: async (command: string, args?: string[], cwd?: string) => {
      // 安全检测：复用 detectDangerousCommand
      const fullCommand = args ? `${command} ${args.join(' ')}` : command;
      const blocked = detectDangerousCommand(fullCommand);
      if (blocked) throw new Error(`Command blocked for safety: ${blocked}`);

      const child = spawn(command, args ?? [], { cwd, detached: true, shell: false });
      return { pid: child.pid! };
    },
    killProcess: async (pid: number) => {
      // 保护系统进程（pid < 100 通常是内核/init 进程）
      if (pid < 100) throw new Error('Refusing to kill system process');
      try {
        process.kill(pid);
        return { killed: true };
      } catch (e: any) {
        return { killed: false, error: e.message };
      }
    },
    showOpenDialog: async (options?: { multiple?: boolean; filters?: any[] }) => {
      if (!isDesktopMode) {
        return { paths: [], error: 'Dialog only available in desktop mode' };
      }
      // 通过 WebSocket 请求前端调用 Tauri dialog
      // 具体实现依赖 Task 3.3 的桥接
      return { paths: [] };
    },
  };
}
```

**关键安全变更**：

- `startProcess` 使用 `shell: false`，`args` 作为数组传入，避免命令注入。
- 复用 `detectDangerousCommand` 进行命令审查。
- `killProcess` 拒绝 pid < 100 的系统进程。

### Task 3.5：注册系统工具到 Agent

**修改文件**：`packages/agent/src/tools/index.ts`

1. 导入 `SystemToolDeps` 和 `createSystemTools`
2. 扩展 `ToolDependencies`
3. 在 `createCabinetTools` 末尾展开：
   ```typescript
   ...createSystemTools(deps),
   ```

### Task 3.6：Agent 角色权限同步

**修改文件**：`packages/agent/src/agent-roles.ts`

- `SECRETARY_ROLE`：增加 `read_clipboard`, `write_clipboard`, `send_notification`
- `ORGANIZE_ROLE`：增加全部系统工具（含 `start_process`, `kill_process`, `show_open_dialog`）

> `start_process` 和 `kill_process` **不加入** `SECRETARY_ROLE`（高危操作，仅组织角色可用，且需 decision approval）。

### Phase 3 验收标准

```
- [ ] Agent 能读取系统剪贴板内容
- [ ] Agent 能写入系统剪贴板
- [ ] Agent 能发送系统通知（桌面角标/气泡）
- [ ] Agent 能启动后台进程并获取 pid（shell: false，危险命令被拦截）
- [ ] Agent 能终止指定 pid 的进程（pid < 100 被拒绝）
- [ ] Agent 能触发文件选择对话框并获取用户选择的路径（桌面端）
- [ ] 纯 server 模式下对话框返回友好错误信息
- [ ] 所有系统工具在 server/桌面端都可用
- [ ] pnpm build / typecheck 通过
```

---

## 跨 Phase 通用任务

每个 Phase 完成后都需要执行以下任务：

### Task X.1：系统知识库更新

**文件**：`packages/storage/src/system-knowledge-base.ts`（或相关位置）

新增工具后更新知识库，让 `query_system_knowledge` 能返回准确的新工具信息（存在性、使用场景、参数）。

**内容模板**（每新增一个工具）：

```markdown
## read_pdf

- 存在性：是
- 使用场景：需要提取 PDF 文档文本内容时
- 参数：path（文件路径）
- 返回值：{ text, pages, info, path }
- 错误模式：{ error: string }
- 权限要求：SECRETARY, CURATOR, REVIEWER, ORGANIZE
```

### Task X.2：构建与测试

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

**测试要求**：

- 每个新增 capability factory 需有单元测试（happy path + error path）
- BrowserPool 需有集成测试（会话隔离、并发、空闲清理）
- 端到端测试：通过 AgentLoop 调用新工具，验证完整链路

### Task X.3：安全审查清单

新增工具完成后，逐条检查：

- [ ] 该工具是否涉及文件系统写入？是 → 需 path 安全检查（`resolveSafePath`）
- [ ] 该工具是否涉及网络访问？是 → 需 internal IP 拦截
- [ ] 该工具是否涉及代码/脚本执行？是 → 需危险命令检测 + decision approval
- [ ] 该工具是否涉及系统级操作（进程、剪贴板）？是 → 需限制可用角色
- [ ] 该工具是否涉及用户隐私（邮件、通知）？是 → 需明确用户授权
- [ ] 错误时是否返回 `{ error: string }` 而非抛异常？
- [ ] 是否已加入 `ToolPruner.alwaysInclude`（如果是核心工具）？

---

## 实施顺序与依赖图

```
Phase 0: 前置修复 (3d) —— 必须先完成
├── Task 0.1 修复 ToolPruner
├── Task 0.2 统一 Secretary deps 构建
└── Task 0.3 确认并发模型
    │
    ▼
Phase 1: 文件感知层 (10d)
├── Task 1.1 安装依赖
├── Task 1.2 创建 document-tools.ts
├── Task 1.3 创建 archive-tools.ts
├── Task 1.4 修改 tools/index.ts
├── Task 1.5 修改 capabilities.ts
├── Task 1.6 修改 context.ts / secretary.ts
├── Task 1.7 修改 agent-roles.ts
└── Task X.1/X.2/X.3 通用任务
    │
    ▼
Phase 2: 网络行动层 (12d)
├── Task 2.0  Playwright 依赖位置修正
├── Task 2.0a Tauri 打包 PoC（Gate）
├── Task 2.1  创建 browser-pool.ts（含会话隔离）
├── Task 2.2  创建 browser-tools.ts
├── Task 2.3  修改 capabilities.ts（BrowserPool）
├── Task 2.4  修改 tools/index.ts
├── Task 2.5  修改 agent-roles.ts
└── Task X.1/X.2/X.3 通用任务
    │
    ▼
Phase 2.5: 通信增强 (4d) —— 可独立排期
├── Task 2.5.1 安装依赖
├── Task 2.5.2 创建 communication-tools.ts
├── Task 2.5.3 修改 capabilities.ts
└── Task 2.5.4 修改 agent-roles.ts
    │
    ▼
Phase 3: 系统行动层 (10d)
├── Task 3.1 安装依赖
├── Task 3.2 创建 system-tools.ts
├── Task 3.3 Tauri 对话框桥接
├── Task 3.4 修改 capabilities.ts（系统能力）
├── Task 3.5 修改 tools/index.ts
├── Task 3.6 修改 agent-roles.ts
└── Task X.1/X.2/X.3 通用任务
```

**可并行点**：

- Phase 1 的 `read_zip` 可与文档解析并行
- Phase 2 的 BrowserPool PoC 可与 Phase 1 后半段并行
- Phase 2.5 可与 Phase 3 并行

---

## 风险与回退方案（修订）

| 风险                                                       | 影响             | 概率   | 回退方案                                                                           |
| :--------------------------------------------------------- | :--------------- | :----- | :--------------------------------------------------------------------------------- |
| `pdf-parse` 的 `pdfjs-dist` native 模块在 Tauri 打包时失败 | Phase 1 阻塞     | 中     | 换 `pdfjs-dist` 纯 JS 版或 `mupdf` WASM                                            |
| `mammoth` 解析复杂 DOCX 效果差                             | Phase 1 质量下降 | 低     | 降级为 ZIP+XML 手动提取                                                            |
| Playwright 在 Tauri 打包后找不到 Chromium                  | Phase 2 阻塞     | **高** | **PoC 先行**：若失败，改用 `puppeteer-core` + 系统 Chrome；或仅保留开发/服务器模式 |
| BrowserPool 内存泄漏                                       | Phase 2 稳定性   | 中     | `pruneIdleSessions` 每 10 分钟自动回收 + 进程监控                                  |
| 多会话并发操作同一 page                                    | Phase 2 数据安全 | 中     | **已解决**：通过 `sessionId` 隔离                                                  |
| Tauri 对话框桥接实现复杂                                   | Phase 3 延期     | 中     | **纯 Node.js 回退**：用 `start`/`xdg-open` 打开文件管理器，用户手动粘贴路径        |
| `node-notifier` 在 Tauri 打包后失效                        | Phase 3 质量下降 | 低     | 改用 Tauri notification API（需 Rust 代码）                                        |
| ToolPruner 新工具 relevance 过低                           | 所有 Phase       | 低     | **已解决**：alwaysInclude 白名单 + maxTools 提升到 24                              |

> **最高风险点**：Playwright 的 Chromium 在 Tauri 打包后的分发。**Phase 2 正式开始前必须先完成 PoC**。

---

## 建议的首个 Sprint（2 周快速验证）

如果资源有限，Sprint 1 只做以下子集，快速验证价值：

1. **Task 0.1** 修复 ToolPruner（maxTools: 24 + alwaysInclude）
2. **Task 0.2** 统一 Secretary deps 构建
3. **Task 1.2** `read_pdf` + **Task 1.5** server 实现
4. **Task 1.3** `read_zip` + **Task 1.5** server 实现
5. **Task 1.4** 注册到 Agent
6. **Task 2.0a** Playwright Tauri 打包 PoC

这 5 个任务覆盖：

- 架构债务清理（Phase 0）
- 用户反馈中最痛的文件格式缺口（PDF + ZIP）
- Phase 2 的最高风险技术验证（Playwright 打包）

**Sprint 1 验收**：

- [ ] PDF 和 ZIP 工具可用
- [ ] Tauri 打包后 Playwright 能启动 Chromium（或明确回退方案）
- [ ] pnpm build / typecheck / test 通过

如果 Sprint 1 成功，证明技术路线可行，再全面推进 Phase 2/3。
