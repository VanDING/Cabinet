# Cabinet 内置精选 + Discover UI 实现计划

> 基于 Cabinet 审计报告修复策略 Phase 1-2  
> **版本**: v1.0 | **制定日期**: 2026-06-01  
> **范围**: `apps/server` (后端预设系统) + `apps/desktop` (前端 UI)  
> **预计总工时**: ~40 小时 (Phase 1: 24h + Phase 2: 16h)

---

## 一、设计原则

1. **本地优先**：所有预设内容随安装包分发，无需联网即可使用
2. **利用现有机制**：复用 `MCPManager.updateConfigs()`、`SkillRegistry`、`文件 watcher`，不新建并行系统
3. **零破坏性变更**：现有用户配置不受影响，预设仅作为"快捷添加"通道
4. **渐进增强**：Phase 1 解决"冷启动"问题；Phase 2 增加发现体验

---

## 二、Phase 1 — 内置精选预设（冷启动）

**目标**：新用户在首次打开 Cabinet 时，5 分钟内启用核心 MCP + Skill，无需手动填写任何配置。  
**分支名**: `feature/presets-phase1`  
**工时**: ~24 小时

---

### 2.1 数据层：预设目录结构

#### 2.1.1 MCP 预设

```
apps/server/src/presets/
├── mcp/
│   ├── filesystem.json
│   ├── fetch.json
│   ├── github.json
│   ├── slack.json
│   ├── puppeteer.json
│   ├── postgres.json
│   ├── sqlite.json
│   └── brave-search.json
│
└── skills/
    ├── code-reviewer/
    │   └── SKILL.md
    ├── doc-writer/
    │   └── SKILL.md
    ├── api-designer/
    │   └── SKILL.md
    ├── test-writer/
    │   └── SKILL.md
    └── pr-reviewer/
        └── SKILL.md
```

#### 2.1.2 MCP 预设 JSON 格式

与现有 `MCPServerConfig` 完全兼容：

```json
// apps/server/src/presets/mcp/filesystem.json
{
  "id": "preset-mcp-filesystem",
  "name": "filesystem",
  "displayName": "File System",
  "description": "Read, write, and manage files on your local machine. Essential for most workflows.",
  "category": "essential",
  "tags": ["files", "local", "essential"],
  "icon": "📁",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "{{CABINET_DIR}}"],
  "enabled": true,
  "env": {},
  "setupNotes": "Requires Node.js and npx. Will be installed automatically on first use."
}
```

新增字段（仅用于展示，不影响运行时）：
- `id` — 预设唯一标识
- `displayName` — 展示用名称
- `category` — `essential` | `productivity` | `dev` | `communication` | `data`
- `tags` — 搜索标签
- `icon` — emoji 图标（或 SVG 路径）
- `setupNotes` — 安装说明/前置条件

#### 2.1.3 Skill 预设格式

标准 SKILL.md，与 Anthropic 格式完全兼容：

```markdown
---
name: code-reviewer
description: Review code for bugs, style issues, and security vulnerabilities. Use when the user asks for code review, PR review, or wants feedback on any code snippet.
kind: prompt
version: 1
category: dev
tags: [code, review, quality]
icon: 🔍
---

# Code Reviewer

You are an expert code reviewer. Analyze the provided code for:

## Checklist
- [ ] **Bugs**: Logic errors, null pointer risks, race conditions
- [ ] **Security**: Injection risks, unsafe deserialization, hardcoded secrets
- [ ] **Performance**: Unnecessary allocations, N+1 queries, blocking I/O
- [ ] **Style**: Consistency with language conventions, naming, readability
- [ ] **Tests**: Missing test coverage, brittle assertions

## Output Format
For each issue found, provide:
1. **Severity**: critical | warning | suggestion
2. **Location**: file and line number
3. **Description**: what the issue is
4. **Fix**: suggested code change

If no issues found, explicitly state "No issues found" and compliment one thing done well.
```

新增 frontmatter 字段（仅用于展示）：
- `category` — 同 MCP preset
- `tags` — 搜索标签
- `icon` — emoji 图标

---

### 2.2 后端：预设服务模块

#### 2.2.1 新建 `apps/server/src/services/preset-service.ts`

```typescript
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MCPServerConfig } from '../mcp/mcp-manager.js';
import { parseSkillMarkdown } from '@cabinet/agent';

// 预设文件所在目录（构建后位于 server-dist 内）
const PRESETS_DIR = join(fileURLToPath(import.meta.url), '../../presets');

// ── MCP Presets ──

export interface McpPreset extends MCPServerConfig {
  id: string;
  displayName: string;
  description: string;
  category: string;
  tags: string[];
  icon: string;
  setupNotes?: string;
}

export function listMcpPresets(): McpPreset[] {
  const dir = join(PRESETS_DIR, 'mcp');
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const raw = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
      return raw as McpPreset;
    })
    .sort((a, b) => {
      // essential 类别排在最前
      if (a.category === 'essential' && b.category !== 'essential') return -1;
      if (b.category === 'essential' && a.category !== 'essential') return 1;
      return a.displayName.localeCompare(b.displayName);
    });
}

export function getMcpPreset(id: string): McpPreset | null {
  return listMcpPresets().find((p) => p.id === id) ?? null;
}

// ── Skill Presets ──

export interface SkillPreset {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  tags: string[];
  icon: string;
  body: string;
  kind: string;
  version: number;
}

export function listSkillPresets(): SkillPreset[] {
  const dir = join(PRESETS_DIR, 'skills');
  if (!existsSync(dir)) return [];

  const results: SkillPreset[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillMdPath = join(dir, entry.name, 'SKILL.md');
    if (!existsSync(skillMdPath)) continue;

    const content = readFileSync(skillMdPath, 'utf-8');
    const parsed = parseSkillMarkdown(content);
    if (!parsed) continue;

    const meta = parsed.metadata ?? {};
    results.push({
      id: `preset-skill-${entry.name}`,
      name: parsed.name,
      displayName: (meta.displayName as string) ?? parsed.name,
      description: parsed.description,
      category: (meta.category as string) ?? 'general',
      tags: (meta.tags as string[]) ?? [],
      icon: (meta.icon as string) ?? '✨',
      body: parsed.body,
      kind: parsed.kind ?? 'prompt',
      version: parsed.version ?? 1,
    });
  }
  return results;
}

export function getSkillPreset(id: string): SkillPreset | null {
  return listSkillPresets().find((p) => p.id === id) ?? null;
}
```

#### 2.2.2 新建路由 `apps/server/src/routes/presets.ts`

```typescript
import { Hono } from 'hono';
import { listMcpPresets, getMcpPreset, listSkillPresets, getSkillPreset } from '../services/preset-service.js';
import { getServerContext } from '../context.js';
import { broadcast } from '../ws/handler.js';

export const presetsRouter = new Hono();

// ── MCP Presets ──

presetsRouter.get('/mcp', (c) => {
  const presets = listMcpPresets();
  const { mcpManager } = getServerContext();
  const installedNames = new Set(mcpManager.getConfigs().map((cfg) => cfg.name));

  return c.json({
    presets: presets.map((p) => ({
      ...p,
      installed: installedNames.has(p.name),
    })),
  });
});

presetsRouter.post('/mcp/:id/enable', async (c) => {
  const id = c.req.param('id');
  const preset = getMcpPreset(id);
  if (!preset) return c.json({ error: 'Preset not found' }, 404);

  const { mcpManager, settingsRepo, logger } = getServerContext();
  const configs = mcpManager.getConfigs();

  // 检查是否已安装
  if (configs.some((cfg) => cfg.name === preset.name)) {
    return c.json({ error: 'Already installed', name: preset.name }, 409);
  }

  // 替换模板变量（如 {{CABINET_DIR}}）
  const resolvedArgs = preset.args.map((arg) =>
    arg.replace(/\{\{CABINET_DIR\}\}/g, process.env.CABINET_DIR ?? process.cwd()),
  );

  const newConfig = {
    name: preset.name,
    transport: preset.transport,
    command: preset.command,
    args: resolvedArgs,
    enabled: true,
    env: preset.env,
  };

  const updated = [...configs, newConfig];

  // 持久化
  settingsRepo.set('mcp_servers', JSON.stringify(updated));

  // 写入 settings.json（兼容现有逻辑）
  const { saveSettings } = await import('../routes/settings.js');
  saveSettings({ mcpServers: updated });

  // 连接
  try {
    await mcpManager.updateConfigs(updated);
    broadcast('mcp_server_changed', { action: 'added', name: preset.name });
    logger.info('MCP preset enabled', { presetId: id, name: preset.name });
    return c.json({ status: 'enabled', name: preset.name, toolCount: mcpManager.listTools().length });
  } catch (e) {
    logger.error('MCP preset enable failed', { presetId: id, error: String(e) });
    return c.json({ error: 'Connection failed', details: (e as Error).message }, 500);
  }
});

// ── Skill Presets ──

presetsRouter.get('/skills', (c) => {
  const presets = listSkillPresets();
  const { skillRegistry } = getServerContext();
  const installedNames = new Set(skillRegistry.listNames());

  return c.json({
    presets: presets.map((p) => ({
      ...p,
      // 不返回完整 body（太大），只返回前 200 字符预览
      bodyPreview: p.body.slice(0, 200) + (p.body.length > 200 ? '...' : ''),
      body: undefined,
      installed: installedNames.has(p.name),
    })),
  });
});

presetsRouter.post('/skills/:id/install', async (c) => {
  const id = c.req.param('id');
  const preset = getSkillPreset(id);
  if (!preset) return c.json({ error: 'Preset not found' }, 404);

  const { skillRegistry, skillRepo, logger } = getServerContext();

  // 检查是否已安装
  if (skillRegistry.load(preset.name)) {
    return c.json({ error: 'Already installed', name: preset.name }, 409);
  }

  // 写入文件系统（触发 watcher 自动加载）
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { CABINET_DIR } = await import('@cabinet/storage');
  const skillDir = join(CABINET_DIR, 'skills', preset.name);
  mkdirSync(skillDir, { recursive: true });

  // 重构 SKILL.md 内容
  const skillMd = `---
name: ${preset.name}
description: ${preset.description}
kind: ${preset.kind}
version: ${preset.version}
category: ${preset.category}
tags: ${JSON.stringify(preset.tags)}
icon: ${preset.icon}
---

${preset.body}
`;
  writeFileSync(join(skillDir, 'SKILL.md'), skillMd, 'utf-8');

  // watcher 会在 500ms 内自动发现并注册
  // 但为了即时反馈，手动注册
  const skillId = `skill_preset_${Date.now()}`;
  skillRegistry.register({
    id: skillId,
    name: preset.name,
    description: preset.description,
    kind: preset.kind as any,
    promptTemplate: preset.body,
    inputSchema: {},
    outputSchema: {},
    version: preset.version,
    status: 'active',
  });

  skillRepo.insert({
    id: skillId,
    name: preset.name,
    description: preset.description,
    kind: preset.kind,
    input_schema: '{}',
    output_schema: '{}',
    prompt_template: preset.body,
    version: preset.version,
    status: 'active',
    metadata: JSON.stringify({ source: 'preset', presetId: id }),
  });

  broadcast('skill_created', { id: skillId, name: preset.name, source: 'preset' });
  logger.info('Skill preset installed', { presetId: id, name: preset.name });

  return c.json({ status: 'installed', name: preset.name, id: skillId });
});
```

#### 2.2.3 注册路由

在 `apps/server/src/index.ts` 中添加：

```typescript
import { presetsRouter } from './routes/presets.js';

// ... 其他路由 ...
app.route('/api/presets', presetsRouter);
```

---

### 2.3 前端：McpTab 改造

#### 2.3.1 新增 PresetCard 组件

在 `apps/desktop/src/components/` 下新建（或内联在 Tab 中）：

```tsx
// PresetCard 内联组件（若 @cabinet/ui 未提供 Switch/Icon 等）
interface PresetCardProps {
  id: string;
  displayName: string;
  description: string;
  category: string;
  tags: string[];
  icon: string;
  installed: boolean;
  onEnable: () => void;
  onDisable?: () => void;
  setupNotes?: string;
}

function PresetCard({ displayName, description, icon, installed, onEnable, setupNotes }: PresetCardProps) {
  return (
    <Card padding="sm" className="flex flex-col gap-2">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{icon}</span>
          <span className="text-sm font-medium text-content-primary">{displayName}</span>
        </div>
        {installed ? (
          <Tag variant="success">Installed</Tag>
        ) : (
          <Button size="xs" onClick={onEnable}>Enable</Button>
        )}
      </div>
      <p className="text-xs text-content-tertiary line-clamp-2">{description}</p>
      {setupNotes && !installed && (
        <p className="text-xs text-content-tertiary">{setupNotes}</p>
      )}
    </Card>
  );
}
```

#### 2.3.2 McpTab 新增预设区域

在现有列表上方添加"Recommended"区域：

```tsx
// McpTab.tsx 新增 state 和 effect
const [presets, setPresets] = useState<McpPreset[]>([]);
const [loadingPreset, setLoadingPreset] = useState<string | null>(null);

useEffect(() => {
  apiFetch('/api/presets/mcp', { headers: authHeaders() })
    .then((r) => r.json())
    .then((d) => setPresets(d.presets ?? []))
    .catch(() => setPresets([]));
}, []);

const handleEnablePreset = async (id: string) => {
  setLoadingPreset(id);
  try {
    const r = await apiFetch(`/api/presets/mcp/${id}/enable`, {
      method: 'POST',
      headers: authHeaders(),
    });
    if (r.ok) {
      fetchServers();
      setPresets((prev) => prev.map((p) => (p.id === id ? { ...p, installed: true } : p)));
    }
  } finally {
    setLoadingPreset(null);
  }
};

// 在 return 中，servers 列表之前插入：
{presets.length > 0 && (
  <>
    <h3 className="mb-2 text-sm font-medium text-content-secondary">Recommended MCP Servers</h3>
    <div className="mb-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
      {presets.map((p) => (
        <PresetCard
          key={p.id}
          {...p}
          onEnable={() => handleEnablePreset(p.id)}
        />
      ))}
    </div>
  </>
)}
```

**注意**：若 `@cabinet/ui` 无 `grid` 相关 class，用 `flex flex-wrap gap-2` 替代。

---

### 2.4 前端：SkillsTab 改造

与 McpTab 类似，在现有列表上方添加"Recommended Skills"区域：

```tsx
// SkillsTab.tsx 新增
const [presets, setPresets] = useState<SkillPreset[]>([]);

useEffect(() => {
  apiFetch('/api/presets/skills', { headers: authHeaders() })
    .then((r) => r.json())
    .then((d) => setPresets(d.presets ?? []))
    .catch(() => setPresets([]));
}, []);

const handleInstallPreset = async (id: string) => {
  const r = await apiFetch(`/api/presets/skills/${id}/install`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (r.ok) {
    fetchSkills();
    setPresets((prev) => prev.map((p) => (p.id === id ? { ...p, installed: true } : p)));
  }
};
```

---

### 2.5 首次启动引导（Onboarding）

#### 2.5.1 检测首次运行

```typescript
// apps/server/src/services/onboarding-service.ts
import { getServerContext } from '../context.js';

export function isFirstRun(): boolean {
  const { settingsRepo, mcpManager, skillRegistry } = getServerContext();

  // 没有配置过任何 MCP，且没有用户自定义 skill（排除内置 skill）
  const hasMcp = mcpManager.getConfigs().length > 0;
  const hasCustomSkills = skillRegistry.listNames().some((n) => !n.startsWith('builtin_'));
  const onboardingDone = settingsRepo.get('onboarding_done') === 'true';

  return !onboardingDone && !hasMcp && !hasCustomSkills;
}

export function markOnboardingDone(): void {
  const { settingsRepo } = getServerContext();
  settingsRepo.set('onboarding_done', 'true');
}
```

#### 2.5.2 后端 API

```typescript
// presets.ts 中新增
presetsRouter.get('/onboarding', (c) => {
  return c.json({ isFirstRun: isFirstRun() });
});

presetsRouter.post('/onboarding/complete', (c) => {
  markOnboardingDone();
  return c.json({ status: 'ok' });
});
```

#### 2.5.3 前端 Onboarding Modal

新建 `apps/desktop/src/components/OnboardingModal.tsx`：

```tsx
import { useState, useEffect } from 'react';
import { Button, Card } from '@cabinet/ui';
import { apiFetch, authHeaders, authJsonHeaders } from '../utils/pin.js';

export function OnboardingModal() {
  const [show, setShow] = useState(false);
  const [step, setStep] = useState(0);
  const [selectedMcps, setSelectedMcps] = useState<string[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);

  useEffect(() => {
    apiFetch('/api/presets/onboarding', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setShow(d.isFirstRun));
  }, []);

  if (!show) return null;

  const steps = [
    { title: 'Welcome to Cabinet', content: '...' },
    { title: 'Enable Core Tools', content: <McpPresetSelector ... /> },
    { title: 'Install Skills', content: <SkillPresetSelector ... /> },
    { title: 'Ready', content: '...' },
  ];

  // ... 引导流程 UI ...
}
```

**简版**：首次运行时在 Chat 界面顶部显示横幅：

```tsx
// ChatView.tsx 或 App.tsx 中
{showOnboardingBanner && (
  <div className="rounded-lg bg-accent-muted p-4">
    <p className="text-sm font-medium">Welcome! Get started by enabling recommended tools.</p>
    <Button size="sm" onClick={() => navigate('/settings?tab=mcp')}>
      Quick Setup
    </Button>
  </div>
)}
```

---

### 2.6 预设内容清单（Phase 1 MVP）

#### MCP 预设（8 个）

| ID | 名称 | 类别 | 命令 | 说明 |
|----|------|------|------|------|
| filesystem | File System | essential | `npx -y @modelcontextprotocol/server-filesystem {{dir}}` | 本地文件读写 |
| fetch | Fetch | essential | `npx -y @modelcontextprotocol/server-fetch` | HTTP 请求 |
| github | GitHub | dev | `npx -y @modelcontextprotocol/server-github` | 需要 GITHUB_TOKEN |
| sqlite | SQLite | data | `npx -y @modelcontextprotocol/server-sqlite` | 数据库查询 |
| puppeteer | Puppeteer | dev | `npx -y @modelcontextprotocol/server-puppeteer` | 浏览器自动化 |
| slack | Slack | communication | `npx -y @modelcontextprotocol/server-slack` | 需要 SLACK_TOKEN |
| postgres | PostgreSQL | data | `npx -y @modelcontextprotocol/server-postgres` | 需要连接字符串 |
| brave-search | Brave Search | productivity | `npx -y @modelcontextprotocol/server-brave-search` | 需要 BRAVE_API_KEY |

#### Skill 预设（5 个）

| ID | 名称 | 类别 | 说明 |
|----|------|------|------|
| code-reviewer | Code Reviewer | dev | 代码审查、bug 和安全检测 |
| doc-writer | Doc Writer | productivity | 技术文档、README、API 文档生成 |
| api-designer | API Designer | dev | REST/GraphQL API 设计、OpenAPI 生成 |
| test-writer | Test Writer | dev | 单元测试、集成测试生成 |
| pr-reviewer | PR Reviewer | dev | Pull Request 综合审查 |

---

### 2.7 Phase 1 工时分解

| 任务 | 工时 | 说明 |
|------|------|------|
| 预设 JSON / SKILL.md 文件编写 | 4h | 8 个 MCP + 5 个 Skill 的内容 |
| `preset-service.ts` | 2h | 读取、列表、查询 |
| `presets.ts` 路由 | 3h | 4 个端点 + 错误处理 |
| McpTab UI 改造 | 3h | PresetCard + 推荐区域 |
| SkillsTab UI 改造 | 2h | 类似 McpTab |
| Onboarding 横幅/弹窗 | 3h | 首次检测 + 引导 UI |
| 构建脚本调整 | 1h | 确保 presets 目录被打包到 server-dist |
| 测试 | 4h | API 测试 + UI 交互测试 |
| 文档 | 2h | 预设编写指南 |
| **合计** | **24h** | |

---

## 三、Phase 2 — Discover UI（发现页）

**目标**：为用户提供统一的发现/浏览/搜索体验，不仅限于预设，还支持远程索引（可选联网）。  
**分支名**: `feature/discover-phase2`（基于 Phase 1 分支）  
**工时**: ~16 小时

---

### 3.1 新增 DiscoverTab

#### 3.1.1 路由结构调整

SettingsPage 改为包含 Discover：

```tsx
// SettingsPage.tsx
// 或新增独立页面：apps/desktop/src/pages/DiscoverPage.tsx

type SettingsTab = 'rules' | 'skills' | 'mcp' | 'api' | 'discover' | 'others';

const tabLabels: Record<SettingsTab, string> = {
  // ...
  discover: 'Discover',
  // ...
};
```

**更优方案**：Discover 不作为 Settings 的子 tab，而是作为独立入口（顶部导航或侧边栏）：

```tsx
// Navigation.tsx 新增 "Discover" 页面
{ id: 'discover', label: 'Discover', icon: '🔍' },
```

#### 3.1.2 DiscoverTab 组件

```tsx
// apps/desktop/src/pages/DiscoverPage.tsx
import { useState, useEffect } from 'react';
import { Button, Input, Card, Tag, Tabs } from '@cabinet/ui';

// 分类标签
type Category = 'all' | 'essential' | 'dev' | 'productivity' | 'communication' | 'data';

export function DiscoverPage() {
  const [activeTab, setActiveTab] = useState<'mcp' | 'skills'>('mcp');
  const [category, setCategory] = useState<Category>('all');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<PresetItem[]>([]);

  // 同时加载 MCP 和 Skill 预设
  useEffect(() => {
    Promise.all([
      apiFetch('/api/presets/mcp', { headers: authHeaders() }).then((r) => r.json()),
      apiFetch('/api/presets/skills', { headers: authHeaders() }).then((r) => r.json()),
    ]).then(([mcpData, skillData]) => {
      const merged = [
        ...(mcpData.presets ?? []).map((p) => ({ ...p, type: 'mcp' as const })),
        ...(skillData.presets ?? []).map((p) => ({ ...p, type: 'skill' as const })),
      ];
      setItems(merged);
    });
  }, []);

  const filtered = items.filter((item) => {
    const matchesTab = activeTab === 'all' || item.type === activeTab;
    const matchesCategory = category === 'all' || item.category === category;
    const matchesSearch =
      search === '' ||
      item.displayName.toLowerCase().includes(search.toLowerCase()) ||
      item.description.toLowerCase().includes(search.toLowerCase()) ||
      item.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()));
    return matchesTab && matchesCategory && matchesSearch;
  });

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="mb-4 text-2xl font-bold text-content-primary">Discover</h1>
      <p className="mb-6 text-sm text-content-tertiary">
        Browse and install MCP servers and skills to extend Cabinet's capabilities.
      </p>

      {/* Search + Filter */}
      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as Category)}
          className="rounded-sm border border-border bg-surface-primary px-3 py-2 text-sm"
        >
          <option value="all">All Categories</option>
          <option value="essential">Essential</option>
          <option value="dev">Development</option>
          <option value="productivity">Productivity</option>
          <option value="communication">Communication</option>
          <option value="data">Data</option>
        </select>
      </div>

      {/* Tabs */}
      <Tabs
        tabs={[
          { id: 'mcp', label: `MCP Servers (${items.filter((i) => i.type === 'mcp').length})` },
          { id: 'skills', label: `Skills (${items.filter((i) => i.type === 'skill').length})` },
        ]}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as 'mcp' | 'skills')}
        className="mb-4"
      />

      {/* Grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((item) => (
          <DiscoverCard key={item.id} {...item} />
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="py-8 text-center text-sm text-content-tertiary">No results found.</p>
      )}
    </div>
  );
}
```

#### 3.1.3 DiscoverCard 组件

比 PresetCard 更丰富的展示：

```tsx
function DiscoverCard(item: PresetItem) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card padding="md" className="flex flex-col">
      <div className="flex items-start gap-3">
        <span className="text-2xl">{item.icon}</span>
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-content-primary">{item.displayName}</span>
            {item.installed ? (
              <Tag variant="success" size="sm">Installed</Tag>
            ) : (
              <Button size="xs" onClick={() => handleInstall(item)}>Install</Button>
            )}
          </div>
          <p className="mt-1 text-xs text-content-tertiary">{item.description}</p>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {item.tags.map((t) => (
          <span key={t} className="rounded-sm bg-surface-elevated px-1.5 py-0.5 text-xs text-content-tertiary">
            {t}
          </span>
        ))}
      </div>

      {item.type === 'mcp' && item.setupNotes && (
        <div className="mt-2 rounded-sm bg-intent-warning-muted px-2 py-1 text-xs text-intent-warning">
          {item.setupNotes}
        </div>
      )}

      {item.type === 'skill' && item.bodyPreview && (
        <div className="mt-2">
          <button
            className="text-xs text-accent"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? 'Hide preview' : 'Show preview'}
          </button>
          {expanded && (
            <pre className="mt-1 max-h-32 overflow-auto rounded-sm bg-surface-elevated p-2 text-xs text-content-tertiary">
              {item.bodyPreview}
            </pre>
          )}
        </div>
      )}
    </Card>
  );
}
```

---

### 3.2 远程索引（可选联网）

#### 3.2.1 索引格式

```json
// 托管于 GitHub raw 的 registry.json
{
  "version": 1,
  "updatedAt": "2026-06-01",
  "mcpServers": [
    {
      "id": "community-mcp-linear",
      "displayName": "Linear",
      "description": "Manage issues and projects in Linear",
      "category": "productivity",
      "tags": ["project-management", "issues"],
      "icon": "📋",
      "command": "npx",
      "args": ["-y", "@linear/mcp-server"],
      "setupNotes": "Requires LINEAR_API_KEY environment variable",
      "sourceUrl": "https://github.com/linear/mcp-server"
    }
  ],
  "skills": [
    {
      "id": "community-skill-refactor",
      "name": "refactor-expert",
      "displayName": "Refactoring Expert",
      "description": "Identify code smells and suggest refactoring strategies",
      "category": "dev",
      "tags": ["refactoring", "clean-code"],
      "icon": "🧹",
      "sourceUrl": "https://raw.githubusercontent.com/user/repo/main/skills/refactor/SKILL.md"
    }
  ]
}
```

#### 3.2.2 后端代理 API

为避免 CORS 和隐私问题，通过 Cabinet server 代理请求：

```typescript
// presets.ts 新增
presetsRouter.get('/remote-index', async (c) => {
  const { logger } = getServerContext();
  const indexUrl = 'https://raw.githubusercontent.com/VanDING/Cabinet/main/registry/index.json';

  try {
    const res = await fetch(indexUrl, {
      headers: { 'User-Agent': 'Cabinet/2.0' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return c.json(data);
  } catch (e) {
    logger.warn('Remote index fetch failed', { error: String(e) });
    return c.json({ mcpServers: [], skills: [] }); // 静默失败，回退到仅本地预设
  }
});
```

#### 3.2.3 前端合并本地 + 远程

```tsx
// DiscoverPage.tsx
const [remoteItems, setRemoteItems] = useState<RemoteItem[]>([]);

useEffect(() => {
  apiFetch('/api/presets/remote-index', { headers: authHeaders() })
    .then((r) => r.json())
    .then((data) => {
      setRemoteItems([
        ...(data.mcpServers ?? []).map((i) => ({ ...i, type: 'mcp', isRemote: true })),
        ...(data.skills ?? []).map((i) => ({ ...i, type: 'skill', isRemote: true })),
      ]);
    })
    .catch(() => setRemoteItems([]));
}, []);

// 合并本地 + 远程，去重（以 id 为准）
const allItems = mergeById([...localItems, ...remoteItems]);
```

---

### 3.3 从远程安装 Skill

```typescript
// presets.ts 新增
presetsRouter.post('/skills/install-remote', async (c) => {
  const body = await c.req.json();
  const { sourceUrl, name } = body;

  // 下载 SKILL.md
  const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) return c.json({ error: 'Download failed' }, 502);

  const content = await res.text();
  const parsed = parseSkillMarkdown(content);
  if (!parsed) return c.json({ error: 'Invalid SKILL.md format' }, 400);

  // 后续流程同本地 preset 安装...
});
```

---

### 3.4 Phase 2 工时分解

| 任务 | 工时 | 说明 |
|------|------|------|
| DiscoverPage 组件 | 4h | 搜索、过滤、Tab 切换、Grid 布局 |
| DiscoverCard 组件 | 2h | 展开预览、安装状态、标签 |
| 远程索引 API | 2h | 代理请求 + 错误处理 |
| 远程 Skill 安装 | 2h | URL 下载 + 验证 |
| Navigation 新增入口 | 1h | 顶部/侧边栏 Discover 入口 |
| 注册表 JSON 模板 | 2h | GitHub repo 中的 registry 结构 |
| 测试 | 2h | 搜索过滤、远程安装失败场景 |
| 文档 | 1h | 社区贡献指南 |
| **合计** | **16h** | |

---

## 四、两阶段合并后的完整 API 清单

| Method | Route | 描述 | Phase |
|--------|-------|------|-------|
| GET | `/api/presets/mcp` | 列出 MCP 预设（含 installed 标记） | 1 |
| POST | `/api/presets/mcp/:id/enable` | 启用指定 MCP 预设 | 1 |
| GET | `/api/presets/skills` | 列出 Skill 预设（含 installed 标记） | 1 |
| POST | `/api/presets/skills/:id/install` | 安装指定 Skill 预设 | 1 |
| GET | `/api/presets/onboarding` | 检测是否首次运行 | 1 |
| POST | `/api/presets/onboarding/complete` | 标记 onboarding 完成 | 1 |
| GET | `/api/presets/remote-index` | 获取远程注册表索引 | 2 |
| POST | `/api/presets/skills/install-remote` | 从远程 URL 安装 Skill | 2 |

---

## 五、文件变更清单

### 新增文件

```
apps/server/src/services/preset-service.ts        # 预设读取服务
apps/server/src/routes/presets.ts                  # 预设 API 路由
apps/server/src/presets/mcp/*.json                 # MCP 预设配置（8 个）
apps/server/src/presets/skills/*/SKILL.md          # Skill 预设（5 个）
apps/server/src/services/onboarding-service.ts     # 首次运行检测
apps/desktop/src/pages/DiscoverPage.tsx            # Phase 2 发现页
apps/desktop/src/components/OnboardingModal.tsx    # 首次引导弹窗（可选）
```

### 修改文件

```
apps/server/src/index.ts                           # + presetsRouter 注册
apps/server/src/routes/settings.ts                 # export saveSettings
apps/desktop/src/pages/settings/McpTab.tsx         # + 推荐预设区域
apps/desktop/src/pages/settings/SkillsTab.tsx      # + 推荐预设区域
apps/desktop/src/pages/SettingsPage.tsx            # + Discover tab（若放入 Settings）
apps/desktop/src/App.tsx                           # + Discover 路由 + OnboardingBanner
apps/desktop/src/components/Navigation.tsx         # + Discover 入口
scripts/copy-server.mjs                            # + presets 目录复制
```

---

## 六、与现有修复计划的协调

| 优先级 | 任务 | 依赖 |
|--------|------|------|
| P0 | 安全漏洞修复（Phase 0） | 无 |
| P0 | God File 拆分 | 无 |
| P1 | **Phase 1 内置预设** | 安全修复完成后 |
| P1 | Phase 1 功能修复（FallbackChain 等） | 无 |
| P2 | **Phase 2 Discover UI** | Phase 1 完成后 |
| P2 | 性能优化（连接池等） | Phase 1 完成后 |
| P3 | 测试补全 | 持续进行 |

**建议的合并策略**：
1. 安全修复 PR 合并到 main
2. 从 main 切出 `feature/presets-phase1`
3. Phase 1 完成后合并到 main，发布新版本
4. 从 main 切出 `feature/discover-phase2`

---

*计划结束。Phase 1 的核心设计是"利用现有机制"——预设安装本质上是对现有 `updateConfigs` 和文件 watcher 的包装，不引入新的持久化或执行模型。*
