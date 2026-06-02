# Cabinet 内置精选 + Discover UI 实现计划（修订版 v1.1）

> **修订日期**: 2026-06-01  
> **范围**: `apps/server` (后端预设系统) + `apps/desktop` (前端 UI 重构)  
> **预计总工时**: ~36 小时 (Phase 1: 20h + Phase 2: 16h)

---

## 一、修订说明

本次修订基于以下决策：

1. **Discover 放在侧边栏**，作为独立顶级导航项，而非 Settings 的子 tab
2. **Discover 仅包含 MCP Servers + Skills**（2 Tabs），不含 Agents（Agents 在 Employees 页面管理）
3. **MCP 和 Skills 的管理功能从 Settings 迁移至 Discover**，Settings 仅保留系统配置
4. **Settings 实际结构**：Rules / API Keys（含 Budget）/ Others（含 Backup, Theme, Maintenance, Audit, Delegation）
5. **信息架构对齐**：Discover = 扩展中心，Settings = 系统配置，Employees = Agent 管理

---

## 二、信息架构总览

### 侧边栏导航

```
┌─────────────┐
│  ⚡ Office   │  ← 聊天主界面
│  🏭 Factory  │  ← 工作流
│  👥 Employees│  ← Agent 管理（含自定义 Agents）
│  🧠 Memory   │  ← 记忆/知识库
│  🔍 Discover │  ← 扩展中心：MCP + Skills（新增）
│─────────────│
│  Projects... │
│─────────────│
│  ⚙️ Settings │  ← 系统配置
└─────────────┘
```

### Discover 页面内部（2 Tabs）

```
[MCP Servers] [Skills]

── Installed ─────────────────────────────
☑ filesystem    ● connected   [Disable] [Test] [Remove]
☑ github        ● connected   [Disable] [Test] [Remove]
☐ slack         ○ disabled    [Enable]  [Test] [Remove]

+ Add Custom Server

── Recommended ───────────────────────────
[Enable] File System    📁 本地文件读写
[Enable] Fetch          🌐 HTTP 请求
[Enable] GitHub         🔧 代码仓库（需 TOKEN）
[Enable] Slack          💬 团队沟通（需 TOKEN）
...
```

每个 Tab 内部是**上下分区**：上半为已安装列表（管理功能），下半为推荐/发现（安装功能）。

### Settings 页面（3 Tabs）

```
[Rules] [API Keys] [Others]

Rules:    系统规则配置
API Keys: LLM 提供商密钥 + 预算控制（Budget 已合并）
Others:   主题 / 备份 / 维护 / 审计 / 授权层级
```

---

## 三、Phase 1 — 内置精选预设（冷启动）

**目标**：新用户首次打开 Cabinet，5 分钟内启用核心 MCP + Skill，无需手动填写配置。  
**分支名**: `feature/presets-phase1`  
**工时**: ~20 小时

---

### 3.1 数据层：预设目录结构

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

#### MCP 预设 JSON 格式

与现有 `MCPServerConfig` 兼容，增加展示字段：

```json
{
  "id": "preset-mcp-filesystem",
  "name": "filesystem",
  "displayName": "File System",
  "description": "Read, write, and manage files on your local machine.",
  "category": "essential",
  "tags": ["files", "local", "essential"],
  "icon": "📁",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "{{CABINET_DIR}}"],
  "enabled": true,
  "env": {},
  "setupNotes": "Requires Node.js and npx."
}
```

#### Skill 预设格式

标准 SKILL.md，增加 `category`/`tags`/`icon` frontmatter 字段用于展示：

```markdown
---
name: code-reviewer
description: Review code for bugs and style issues...
kind: prompt
version: 1
category: dev
tags: [code, review, quality]
icon: 🔍
---

# Code Reviewer
...
```

---

### 3.2 后端：预设服务模块

#### 3.2.1 `apps/server/src/services/preset-service.ts`

```typescript
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MCPServerConfig } from '../mcp/mcp-manager.js';
import { parseSkillMarkdown } from '@cabinet/agent';

const PRESETS_DIR = join(fileURLToPath(import.meta.url), '../../presets');

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
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf-8')) as McpPreset)
    .sort((a, b) => {
      if (a.category === 'essential' && b.category !== 'essential') return -1;
      if (b.category === 'essential' && a.category !== 'essential') return 1;
      return a.displayName.localeCompare(b.displayName);
    });
}

export function getMcpPreset(id: string): McpPreset | null {
  return listMcpPresets().find((p) => p.id === id) ?? null;
}

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

#### 3.2.2 `apps/server/src/routes/presets.ts`

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
    presets: presets.map((p) => ({ ...p, installed: installedNames.has(p.name) })),
  });
});

presetsRouter.post('/mcp/:id/enable', async (c) => {
  const id = c.req.param('id');
  const preset = getMcpPreset(id);
  if (!preset) return c.json({ error: 'Preset not found' }, 404);

  const { mcpManager, settingsRepo, logger } = getServerContext();
  const configs = mcpManager.getConfigs();

  if (configs.some((cfg) => cfg.name === preset.name)) {
    return c.json({ error: 'Already installed', name: preset.name }, 409);
  }

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

  settingsRepo.set('mcp_servers', JSON.stringify(updated));
  const { saveSettings } = await import('../routes/settings.js');
  saveSettings({ mcpServers: updated });

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
  if (skillRegistry.load(preset.name)) {
    return c.json({ error: 'Already installed', name: preset.name }, 409);
  }

  const { writeFileSync, mkdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { CABINET_DIR } = await import('@cabinet/storage');
  const skillDir = join(CABINET_DIR, 'skills', preset.name);
  mkdirSync(skillDir, { recursive: true });

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

#### 3.2.3 注册路由

在 `apps/server/src/index.ts` 中添加：

```typescript
import { presetsRouter } from './routes/presets.js';
app.route('/api/presets', presetsRouter);
```

---

### 3.3 前端：Navigation 组件修改

#### 3.3.1 `packages/ui/src/navigation.tsx`

```typescript
import { Puzzle } from 'lucide-react'; // 新增图标

export type NavPage = 'office' | 'factory' | 'employees' | 'memory' | 'discover' | 'settings';

const navItems: { id: NavPage; label: string }[] = [
  { id: 'office', label: 'Office' },
  { id: 'factory', label: 'Factory' },
  { id: 'employees', label: 'Employees' },
  { id: 'memory', label: 'Memory' },
  { id: 'discover', label: 'Discover' }, // ← 新增
];

const navIcons: Partial<Record<NavPage, typeof Command>> = {
  office: Command,
  factory: Workflow,
  employees: UserRound,
  memory: Brain,
  discover: Puzzle, // ← 新增
};
```

---

### 3.4 前端：DiscoverPage（Phase 1 基础版）

新建 `apps/desktop/src/pages/DiscoverPage.tsx`：

```tsx
import { useState, useEffect } from 'react';
import { Button, Card, Tag, Tabs } from '@cabinet/ui';
import { apiFetch, authHeaders, authJsonHeaders } from '../utils/pin.js';

export function DiscoverPage() {
  const [activeTab, setActiveTab] = useState<'mcp' | 'skills'>('mcp');

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="mb-4 text-2xl font-bold text-content-primary">Discover</h1>
      <p className="mb-6 text-sm text-content-tertiary">
        Manage and install MCP servers and skills.
      </p>

      <Tabs
        tabs={[
          { id: 'mcp', label: 'MCP Servers' },
          { id: 'skills', label: 'Skills' },
        ]}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as 'mcp' | 'skills')}
        className="mb-4"
      />

      {activeTab === 'mcp' && <McpDiscoverSection />}
      {activeTab === 'skills' && <SkillDiscoverSection />}
    </div>
  );
}
```

#### McpDiscoverSection（上下分区）

```tsx
function McpDiscoverSection() {
  const [installed, setInstalled] = useState<MCPServer[]>([]);
  const [presets, setPresets] = useState<McpPreset[]>([]);
  const [showForm, setShowForm] = useState(false);

  const fetchData = () => {
    // 已安装列表
    apiFetch('/api/settings/mcp-servers', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        const configs = d.configs ?? [];
        const statuses = d.servers ?? [];
        setInstalled(
          configs.map((c: any) => {
            const s = statuses.find((st: any) => st.name === c.name);
            return { ...c, status: s?.connected ? 'connected' : 'disconnected', toolCount: s?.toolCount ?? 0 };
          }),
        );
      });
    // 预设列表
    apiFetch('/api/presets/mcp', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setPresets(d.presets ?? []));
  };

  useEffect(() => { fetchData(); }, []);

  const handleEnable = async (id: string) => {
    await apiFetch(`/api/presets/mcp/${id}/enable`, { method: 'POST', headers: authHeaders() });
    fetchData();
  };

  const handleToggle = async (name: string) => {
    const updated = installed.map((s) => (s.name === name ? { ...s, enabled: !s.enabled } : s));
    await apiFetch('/api/settings/mcp-servers', {
      method: 'PUT',
      headers: authJsonHeaders(),
      body: JSON.stringify({ configs: updated }),
    });
    fetchData();
  };

  const handleRemove = async (name: string) => {
    const updated = installed.filter((s) => s.name !== name);
    await apiFetch('/api/settings/mcp-servers', {
      method: 'PUT',
      headers: authJsonHeaders(),
      body: JSON.stringify({ configs: updated }),
    });
    fetchData();
  };

  return (
    <div className="space-y-6">
      {/* 上半：已安装 */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-content-secondary">Installed Servers</h2>
          <Button size="sm" variant="ghost" onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : '+ Add Custom'}
          </Button>
        </div>

        {showForm && <McpAddForm onAdded={fetchData} onCancel={() => setShowForm(false)} />}

        {installed.length === 0 ? (
          <p className="py-4 text-sm text-content-tertiary">No MCP servers installed.</p>
        ) : (
          <div className="space-y-2">
            {installed.map((s) => (
              <Card key={s.name} padding="sm" className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-content-primary">{s.name}</span>
                    <Tag variant={s.enabled ? 'success' : 'default'}>{s.enabled ? 'enabled' : 'disabled'}</Tag>
                    {s.status && <Tag variant={s.status === 'connected' ? 'info' : 'danger'}>{s.status}</Tag>}
                  </div>
                  <p className="mt-0.5 font-mono text-xs text-content-tertiary">{s.command} {s.args?.join(' ')}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="xs" onClick={() => handleToggle(s.name)}>
                    {s.enabled ? 'Disable' : 'Enable'}
                  </Button>
                  <Button variant="ghost" size="xs" className="text-intent-danger" onClick={() => handleRemove(s.name)}>
                    Remove
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* 下半：推荐 */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-content-secondary">Recommended</h2>
        <div className="flex flex-col gap-2">
          {presets.filter((p) => !p.installed).map((p) => (
            <Card key={p.id} padding="sm" className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">{p.icon}</span>
                <div>
                  <span className="text-sm font-medium text-content-primary">{p.displayName}</span>
                  <p className="text-xs text-content-tertiary">{p.description}</p>
                </div>
              </div>
              <Button size="xs" onClick={() => handleEnable(p.id)}>Enable</Button>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
```

#### SkillDiscoverSection（上下分区）

```tsx
function SkillDiscoverSection() {
  const [installed, setInstalled] = useState<SkillItem[]>([]);
  const [presets, setPresets] = useState<SkillPreset[]>([]);

  const fetchData = () => {
    apiFetch('/api/skills', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setInstalled(d.skills ?? []));
    apiFetch('/api/presets/skills', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setPresets(d.presets ?? []));
  };

  useEffect(() => { fetchData(); }, []);

  const handleInstall = async (id: string) => {
    await apiFetch(`/api/presets/skills/${id}/install`, { method: 'POST', headers: authHeaders() });
    fetchData();
  };

  const handleDelete = async (id: string) => {
    await apiFetch(`/api/skills/${id}`, { method: 'DELETE', headers: authHeaders() });
    fetchData();
  };

  return (
    <div className="space-y-6">
      {/* 上半：已安装 */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-content-secondary">Installed Skills</h2>
        {installed.length === 0 ? (
          <p className="py-4 text-sm text-content-tertiary">No skills installed.</p>
        ) : (
          <div className="space-y-2">
            {installed.map((s) => (
              <Card key={s.id} padding="sm" className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-content-primary">{s.name}</span>
                    <Tag variant={s.status === 'active' ? 'success' : 'warning'}>{s.status}</Tag>
                  </div>
                  <p className="text-xs text-content-tertiary">{s.description}</p>
                </div>
                <Button variant="ghost" size="xs" className="text-intent-danger" onClick={() => handleDelete(s.id)}>
                  Remove
                </Button>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* 下半：推荐 */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-content-secondary">Recommended</h2>
        <div className="flex flex-col gap-2">
          {presets.filter((p) => !p.installed).map((p) => (
            <Card key={p.id} padding="sm" className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">{p.icon}</span>
                <div>
                  <span className="text-sm font-medium text-content-primary">{p.displayName}</span>
                  <p className="text-xs text-content-tertiary">{p.description}</p>
                </div>
              </div>
              <Button size="xs" onClick={() => handleInstall(p.id)}>Install</Button>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
```

---

### 3.5 前端：SettingsPage 瘦身

修改 `apps/desktop/src/pages/SettingsPage.tsx`：

```tsx
type SettingsTab = 'rules' | 'api' | 'others'; // 移除 'skills' 和 'mcp'

const tabLabels: Record<SettingsTab, string> = {
  rules: 'Rules',
  api: 'API Keys',
  others: 'Others',
};
```

`apps/desktop/src/pages/settings/index.ts` 移除导出：

```typescript
// 移除以下导出（功能已迁移到 DiscoverPage）
// export { SkillsTab } from './SkillsTab.js';
// export { McpTab } from './McpTab.js';

// 保留
export { RulesTab } from './RulesTab.js';
export { ApiKeysTab } from './ApiKeysTab.js';
export { OthersTab } from './OthersTab.js';
// ... 其他
```

---

### 3.6 前端：App.tsx 路由调整

```tsx
const DiscoverPage = lazy(() =>
  import('./pages/DiscoverPage').then((m) => ({ default: m.DiscoverPage })),
);

// Routes 中新增
<Route path="/discover" element={<DiscoverPage />} />
<Route path="/skills" element={<Navigate to="/discover" replace />} />
```

---

### 3.7 首次启动引导（Onboarding）

```typescript
// apps/server/src/services/onboarding-service.ts
export function isFirstRun(): boolean {
  const { settingsRepo, mcpManager, skillRegistry } = getServerContext();
  const hasMcp = mcpManager.getConfigs().length > 0;
  const hasCustomSkills = skillRegistry.listNames().some((n) => !n.startsWith('builtin_'));
  const onboardingDone = settingsRepo.get('onboarding_done') === 'true';
  return !onboardingDone && !hasMcp && !hasCustomSkills;
}
```

前端横幅跳转至 `/discover`：

```tsx
{showOnboardingBanner && (
  <div className="rounded-lg bg-accent-muted p-4">
    <p className="text-sm font-medium">Welcome! Enable recommended tools to get started.</p>
    <Button size="sm" onClick={() => navigate('/discover')}>Quick Setup</Button>
  </div>
)}
```

---

### 3.8 Phase 1 工时分解

| 任务 | 工时 | 说明 |
|------|------|------|
| 预设 JSON / SKILL.md 文件编写 | 4h | 8 MCP + 5 Skill |
| `preset-service.ts` + `presets.ts` 路由 | 4h | 读取服务 + 4 个 API 端点 |
| Navigation 新增 Discover | 0.5h | NavPage + icon |
| DiscoverPage 框架 + McpSection | 4h | 上下分区 + 管理功能 |
| DiscoverPage SkillSection | 2h | 上下分区 + 管理功能 |
| SettingsPage 移除 MCP/Skills tabs | 1h | 精简为 3 tabs |
| App.tsx 路由调整 | 0.5h | + /discover, /skills 重定向 |
| Onboarding 检测 + 横幅 | 2h | 首次运行判断 + 引导 UI |
| 构建脚本调整 | 1h | presets 目录打包到 server-dist |
| 测试 | 4h | API + UI 交互 |
| **合计** | **23h** | |

---

## 四、Phase 2 — Discover UI 增强（远程索引）

**目标**：增加搜索、分类过滤、远程索引能力。  
**分支名**: `feature/discover-phase2`（基于 Phase 1）  
**工时**: ~16 小时

---

### 4.1 DiscoverPage 增强

在 Phase 1 基础上增加：

```tsx
export function DiscoverPage() {
  const [activeTab, setActiveTab] = useState<'mcp' | 'skills'>('mcp');
  const [category, setCategory] = useState<'all' | 'essential' | 'dev' | 'productivity' | 'communication' | 'data'>('all');
  const [search, setSearch] = useState('');
  const [remoteItems, setRemoteItems] = useState<RemoteItem[]>([]);

  // 加载远程索引（可选联网）
  useEffect(() => {
    apiFetch('/api/presets/remote-index', { headers: authHeaders() })
      .then((r) => r.json())
      .then((data) => setRemoteItems([...(data.mcpServers ?? []), ...(data.skills ?? [])]))
      .catch(() => setRemoteItems([]));
  }, []);

  // ... 搜索/过滤逻辑 ...
}
```

---

### 4.2 Phase 2 工时分解

| 任务 | 工时 |
|------|------|
| 搜索/分类过滤 UI | 3h |
| 远程索引 API | 2h |
| 远程 Skill 安装 | 2h |
| 注册表 JSON 模板 | 2h |
| 测试 | 2h |
| **合计** | **11h** | *(精简后发现比原估少)* |

---

## 五、完整 API 清单

| Method | Route | 描述 | Phase |
|--------|-------|------|-------|
| GET | `/api/presets/mcp` | 列出 MCP 预设 | 1 |
| POST | `/api/presets/mcp/:id/enable` | 启用 MCP 预设 | 1 |
| GET | `/api/presets/skills` | 列出 Skill 预设 | 1 |
| POST | `/api/presets/skills/:id/install` | 安装 Skill 预设 | 1 |
| GET | `/api/presets/onboarding` | 检测首次运行 | 1 |
| POST | `/api/presets/onboarding/complete` | 标记 onboarding 完成 | 1 |
| GET | `/api/presets/remote-index` | 远程注册表索引 | 2 |
| POST | `/api/presets/skills/install-remote` | 远程安装 Skill | 2 |

---

## 六、文件变更清单

### 新增

```
apps/server/src/services/preset-service.ts
apps/server/src/routes/presets.ts
apps/server/src/services/onboarding-service.ts
apps/server/src/presets/mcp/*.json (8 files)
apps/server/src/presets/skills/*/SKILL.md (5 files)
apps/desktop/src/pages/DiscoverPage.tsx
apps/desktop/src/pages/discover/McpDiscoverSection.tsx
apps/desktop/src/pages/discover/SkillDiscoverSection.tsx
```

### 修改

```
apps/server/src/index.ts                    # + presetsRouter
packages/ui/src/navigation.tsx              # + discover NavPage + Puzzle icon
apps/desktop/src/App.tsx                    # + /discover route, /skills redirect
apps/desktop/src/pages/SettingsPage.tsx     # 移除 skills/mcp tabs
apps/desktop/src/pages/settings/index.ts    # 移除 SkillsTab/McpTab 导出
scripts/copy-server.mjs                     # + presets 目录复制
```

### 删除/废弃（功能迁移到 DiscoverPage）

```
apps/desktop/src/pages/settings/McpTab.tsx      # 功能内嵌到 McpDiscoverSection
apps/desktop/src/pages/settings/SkillsTab.tsx   # 功能内嵌到 SkillDiscoverSection
```

---

*修订版结束。核心变更：Discover 作为侧边栏独立入口，管理 + 发现统一在一个页面，Settings 仅保留纯系统配置。*
