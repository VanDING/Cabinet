# Agent Workbench Redesign — Implementation Plan

**Date:** 2026-06-21
**Spec:** [`2026-06-21-agent-workbench-redesign.md`](../specs/2026-06-21-agent-workbench-redesign.md)
**Status:** Ready for execution

> **How to use this plan:** Execute phases in order. Within a phase, tasks marked `[parallel]` can be dispatched to separate agents; `[sequential]` must be done in listed order. Every task ends with a `verify` block — do not mark done until the verify command passes. TDD: write the test file first, watch it fail, then implement.

---

## 0. Execution Overview

### 0.1 Phase dependency graph

```
Phase 1 (dispatch fix)        ──── ship-ready alone
   │
   ▼
Phase 2 (Scanner + Projector) ──── depends on Phase 1's external_config plumbing
   │
   ├──▶ Phase 3 (ACP + headless) ── depends on Phase 2's recipe + projector types
   │            [parallel with Phase 4]
   ▼
Phase 4 (Workbench UI)       ──── depends on Phase 2's new API routes
   │
   ▼
Phase 5 (remaining projectors + MCP registry) ── depends on Phase 2 projector skeleton
   │
   ▼
Phase 6 (terminal env + polish) ── depends on Phase 4 UI + Phase 3 dispatch
```

### 0.2 Per-phase ship readiness

| Phase | Shippable on its own? | What the user sees after                                                       |
| ----- | --------------------- | ------------------------------------------------------------------------------ |
| 1     | **Yes**               | External agents work in chat + terminal. No more "not found".                  |
| 2     | Yes                   | One Scan button in Workbench → Agents; Claude Code config projected on launch. |
| 3     | Yes (with 2)          | Chat with Claude Code via ACP; chat with Aider/Gemini via headless.            |
| 4     | Yes (with 2)          | One Workbench nav item; no duplicate settings surfaces.                        |
| 5     | No (needs 2)          | All 9 agents have projectors; MCP registry install.                            |
| 6     | No (needs 4+3)        | Terminal has correct env; terminal-only agents show banner.                    |

### 0.3 Global conventions (apply to every task)

- **TypeScript strict** + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` — every `import type` uses `import type`.
- **4-layer rule** (`CABINET.md`): new files declare their layer; no upward imports.
- **500-line file cap** — split if approaching.
- **No comments unless explaining "why"** (CABINET.md §Code Conventions).
- **TDD**: every new module gets a `*.test.ts` alongside it. Run `pnpm -F @cabinet/<pkg> test` for that package.
- **Migration files**: `runMigrationNNN(db: Database.Database): void`, registered in `packages/storage/src/migrations/runner.ts`. No down migrations.
- **Spawn on Windows**: every `spawn` call uses `shell: process.platform === 'win32'`. Add a shared helper to avoid repeating this.
- **External agent id format**: `external_cli:<command>` or `external_a2a:<name>`. No `agent_` prefix anywhere.

### 0.4 Shared spawn helper (do this first, before Phase 1)

`packages/agent/src/utils/spawn.ts` — new file. Every spawn site in `packages/agent/` uses this.

```typescript
import { spawn, type SpawnOptions } from 'node:child_process';

export const isWindows = process.platform === 'win32';

export function spawnCrossPlatform(command: string, args: string[], options: SpawnOptions = {}) {
  return spawn(command, args, { shell: isWindows, ...options });
}
```

**Verify:** `pnpm -F @cabinet/agent build` passes; existing tests still green.

---

## Phase 1 — Fix the dispatch chain

**Goal:** external agents work end-to-end on Windows after server restart. No UI changes. Shippable alone.

**Files touched:** 7 modified, 1 new. Est. 1-2 days.

### P1.T1 — Shared spawn helper `[sequential]`

**New:** `packages/agent/src/utils/spawn.ts` (code in §0.4 above).

**New test:** `packages/agent/src/utils/spawn.test.ts` — assert `spawnCrossPlatform('echo', ['hi'])` returns exit 0 on the current platform.

**Verify:** `pnpm -F @cabinet/agent test -- spawn`

### P1.T2 — Fix `BaseCliRuntime` Windows spawn `[sequential, depends on T1]`

**File:** `packages/agent/src/adapters/harness/base-cli.ts`

**Changes:**

- Line 9: replace `import { spawn, type ChildProcess }` with `import { type ChildProcess } from 'node:child_process'` + `import { spawnCrossPlatform } from '../../utils/spawn.js'`.
- Line 132-137 (`dispatchTask`): replace `spawn(command, args, {...})` with `spawnCrossPlatform(command, args, { stdio: ['pipe','pipe','pipe'], env: { ...process.env, ...this.config.env }, cwd: ..., timeout: timeoutMs })`. Remove redundant `shell` (helper sets it).
- Line 252-263 (`execSimple`): same replacement.

**Test:** `packages/agent/src/adapters/harness/base-cli.test.ts` — add case: mock `spawnCrossPlatform`, assert `dispatchTask` calls it with the expected command/args. Existing tests should still pass.

**Verify:** `pnpm -F @cabinet/agent test -- base-cli` + manual: on Windows, `pnpm -F @cabinet/server dev` then `POST /api/daemon/agents/discover` — `claude` detected=true.

### P1.T3 — Write `external_config` on register `[sequential, depends on T2]`

**File:** `packages/agent/src/daemon/auto-discoverer.ts`

**Change:** in `registerCliAgent` (line 157-170), the `agentRoleRepo.upsert({...})` payload must include `external_config: JSON.stringify(externalConfigObject)`.

The `externalConfigObject` is the `ExternalAgentConfig` that `registerExternalAgent` builds (line 479-494 in `agent-roles.ts`). Refactor: extract that builder into a standalone function so both `registerExternalAgent` and `registerCliAgent` use the same source.

**New:** `packages/agent/src/daemon/build-external-config.ts`:

```typescript
import type { ExternalAgentConfig } from '@cabinet/types';

export function buildCliExternalConfig(
  command: string,
  args: string[] = ['--print'],
): ExternalAgentConfig {
  return {
    protocol: 'cli',
    configSource: 'agent_native',
    command,
    args,
    timeoutMs: 300_000,
    maxRetries: 2,
  };
}

export function buildA2AExternalConfig(baseUrl: string): ExternalAgentConfig {
  return {
    protocol: 'a2a',
    configSource: 'agent_native',
    baseUrl,
    timeoutMs: 120_000,
    maxRetries: 2,
  };
}
```

**Modify `agent-roles.ts:479-494`** to use these builders. **Modify `auto-discoverer.ts:157-170`** to add `external_config: JSON.stringify(buildCliExternalConfig(agent.command))` to the upsert. Same for `registerA2AAgent` (line 198-211).

**Test:** `packages/agent/src/daemon/auto-discoverer.test.ts` — assert that after `discover()`, `agentRoleRepo.findByName('external_cli:claude').external_config` is a JSON string containing `"command":"claude"`.

**Verify:** `pnpm -F @cabinet/agent test -- auto-discoverer`

### P1.T4 — Read `external_config` on startup `[sequential, depends on T3]`

**File:** `apps/server/src/context/agents.ts`

**Change:** in the loop at lines 19-29, parse `row.external_config` and pass it as `external`:

```typescript
agentRegistry.register({
  type: agentType,
  name: row.name,
  description: row.description,
  modules: { identity: row.system_prompt },
  modelTier: ((row.model_tier as string) || 'default') as ModelTier,
  temperature: row.temperature,
  maxResponseTokens: row.max_response_tokens,
  allowedTools: JSON.parse(row.allowed_tools ?? '[]'),
  contextBudget: row.context_budget,
  external: parseExternalConfig(row.external_config),
});
```

**New helper at top of file:**

```typescript
import type { ExternalAgentConfig } from '@cabinet/types';

function parseExternalConfig(raw: string | null | undefined): ExternalAgentConfig | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as ExternalAgentConfig;
    if (parsed.protocol !== 'cli' && parsed.protocol !== 'a2a') return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}
```

Only set `external` when `agentType` is `external_cli` or `external_a2a`.

**Test:** `apps/server/src/context/agents.test.ts` — seed `agent_roles` with a row whose `external_config` is a JSON string, call `initAgentRegistry`, assert `registry.get('external_cli:claude').external.command === 'claude'`.

**Verify:** `pnpm -F @cabinet/server test -- context/agents` + manual: restart server, `GET /api/agents` — `external_cli:claude` present with `external` field.

### P1.T5 — `registerExternalAgent` upsert instead of early-return `[sequential, depends on T4]`

**File:** `packages/agent/src/agent-roles.ts:466-507`

**Change:** replace `if (this.customRoles.has(params.name)) return false;` (line 477) with an upsert: if exists, merge `external` field into the existing role; if not, register fresh.

```typescript
registerExternalAgent(params: { ... }): boolean {
  const existing = this.customRoles.get(params.name);
  if (existing) {
    const external = buildExternalConfig(params);
    this.customRoles.set(params.name, { ...existing, external });
    return true;
  }
  const type = params.protocol === 'cli' ? 'external_cli' : 'external_a2a';
  const external = buildExternalConfig(params);
  this.register({ type, name: params.name, ..., external });
  return true;
}
```

Extract `buildExternalConfig` from the existing inline block (lines 479-494) — or reuse `build-external-config.ts` from T3.

**Test:** `packages/agent/src/agent-roles.test.ts` — call `registerExternalAgent` twice with same name, assert second call returns `true` and `registry.get(name).external` reflects the latest params.

**Verify:** `pnpm -F @cabinet/agent test -- agent-roles`

### P1.T6 — Unify external agent id format `[sequential, depends on T5]`

**File:** `apps/server/src/routes/employees.ts`

**Changes:**

- Line 21: `id: \`agent*${r.name}\``→`id: r.name`(external agents already have`external*`prefix in their name; custom agents keep`agent\_` prefix to avoid collision with built-in types).
  - Actually: `id: r.type.startsWith('external_') ? r.name : \`agent\_${r.name}\`` — this already exists at line 45 for the runtime path. Apply the same logic to line 21 (DB path).
- Line 188 (`DELETE /:id`): the `id.startsWith('agent_')` check needs to also handle `external_cli:` / `external_a2a:` prefixes. Add branches:
  ```typescript
  if (id.startsWith('external_cli:') || id.startsWith('external_a2a:')) {
    agentRegistry.unregister(id);
    agentRoleRepo.deleteByName(id);
    // also remove agents dir if a2a
    return c.json({ status: 'deleted' });
  }
  if (id.startsWith('agent_')) { ... existing ... }
  ```

**Test:** `apps/server/src/routes/employees.test.ts` — seed DB with an `external_cli:claude` row, `GET /api/employees` — response includes `{ id: 'external_cli:claude', source: 'external_cli' }`. `DELETE /api/employees/external_cli:claude` — returns 200, row gone.

**Verify:** `pnpm -F @cabinet/server test -- employees`

### P1.T7 — Fix `activeExternalAgent` command derivation `[sequential, depends on T6]`

**File:** `apps/desktop/src/App.tsx:128-132`

**Change:** the current code derives `command` from `agent.id.replace('external_cli:', '')`. This only works for the runtime id form. Switch to reading `agent.external.command` which the registry now exposes via `/api/employees` (after T4, `external` is populated).

```typescript
const activeExternalAgent = useMemo(() => {
  const agent = agents.find((a) => a.id === activeAgent);
  if (!agent || agent.source !== 'external_cli') return null;
  const ext = agent.external;
  if (!ext?.command) return null;
  return {
    command: ext.command,
    args: ext.args ?? [],
    env: ext.env,
  };
}, [agents, activeAgent]);
```

This requires `/api/employees` to return `external` in the response — it already does (`rowToEmployee` line 280-303 returns `external`). Confirm `useAgents` hook surfaces it.

**Check `apps/desktop/src/hooks/useAgents.ts`** — if its `AgentInfo` type doesn't include `external`, add the field.

**Test:** `apps/desktop/src/App.test.tsx` (if exists) or manual: select `external_cli:claude` in top bar, open terminal, verify `claude` (not `agent_external_cli:claude`) spawns.

**Verify:** `pnpm -F @cabinet/desktop lint` + manual terminal spawn.

### Phase 1 exit criteria

- [ ] `pnpm -F @cabinet/agent test` green
- [ ] `pnpm -F @cabinet/server test` green
- [ ] `pnpm typecheck` green
- [ ] `pnpm lint` green
- [ ] Manual on Windows: scan → chat with Claude Code → open terminal — all three work after server restart.
- [ ] `GET /api/employees` returns consistent ids (no `agent_external_cli:` form).
- [ ] `SELECT external_config FROM agent_roles WHERE name='external_cli:claude'` returns non-NULL JSON.

---

## Phase 2 — Single Scanner + Projector skeleton

**Goal:** one scanner, one recipe list. Claude Code projector implemented. New `/api/workbench/agents/*` routes. Migration creates `mcp_servers` table.

**Files touched:** ~15 new, ~10 modified, 4 deleted. Est. 3-4 days.

### P2.T1 — `workbench.ts` types `[parallel]`

**New:** `packages/types/src/workbench.ts`

```typescript
export type DispatchProtocol = 'acp' | 'headless' | 'terminal-only';

export interface InstallMethod {
  type: 'npm' | 'pip' | 'brew' | 'winget' | 'choco' | 'cargo' | 'binary' | 'manual';
  label: string;
  command: string;
  checkCommand: string;
  elevated?: boolean;
  url?: string;
}

export interface ConfigExtractor {
  file: string;
  format: 'json' | 'yaml' | 'toml';
  apiKeys?: { provider: string; path: string }[];
  mcpServers?: { path: string }[];
  skills?: { path: string }[];
}

export interface ScannerRecipe {
  id: string;
  name: string;
  command: string;
  detectArgs: string[];
  icon: string;
  description: string;
  install: { win32: InstallMethod[]; darwin: InstallMethod[]; linux: InstallMethod[] };
  nativeConfigPaths: { win32: string[]; darwin: string[]; linux: string[] };
  extract: {
    apiKeys?: ConfigExtractor[];
    mcpServers?: ConfigExtractor[];
    skills?: ConfigExtractor[];
  };
  projectorId: string;
  dispatch: {
    protocol: DispatchProtocol;
    headlessArgs?: string[];
    supportsJsonStream?: boolean;
    sdkPackage?: string;
  };
}

export interface ScanResult {
  recipe: ScannerRecipe;
  installed: boolean;
  version?: string;
  extracted?: ExtractedConfig;
  error?: string;
}

export interface ExtractedConfig {
  apiKeys: { provider: string; keyHint: string }[];
  mcpServers: {
    name: string;
    transport: 'stdio' | 'sse' | 'http';
    command?: string;
    args?: string[];
    url?: string;
  }[];
  skills: { name: string; path: string }[];
}

export interface Projector {
  agentId: string;
  nativeConfigPaths(): { win32: string[]; darwin: string[]; linux: string[] };
  project(config: UnifiedConfig, opts: ProjectOptions): Promise<void>;
  extract(): Promise<ExtractedConfig>;
}

export interface UnifiedConfig {
  apiKeys: { provider: string; key: string }[];
  mcpServers: {
    name: string;
    transport: 'stdio' | 'sse' | 'http';
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
  }[];
  skills: { name: string; path: string }[];
  agentSpecific: Record<string, unknown>;
}

export interface ProjectOptions {
  targetDir?: 'user' | 'project' | string;
  dryRun?: boolean;
  mergeStrategy?: 'replace' | 'merge';
}
```

**Modify:** `packages/types/src/index.ts` — re-export `./workbench.js`.

**Modify:** `packages/types/src/primitives.ts:339-356` — extend `ExternalAgentConfig`:

```typescript
export interface ExternalAgentConfig {
  protocol: ExternalAgentProtocol;
  configSource: AgentConfigSource;
  dispatchProtocol?: 'acp' | 'headless' | 'terminal-only';
  nativeConfigPaths?: { win32: string[]; darwin: string[]; linux: string[] };
  sdkPackage?: string;
  // ... existing fields ...
}
```

**Test:** `pnpm -F @cabinet/types build` — typecheck only (types package has no runtime tests).

**Verify:** `pnpm -F @cabinet/types build` + `pnpm typecheck`

### P2.T2 — `RECIPES` array `[parallel]`

**New:** `packages/agent/src/discovery/scanner-recipe.ts`

Consolidate `KNOWN_CLI_AGENTS` (auto-discoverer.ts:25-34) + `CLI_DETECT_LIST` (agents.ts:405-437) + `AGENT_DEFINITIONS` (agent-definitions.ts:34-256) into one array of `ScannerRecipe`.

Start with 9 agents: claude-code, codex, opencode, gemini-cli, kimi, qwen-code, glm, aider, cline.

Each entry:

```typescript
export const RECIPES: ScannerRecipe[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    command: 'claude',
    detectArgs: ['--version'],
    icon: 'claude',
    description: "Anthropic's official coding agent CLI.",
    install: {
      win32: [
        {
          type: 'npm',
          label: 'npm',
          command: 'npm install -g @anthropic-ai/claude-code',
          checkCommand: 'claude --version',
        },
      ],
      darwin: [
        {
          type: 'npm',
          label: 'npm',
          command: 'npm install -g @anthropic-ai/claude-code',
          checkCommand: 'claude --version',
        },
        {
          type: 'brew',
          label: 'Homebrew',
          command: 'brew install claude-code',
          checkCommand: 'claude --version',
        },
      ],
      linux: [
        {
          type: 'npm',
          label: 'npm',
          command: 'npm install -g @anthropic-ai/claude-code',
          checkCommand: 'claude --version',
        },
      ],
    },
    nativeConfigPaths: {
      win32: ['%USERPROFILE%\\.claude\\settings.json', '%USERPROFILE%\\.claude.json'],
      darwin: ['~/.claude/settings.json', '~/.claude.json'],
      linux: ['~/.claude/settings.json', '~/.claude.json'],
    },
    extract: {
      apiKeys: [
        {
          file: '~/.claude/settings.json',
          format: 'json',
          apiKeys: [{ provider: 'anthropic', path: 'env.ANTHROPIC_API_KEY' }],
        },
      ],
      mcpServers: [
        { file: '~/.claude.json', format: 'json', mcpServers: [{ path: 'mcpServers' }] },
      ],
    },
    projectorId: 'claude-code',
    dispatch: { protocol: 'acp', sdkPackage: '@anthropic-ai/claude-agent-sdk' },
  },
  // ... 8 more ...
];
```

Mark `[unverified]` paths in a comment above each entry that needs Phase 5 confirmation.

**Test:** `packages/agent/src/discovery/scanner-recipe.test.ts` — assert every recipe has non-empty `install` for all 3 platforms, `command` is non-empty, `dispatch.protocol` is valid.

**Verify:** `pnpm -F @cabinet/agent test -- scanner-recipe`

### P2.T3 — `Scanner` class `[sequential, depends on T1, T2]`

**New:** `packages/agent/src/discovery/scanner.ts`

```typescript
import { spawnCrossPlatform } from '../utils/spawn.js';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import type { AgentRoleRegistry } from '../agent-roles.js';
import type { AgentRoleRepository } from '@cabinet/storage';
import type { ScannerRecipe, ScanResult, ExtractedConfig } from '@cabinet/types';
import { RECIPES } from './scanner-recipe.js';
import { extractConfig } from './config-extractor.js';
import { buildCliExternalConfig, buildA2AExternalConfig } from '../daemon/build-external-config.js';

export class Scanner {
  constructor(
    private registry: AgentRoleRegistry,
    private agentRoleRepo?: AgentRoleRepository,
  ) {}

  async scanAll(): Promise<ScanResult[]> {
    return Promise.all(RECIPES.map((r) => this.scanOne(r)));
  }

  async scanOne(recipe: ScannerRecipe): Promise<ScanResult> {
    const detected = await this.detect(recipe.command, recipe.detectArgs);
    if (!detected) return { recipe, installed: false, error: 'Not found on PATH' };
    const version = await this.version(recipe);
    const extracted = await this.extractConfig(recipe);
    await this.upsertAgent(recipe, version, extracted);
    return { recipe, installed: true, version, extracted };
  }

  private detect(command: string, args: string[]): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawnCrossPlatform(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000,
      });
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }

  private async version(recipe: ScannerRecipe): Promise<string | undefined> {
    try {
      const proc = spawnCrossPlatform(recipe.command, recipe.detectArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000,
      });
      let stdout = '';
      proc.stdout?.on('data', (c: Buffer) => (stdout += c.toString()));
      await new Promise<void>((resolve, reject) => {
        proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${code}`))));
        proc.on('error', reject);
      });
      return stdout.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  private async extractConfig(recipe: ScannerRecipe): Promise<ExtractedConfig | undefined> {
    try {
      return await extractConfig(recipe);
    } catch {
      return undefined;
    }
  }

  private async upsertAgent(
    recipe: ScannerRecipe,
    version: string | undefined,
    extracted: ExtractedConfig | undefined,
  ): Promise<void> {
    const agentId = `external_cli:${recipe.command}`;
    const external = buildCliExternalConfig(recipe.command);
    external.dispatchProtocol = recipe.dispatch.protocol;
    external.nativeConfigPaths = recipe.nativeConfigPaths;
    external.sdkPackage = recipe.dispatch.sdkPackage;

    this.registry.registerExternalAgent({
      protocol: 'cli',
      name: agentId,
      description: `${recipe.name} CLI agent (auto-discovered)`,
      identity: `You are ${recipe.name}, running as a CLI agent dispatched by Cabinet.`,
      command: recipe.command,
      args: recipe.dispatch.headlessArgs ?? ['--print'],
    });

    if (this.agentRoleRepo) {
      this.agentRoleRepo.upsert({
        type: 'external_cli',
        name: agentId,
        description: `${recipe.name} CLI agent (auto-discovered)`,
        system_prompt: `You are ${recipe.name}, running as a CLI agent dispatched by Cabinet.`,
        model: 'default',
        model_tier: 'default',
        temperature: 0.7,
        max_response_tokens: 4096,
        allowed_tools: '[]',
        context_budget: 0.3,
        is_builtin: 0,
        created_at: new Date().toISOString(),
        external_config: JSON.stringify(external),
      });
    }
  }
}
```

Note: `registerExternalAgent` after P1.T5 upserts the `external` field — but it builds a fresh `ExternalAgentConfig` from params. To preserve `dispatchProtocol`/`nativeConfigPaths`/`sdkPackage`, either (a) extend `registerExternalAgent` params to accept these, or (b) after calling it, call `registry.update(agentId, { external: fullExternal })`. Prefer (a) — add optional fields to the params interface.

**Modify `agent-roles.ts:466`** — extend `registerExternalAgent` params with `dispatchProtocol?: DispatchProtocol`, `nativeConfigPaths?: {...}`, `sdkPackage?: string`, and thread them into the built `ExternalAgentConfig`.

**Test:** `packages/agent/src/discovery/scanner.test.ts` — mock `spawnCrossPlatform` to return `claude --version` exit 0; call `scanner.scanOne(RECIPES[0])`; assert result has `installed: true`, `version` set; assert `registry.get('external_cli:claude').external.dispatchProtocol === 'acp'`; assert `agentRoleRepo.upsert` called with non-NULL `external_config`.

**Verify:** `pnpm -F @cabinet/agent test -- scanner`

### P2.T4 — `config-extractor.ts` `[parallel]`

**New:** `packages/agent/src/discovery/config-extractor.ts`

Reads native config files per `recipe.extract`, parses JSON/YAML/TOML, applies JSON-path extractors, returns `ExtractedConfig`.

```typescript
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ScannerRecipe, ExtractedConfig, ConfigExtractor } from '@cabinet/types';

export async function extractConfig(recipe: ScannerRecipe): Promise<ExtractedConfig> {
  const platform =
    process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
  const result: ExtractedConfig = { apiKeys: [], mcpServers: [], skills: [] };

  const allExtractors = [
    ...(recipe.extract.apiKeys ?? []),
    ...(recipe.extract.mcpServers ?? []),
    ...(recipe.extract.skills ?? []),
  ];

  for (const ex of allExtractors) {
    const filePath = resolvePath(ex.file, platform);
    if (!existsSync(filePath)) continue;
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = parseByFormat(raw, ex.format);
    if (ex.apiKeys) for (const spec of ex.apiKeys) extractApiKey(parsed, spec, result);
    if (ex.mcpServers) for (const spec of ex.mcpServers) extractMcpServers(parsed, spec, result);
    if (ex.skills) for (const spec of ex.skills) extractSkills(parsed, spec, result);
  }
  return result;
}

function resolvePath(p: string, platform: string): string {
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  if (p.startsWith('%USERPROFILE%\\')) return join(homedir(), p.slice('%USERPROFILE%\\'.length));
  if (p.startsWith('%APPDATA%\\'))
    return join(
      process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'),
      p.slice('%APPDATA%\\'.length),
    );
  return p;
}

function parseByFormat(raw: string, format: 'json' | 'yaml' | 'toml'): unknown {
  if (format === 'json') return JSON.parse(raw);
  if (format === 'yaml') {
    /* use js-yaml — check if dep exists, else add */
  }
  if (format === 'toml') {
    /* use @iarna/toml or similar */
  }
  return JSON.parse(raw);
}

function getByPath(obj: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (acc, key) => (acc == null ? undefined : (acc as Record<string, unknown>)[key]),
      obj,
    );
}
```

Check if `js-yaml` is already a dep (`package.json` — from the earlier read, it's not). For Phase 2, only Claude Code uses JSON, so defer YAML/TOML parsers to Phase 5. Stub them with a throw `"YAML/TOML not yet supported"`.

**Test:** `packages/agent/src/discovery/config-extractor.test.ts` — write a fixture `~/.claude.json` with `{ mcpServers: { fs: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] } } }`; call `extractConfig(RECIPES[0])`; assert `result.mcpServers[0].name === 'fs'`.

**Verify:** `pnpm -F @cabinet/agent test -- config-extractor`

### P2.T5 — `Projector` interface + `ProjectorRegistry` `[parallel]`

**New:** `packages/agent/src/projector/index.ts`

```typescript
import type { Projector, UnifiedConfig, ProjectOptions } from '@cabinet/types';
import { ClaudeCodeProjector } from './claude-code.js';

const registry = new Map<string, Projector>();
registry.set('claude-code', new ClaudeCodeProjector());

export function getProjector(projectorId: string): Projector | undefined {
  return registry.get(projectorId);
}

export function registerProjector(projectorId: string, projector: Projector): void {
  registry.set(projectorId, projector);
}
```

### P2.T6 — `ClaudeCodeProjector` `[sequential, depends on T5]`

**New:** `packages/agent/src/projector/claude-code.ts`

Writes `~/.claude/settings.json` and `~/.claude.json` (or `.mcp.json` for project-scoped) from a `UnifiedConfig`.

```typescript
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import type { Projector, UnifiedConfig, ProjectOptions, ExtractedConfig } from '@cabinet/types';

export class ClaudeCodeProjector implements Projector {
  readonly agentId = 'claude-code';

  nativeConfigPaths() {
    return {
      win32: ['%USERPROFILE%\\.claude\\settings.json', '%USERPROFILE%\\.claude.json'],
      darwin: ['~/.claude/settings.json', '~/.claude.json'],
      linux: ['~/.claude/settings.json', '~/.claude.json'],
    };
  }

  async project(config: UnifiedConfig, opts: ProjectOptions = {}): Promise<void> {
    const settingsPath = join(homedir(), '.claude', 'settings.json');
    const existing = existsSync(settingsPath)
      ? (JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>)
      : {};

    const anthropicKey = config.apiKeys.find((k) => k.provider === 'anthropic');
    const mcpServers: Record<string, unknown> = {};
    for (const s of config.mcpServers) {
      mcpServers[s.name] =
        s.transport === 'stdio'
          ? { command: s.command, args: s.args ?? [], env: s.env ?? {} }
          : { type: 'sse', url: s.url };
    }

    const projected = {
      ...existing,
      env: { ...existing.env, ...(anthropicKey ? { ANTHROPIC_API_KEY: anthropicKey.key } : {}) },
      mcpServers,
    };

    if (opts.dryRun) {
      console.log(`[dry-run] would write to ${settingsPath}:`, JSON.stringify(projected, null, 2));
      return;
    }

    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(projected, null, 2));
  }

  async extract(): Promise<ExtractedConfig> {
    return { apiKeys: [], mcpServers: [], skills: [] };
  }
}
```

**Test:** `packages/agent/src/projector/claude-code.test.ts` — call `projector.project({ apiKeys: [{ provider: 'anthropic', key: 'sk-test' }], mcpServers: [{ name: 'fs', transport: 'stdio', command: 'npx', args: ['-y', 'x'] }], skills: [], agentSpecific: {} }, { dryRun: true })` — assert no throw. Then real run into a temp dir; read back the file and assert `env.ANTHROPIC_API_KEY === 'sk-test'` and `mcpServers.fs.command === 'npx'`.

**Verify:** `pnpm -F @cabinet/agent test -- projector/claude-code`

### P2.T7 — Migration 032 `[parallel]`

**New:** `packages/storage/src/migrations/032_workbench_unified_config.ts`

```typescript
import type Database from 'better-sqlite3';

export function runMigration032(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_servers (
      name TEXT PRIMARY KEY,
      transport_type TEXT NOT NULL,
      command TEXT,
      args TEXT,
      env TEXT,
      url TEXT,
      headers TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      health_status TEXT,
      last_health_check INTEGER,
      source TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Backfill from settings.mcp_servers if present
  const row = db.prepare("SELECT value FROM settings WHERE key = 'mcp_servers'").get() as
    | { value?: string }
    | undefined;
  if (row?.value) {
    try {
      const servers = JSON.parse(row.value) as Array<{
        name: string;
        transport: {
          type: string;
          command?: string;
          args?: string[];
          url?: string;
          env?: Record<string, string>;
        };
      }>;
      const insert = db.prepare(
        "INSERT OR IGNORE INTO mcp_servers (name, transport_type, command, args, env, url, source) VALUES (?, ?, ?, ?, ?, ?, 'scanned')",
      );
      for (const s of servers) {
        insert.run(
          s.name,
          s.transport.type,
          s.transport.command ?? null,
          s.transport.args ? JSON.stringify(s.transport.args) : null,
          s.transport.env ? JSON.stringify(s.transport.env) : null,
          s.transport.url ?? null,
        );
      }
    } catch {
      /* malformed — skip */
    }
  }

  // Backfill agent_roles.external_config for rows missing it
  const externalRows = db
    .prepare(
      "SELECT name, type FROM agent_roles WHERE type LIKE 'external_%' AND external_config IS NULL",
    )
    .all() as { name: string; type: string }[];
  const update = db.prepare('UPDATE agent_roles SET external_config = ? WHERE name = ?');
  for (const r of externalRows) {
    const command = r.name.startsWith('external_cli:') ? r.name.slice('external_cli:'.length) : '';
    const stub = JSON.stringify({
      protocol: 'cli',
      configSource: 'agent_native',
      command,
      dispatchProtocol: 'headless',
    });
    update.run(stub, r.name);
  }
}
```

**Register in `packages/storage/src/migrations/runner.ts`** — add `import { runMigration032 } from './032_workbench_unified_config.js'` and call it after `runMigration031`.

**New repo:** `packages/storage/src/repositories/mcp-server-repo.ts` — CRUD over `mcp_servers` table (mirror `api-key-repo.ts` style).

**Export** from `packages/storage/src/index.ts`.

**Test:** `packages/storage/src/migrations/032_workbench_unified_config.test.ts` — seed `settings.mcp_servers` with 2 servers, run migration, assert `mcp_servers` table has 2 rows. Seed `agent_roles` with an `external_cli:claude` row with NULL `external_config`, run migration, assert it's now non-NULL.

**Verify:** `pnpm -F @cabinet/storage test -- 032`

### P2.T8 — New `/api/workbench/agents/*` routes `[sequential, depends on T3, T6, T7]`

**New:** `apps/server/src/routes/workbench/agents.ts`

```typescript
import { Hono } from 'hono';
import { getServerContext } from '../../context.js';
import { Scanner } from '@cabinet/agent';
import { RECIPES } from '@cabinet/agent';
import { getProjector } from '@cabinet/agent';

export const workbenchAgentsRouter = new Hono();

workbenchAgentsRouter.get('/', (c) => {
  // list all recipes + install status from agent_roles
  const { agentRoleRepo } = getServerContext();
  const rows = agentRoleRepo.findCustom().filter((r) => r.type === 'external_cli');
  const byName = new Map(rows.map((r) => [r.name, r]));
  return c.json({
    agents: RECIPES.map((r) => ({
      id: `external_cli:${r.command}`,
      recipe: r,
      installed: byName.has(`external_cli:${r.command}`),
      version: byName.get(`external_cli:${r.command}`)?.model ?? undefined,
    })),
  });
});

workbenchAgentsRouter.post('/scan', async (c) => {
  const { agentRegistry, agentRoleRepo } = getServerContext();
  const scanner = new Scanner(agentRegistry, agentRoleRepo);
  const results = await scanner.scanAll();
  return c.json({ results });
});

workbenchAgentsRouter.post('/scan/:recipeId', async (c) => {
  const recipeId = c.req.param('recipeId');
  const recipe = RECIPES.find((r) => r.id === recipeId);
  if (!recipe) return c.json({ error: 'Unknown recipe' }, 404);
  const { agentRegistry, agentRoleRepo } = getServerContext();
  const scanner = new Scanner(agentRegistry, agentRoleRepo);
  const result = await scanner.scanOne(recipe);
  return c.json({ result });
});

workbenchAgentsRouter.get('/:agentId', (c) => {
  const agentId = c.req.param('agentId');
  const { agentRoleRepo, agentBindingRepo } = getServerContext();
  const row = agentRoleRepo.findByName(agentId);
  if (!row) return c.json({ error: 'Not found' }, 404);
  const external = row.external_config ? JSON.parse(row.external_config) : null;
  const mcpBindings = agentBindingRepo.listMcpBindingsForAgent(agentId);
  const skillBindings = agentBindingRepo.listSkillBindingsForAgent(agentId);
  return c.json({ agent: { ...row, external, mcpBindings, skillBindings } });
});

workbenchAgentsRouter.post('/:agentId/project', async (c) => {
  const agentId = c.req.param('agentId');
  const { agentRoleRepo, apiKeyRepo, mcpServerRepo, agentBindingRepo, skillRepo } =
    getServerContext();
  const row = agentRoleRepo.findByName(agentId);
  if (!row) return c.json({ error: 'Not found' }, 404);
  const external = row.external_config ? JSON.parse(row.external_config) : null;
  if (!external?.command) return c.json({ error: 'No external config' }, 400);

  const recipe = RECIPES.find(
    (r) => r.id === external.command || `external_cli:${r.command}` === agentId,
  );
  if (!recipe) return c.json({ error: 'No recipe for agent' }, 400);
  const projector = getProjector(recipe.projectorId);
  if (!projector) return c.json({ error: `No projector for ${recipe.projectorId}` }, 400);

  const apiKeys = apiKeyRepo
    .findAll()
    .map((k) => ({ provider: k.provider, key: decrypt(k.encrypted_key) }));
  const boundMcp = agentBindingRepo.listMcpBindingsForAgent(agentId).filter((b) => b.enabled);
  const mcpServers = mcpServerRepo
    .findAll()
    .filter((s) => s.enabled && boundMcp.some((b) => b.mcp_server_name === s.name));
  const boundSkills = agentBindingRepo.listSkillBindingsForAgent(agentId).filter((b) => b.enabled);
  const skills = skillRepo
    .findAll()
    .filter((s) => boundSkills.some((b) => b.skill_name === s.name));

  await projector.project(
    {
      apiKeys,
      mcpServers: mcpServers.map(rowToMcpEntry),
      skills: skills.map(rowToSkillEntry),
      agentSpecific: {},
    },
    { dryRun: c.req.query('dryRun') === '1' },
  );
  return c.json({ status: 'projected', dryRun: c.req.query('dryRun') === '1' });
});

workbenchAgentsRouter.delete('/:agentId', (c) => {
  const agentId = c.req.param('agentId');
  const { agentRoleRepo, agentRegistry } = getServerContext();
  agentRegistry.unregister(agentId);
  agentRoleRepo.deleteByName(agentId);
  return c.json({ status: 'deleted' });
});
```

`decrypt` = use the existing `apiKeyRepo` decryption (find the helper in `packages/storage/src/repositories/api-key-repo.ts`).

**Modify `apps/server/src/index.ts`** — mount `workbenchAgentsRouter` at `/api/workbench/agents`. Keep old `/api/agents/*` and `/api/install/*` routes for one release (deprecation comment).

**Test:** `apps/server/src/routes/workbench/agents.test.ts` — `POST /scan` returns 200 with `results` array of length 9; `GET /external_cli:claude` returns the agent with `external` populated after a scan; `POST /external_cli:claude/project?dryRun=1` returns 200.

**Verify:** `pnpm -F @cabinet/server test -- workbench/agents`

### P2.T9 — Wire `Scanner` into server startup `[sequential, depends on T8]`

**Modify:** `apps/server/src/context/daemon.ts` (and `daemon-context.ts`) — replace `AutoDiscoverer` instantiation with `Scanner`.

**Modify:** `apps/server/src/context/agents.ts` — after loading custom rows, also instantiate `Scanner` and call `scanner.scanAll()` if `autoDiscoverOnStart` is true (preserve existing config flag). This ensures newly installed CLIs are picked up on restart.

**Test:** integration test — start server with `claude` on PATH, assert `GET /api/agents` includes `external_cli:claude` with `external.dispatchProtocol === 'acp'`.

**Verify:** `pnpm -F @cabinet/server test` green; manual restart test.

### P2.T10 — Delete old scanners `[sequential, depends on T9]`

**Delete:**

- `packages/agent/src/daemon/auto-discoverer.ts` (and its test)
- `packages/agent/src/discovery/index.ts`
- `packages/agent/src/discovery/agent-definitions.ts`
- `packages/agent/src/discovery/config-scanner.ts`

**Modify:** `packages/agent/src/index.ts` — remove exports of deleted modules; add exports of `Scanner`, `RECIPES`, `getProjector`.

**Modify:** `apps/server/src/routes/agents.ts` — remove `CLI_DETECT_LIST` (line 405-437) and the divergent `/scan` handler (line 439-544). Replace with a thin proxy to the new scanner:

```typescript
agentsRouter.post('/scan', async (c) => {
  const { agentRegistry, agentRoleRepo } = getServerContext();
  const scanner = new Scanner(agentRegistry, agentRoleRepo);
  return c.json({ results: await scanner.scanAll() });
});
```

**Modify:** `apps/server/src/routes/install.ts` — point `GET /market` at `RECIPES`; `POST /install` uses `recipe.install[platform]`; `POST /deep-scan` delegates to `scanner.scanAll()`.

**Grep for leftover imports:** `grep -r "auto-discoverer" packages/ apps/` — fix any. Same for `discovery/index`, `agent-definitions`, `config-scanner`.

**Verify:** `pnpm typecheck` green; `pnpm lint` green; `pnpm test` green.

### Phase 2 exit criteria

- [ ] `POST /api/workbench/agents/scan` returns one list of 9 recipes.
- [ ] `agent_roles.external_config` is non-NULL and parseable for every installed agent.
- [ ] `POST /api/workbench/agents/external_cli:claude/project` writes `~/.claude/settings.json` with the bound API key + MCP servers.
- [ ] `mcp_servers` table exists and is backfilled.
- [ ] No `AutoDiscoverer` references remain in `packages/` or `apps/`.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` all green.

---

## Phase 3 — ACP runtime + headless refactor

**Goal:** G3 works — chat with Claude Code via ACP, chat with Aider/Gemini via headless CLI.

**Files touched:** ~6 new, ~4 modified. Est. 3-4 days.

> **ACP research first:** before writing code, fetch goose's ACP client source (`aaif-goose/goose`, Rust) and the ACP spec. ACP is JSON-RPC over stdio. The client spawns the agent CLI as a subprocess, sends `initialize`, then `session/new` + `session/prompt` requests, and receives `session/update` notifications. Confirm the exact method names against goose's source or the Zed agent-client-protocol repo before implementing.

### P3.T1 — `AcpClient` `[sequential]`

**New:** `packages/agent/src/adapters/acp/acp-client.ts`

Implements the JSON-RPC protocol over stdio to an ACP-speaking agent.

```typescript
import { spawn, type ChildProcess } from 'node:child_process';
import { isWindows } from '../../utils/spawn.js';

interface AcpRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}
interface AcpNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}
interface AcpResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export class AcpClient {
  private proc: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private buffer = '';
  private updateHandler?: (update: unknown) => void;

  constructor(
    private command: string,
    private args: string[],
    private env?: Record<string, string>,
  ) {}

  async connect(): Promise<void> {
    this.proc = spawn(this.command, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.env },
      shell: isWindows,
    });
    this.proc.stdout?.setEncoding('utf-8');
    this.proc.stdout?.on('data', (chunk: string) => this.onData(chunk));
    this.proc.on('error', (err) => {
      for (const { reject } of this.pending.values()) reject(err);
      this.pending.clear();
    });
    await this.request('initialize', { protocolVersion: 1, clientCapabilities: {} });
  }

  onUpdate(handler: (update: unknown) => void): void {
    this.updateHandler = handler;
  }

  async newSession(cwd: string, mcpServers?: unknown): Promise<string> {
    const result = (await this.request('session/new', { cwd, mcpServers })) as {
      sessionId: string;
    };
    return result.sessionId;
  }

  async prompt(sessionId: string, message: string): Promise<void> {
    this.sendNotification('session/prompt', { sessionId, message });
  }

  async cancel(sessionId: string): Promise<void> {
    this.sendNotification('session/cancel', { sessionId });
  }

  async disconnect(): Promise<void> {
    this.proc?.stdin?.end();
    this.proc?.kill('SIGTERM');
    this.proc = null;
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as AcpResponse | AcpNotification;
        if ('id' in msg && msg.id !== undefined) {
          const waiter = this.pending.get(msg.id);
          if (waiter) {
            this.pending.delete(msg.id);
            if (msg.error) waiter.reject(new Error(msg.error.message));
            else waiter.resolve(msg.result);
          }
        } else if ('method' in msg) {
          if ((msg as AcpNotification).method === 'session/update') {
            this.updateHandler?.(msg.params);
          }
        }
      } catch {
        /* not JSON — ignore line */
      }
    }
  }

  private request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    const req: AcpRequest = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc?.stdin?.write(JSON.stringify(req) + '\n');
    });
  }

  private sendNotification(method: string, params?: unknown): void {
    const notif: AcpNotification = { jsonrpc: '2.0', method, params };
    this.proc?.stdin?.write(JSON.stringify(notif) + '\n');
  }
}
```

**Test:** `packages/agent/src/adapters/acp/acp-client.test.ts` — spawn a fake ACP server (a small Node script that reads JSON-RPC and replies); assert `connect()` + `newSession()` round-trips.

**Verify:** `pnpm -F @cabinet/agent test -- acp-client`

### P3.T2 — `AcpRuntime` `[sequential, depends on T1]`

**New:** `packages/agent/src/adapters/acp/acp-runtime.ts`

Implements `HarnessRuntime` by wrapping `AcpClient`.

```typescript
import type {
  HarnessRuntime,
  HarnessConfig,
  ExternalTask,
  ExternalTaskResult,
  AgentCapability,
} from '../types.js';
import { AcpClient } from './acp-client.js';

export class AcpRuntime implements HarnessRuntime {
  readonly protocol = 'cli' as const;
  readonly harnessId = 'acp';
  private client: AcpClient | null = null;
  private sessionId: string | null = null;

  constructor(
    readonly agentId: string,
    protected config: HarnessConfig,
    protected capabilities: AgentCapability[] = [],
  ) {}

  async start(): Promise<void> {
    this.client = new AcpClient(this.config.command, this.config.args ?? [], this.config.env);
    await this.client.connect();
  }

  async stop(): Promise<void> {
    await this.client?.disconnect();
    this.client = null;
  }

  async healthCheck(): Promise<boolean> {
    return this.client !== null;
  }

  async dispatchTask(task: ExternalTask): Promise<ExternalTaskResult> {
    if (!this.client) await this.start();
    const startedAt = new Date().toISOString();
    try {
      if (!this.sessionId) {
        this.sessionId = await this.client!.newSession(
          task.configuration.working_directory ?? process.cwd(),
        );
      }
      let finalOutput = '';
      const updates: unknown[] = [];
      this.client!.onUpdate((u) => {
        updates.push(u);
        if ((u as { message?: string }).message) finalOutput += (u as { message: string }).message;
      });
      await this.client!.prompt(this.sessionId, this.convertPrompt(task));
      return {
        task_id: task.task_id,
        status: 'completed',
        output: finalOutput || '[ACP session produced no text output]',
        discoveries: [],
        audit: { started_at: startedAt, completed_at: new Date().toISOString() },
      };
    } catch (err) {
      return {
        task_id: task.task_id,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        audit: { started_at: startedAt, completed_at: new Date().toISOString() },
      };
    }
  }

  convertPrompt(task: ExternalTask): string {
    return typeof task.input === 'string' ? task.input : JSON.stringify(task.input);
  }

  extractMetrics(): { stdout: string; stderr: string } {
    return { stdout: '', stderr: '' };
  }

  injectSkill(): string {
    return '';
  }

  async cancelTask(taskId: string): Promise<void> {
    if (this.client && this.sessionId) await this.client.cancel(this.sessionId);
  }

  getCapabilities(): AgentCapability[] {
    return this.capabilities;
  }
}
```

**Test:** `packages/agent/src/adapters/acp/acp-runtime.test.ts` — mock `AcpClient`, assert `dispatchTask` calls `newSession` once then `prompt`, returns `status: 'completed'`.

**Verify:** `pnpm -F @cabinet/agent test -- acp-runtime`

### P3.T3 — Refactor `BaseCliRuntime` → `HeadlessCliRuntime` `[parallel]`

**File:** `packages/agent/src/adapters/harness/base-cli.ts` — rename to `headless-cli.ts` (or keep filename, add JSON stream parsing).

Add a `parseJsonStream(stdout: string): unknown[]` helper that splits stdout on newlines and parses each line as JSON. Used when `recipe.dispatch.supportsJsonStream` is true.

The existing `extractTaggedSections` logic stays as a fallback for agents that use the `===CABINET_DELIVERABLE===` marker convention.

**Modify `factory.ts:80-101`** — add ACP branch:

```typescript
export class HarnessRuntimeFactory {
  static create(config: HarnessConfig): HarnessRuntime {
    const dispatchProtocol = (config as HarnessConfig & { dispatchProtocol?: string })
      .dispatchProtocol;
    if (dispatchProtocol === 'acp') return new AcpRuntime(config.agentId, config);
    if (dispatchProtocol === 'headless') return new HeadlessCliRuntime(config.agentId, config);
    // legacy inference from command (for backwards compat during transition)
    return this.detectFromCommand(config.command).create(config);
  }
}
```

**Test:** `packages/agent/src/adapters/harness/factory.test.ts` — assert `dispatchProtocol: 'acp'` → `AcpRuntime`; `'headless'` → `HeadlessCliRuntime`; absent → legacy inference.

**Verify:** `pnpm -F @cabinet/agent test -- factory`

### P3.T4 — `dispatchToExternalAgent` uses `dispatchProtocol` `[sequential, depends on T2, T3]`

**File:** `apps/server/src/routes/secretary/agents/dispatch/external.ts:6-110`

**Change:** when building the adapter config, thread `dispatchProtocol` from `roleDef.external.dispatchProtocol` into the `HarnessConfig` so the factory picks the right runtime.

```typescript
const roleDef = registry.get(agentId);
if (!roleDef?.external) return `[Error] Agent ${agentId} has no external config.`;
const ext = roleDef.external;

if (ext.protocol === 'cli') {
  const harnessConfig: HarnessConfig = {
    agentId,
    command: ext.command!,
    args: ext.args,
    env: ext.env,
    timeoutMs: ext.timeoutMs,
    dispatchProtocol: ext.dispatchProtocol, // NEW
  };
  const runtime = HarnessRuntimeFactory.create(harnessConfig);
  // ... dispatch task ...
}
```

For `dispatchProtocol: 'terminal-only'` — return a helpful message:

```typescript
if (ext.dispatchProtocol === 'terminal-only') {
  return `[Terminal-only] ${agentId} does not support headless chat. Open it in the terminal panel.`;
}
```

**Test:** `apps/server/src/routes/secretary/agents/dispatch/external.test.ts` — mock registry with an `external_cli:claude` role whose `dispatchProtocol === 'acp'`; assert `dispatchToExternalAgent` instantiates `AcpRuntime` (via factory spy). Mock with `terminal-only`; assert the `[Terminal-only]` message.

**Verify:** `pnpm -F @cabinet/server test -- dispatch/external`

### P3.T5 — Aider + Gemini headless recipes `[parallel, depends on T3]`

Confirm flags via `aider --help` and `gemini --help` on a machine that has them. Update `RECIPES` entries:

```typescript
{
  id: 'aider',
  // ...
  dispatch: { protocol: 'headless', headlessArgs: ['--message', '', '--yes', '--json'], supportsJsonStream: true },
},
{
  id: 'gemini-cli',
  // ...
  dispatch: { protocol: 'headless', headlessArgs: ['-p', '', '--output-format', 'json'], supportsJsonStream: true },
},
```

Note: the empty string in `headlessArgs` is a placeholder for the prompt — `HeadlessCliRuntime.buildArgs` substitutes the actual prompt at dispatch time.

**Test:** manual — install aider, `POST /api/secretary/chat { targetAgent: 'external_cli:aider', message: 'Say hi' }` → real response.

**Verify:** manual + `pnpm -F @cabinet/agent test` green.

### Phase 3 exit criteria

- [ ] Chat with `external_cli:claude` returns a real Claude Code response via ACP.
- [ ] Chat with `external_cli:aider` returns a real Aider response via headless.
- [ ] Chat with `external_cli:gemini` returns a real Gemini response via headless.
- [ ] No `[Error] Agent ... has no external config.` anywhere.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` green.

---

## Phase 4 — Unified Workbench UI

**Goal:** G5 — one Workbench nav item, 4 sub-tabs, no duplicate surfaces.

**Files touched:** ~8 new, ~8 modified, ~6 deleted. Est. 3-4 days.

### P4.T1 — Add Workbench to navigation `[parallel]`

**File:** `packages/ui/src/navigation.tsx`

**Change:**

- Line 4: `export type NavPage = 'office' | 'workflows' | 'employees' | 'memory' | 'discovery' | 'settings'` → replace `'discovery'` with `'workbench'`.
- Line 29-35: `navItems` — replace `{ id: 'discovery', label: 'Discovery' }` with `{ id: 'workbench', label: 'Workbench' }`.
- Line 37-43: `navIcons` — replace `discovery: Compass` with `workbench: Wrench` (import `Wrench` from `lucide-react`).

**Grep for `'discovery'` usages:** `apps/desktop/src/` — find every `activePage === 'discovery'` and `navigate('discovery')`, replace with `'workbench'`.

**Verify:** `pnpm -F @cabinet/ui build` + `pnpm -F @cabinet/desktop lint`.

### P4.T2 — `Workbench/WorkbenchPage.tsx` (new) `[sequential, depends on T1]`

**New folder:** `apps/desktop/src/pages/Workbench/`

**New:** `apps/desktop/src/pages/Workbench/WorkbenchPage.tsx`

```tsx
import { useState } from 'react';
import { ApiKeysTab } from './ApiKeysTab.js';
import { McpTab } from './McpTab.js';
import { SkillsTab } from './SkillsTab.js';
import { AgentsTab } from './AgentsTab.js';

type WorkbenchTab = 'agents' | 'apikeys' | 'mcp' | 'skills';

const tabs: { id: WorkbenchTab; label: string }[] = [
  { id: 'agents', label: 'Agents' },
  { id: 'apikeys', label: 'API Keys' },
  { id: 'mcp', label: 'MCP Servers' },
  { id: 'skills', label: 'Skills' },
];

export function WorkbenchPage() {
  const [tab, setTab] = useState<WorkbenchTab>('agents');
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--border-color)] px-6 pt-4">
        <h1 className="text-content-primary text-lg font-bold">Workbench</h1>
        <p className="text-content-tertiary mb-3 text-sm">
          Unified management for agents, API keys, MCP servers, and skills.
        </p>
        <div className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'border-accent text-accent'
                  : 'text-content-tertiary hover:text-content-secondary border-transparent'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {tab === 'agents' && <AgentsTab />}
        {tab === 'apikeys' && <ApiKeysTab />}
        {tab === 'mcp' && <McpTab />}
        {tab === 'skills' && <SkillsTab />}
      </div>
    </div>
  );
}
```

### P4.T3 — Move `ApiKeysTab`, `McpTab`, `SkillsTab` `[parallel]`

**Move:**

- `apps/desktop/src/pages/settings/ApiKeysTab.tsx` → `apps/desktop/src/pages/Workbench/ApiKeysTab.tsx` — change import paths inside if any.
- `apps/desktop/src/pages/settings/McpTab.tsx` → `apps/desktop/src/pages/Workbench/McpTab.tsx` — add "Add from registry" button (calls `/api/workbench/mcp/registry` — route added in Phase 5; for now, stub the button with `disabled` + tooltip "Coming in Phase 5").
- `apps/desktop/src/pages/settings/SkillsTab.tsx` → `apps/desktop/src/pages/Workbench/SkillsTab.tsx`.

**Update `apps/desktop/src/pages/settings/index.ts`** — remove the three exports; add re-exports from `../Workbench/index.js` if anything still imports them.

**Verify:** `pnpm -F @cabinet/desktop build` — no broken imports.

### P4.T4 — `AgentsTab.tsx` (agent list + scan + market) `[sequential, depends on T2, T3]`

**New:** `apps/desktop/src/pages/Workbench/AgentsTab.tsx`

```tsx
import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../utils/api.js';
import { useToast } from '../../components/Toast.js';
import { AgentDetailPanel } from './AgentDetailPanel.js';
import { AgentMarketGrid } from './AgentMarketGrid.js';

interface AgentEntry {
  id: string;
  recipe: { id: string; name: string; icon: string; description: string };
  installed: boolean;
  version?: string;
}

export function AgentsTab() {
  const { addToast } = useToast();
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'market'>('list');
  const [scanning, setScanning] = useState(false);

  const fetchAgents = useCallback(async () => {
    const res = await apiFetch('/api/workbench/agents');
    const data = await res.json();
    setAgents(data.agents ?? []);
  }, []);

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  const handleScan = async () => {
    setScanning(true);
    try {
      const res = await apiFetch('/api/workbench/agents/scan', { method: 'POST' });
      await res.json();
      addToast('Scan complete', 'success');
      await fetchAgents();
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="flex h-full">
      <div className="flex-1 p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex gap-2">
            <button
              onClick={handleScan}
              disabled={scanning}
              className="bg-accent text-accent-foreground rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {scanning ? 'Scanning…' : 'Scan installed'}
            </button>
            <button
              onClick={() => setView(view === 'list' ? 'market' : 'list')}
              className="rounded-md border border-[var(--border-color)] px-3 py-1.5 text-sm"
            >
              {view === 'list' ? 'Agent Market' : 'Back to list'}
            </button>
          </div>
        </div>
        {view === 'market' ? (
          <AgentMarketGrid onInstalled={fetchAgents} />
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {agents.map((a) => (
              <button
                key={a.id}
                onClick={() => setSelectedId(a.id)}
                className={`rounded-lg border p-4 text-left transition-colors ${
                  selectedId === a.id
                    ? 'border-accent'
                    : 'hover:bg-surface-muted border-[var(--border-color)]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{a.recipe.name}</span>
                  <span
                    className={`h-2 w-2 rounded-full ${a.installed ? 'bg-intent-success' : 'bg-surface-input'}`}
                  />
                </div>
                <div className="text-content-tertiary mt-1 text-xs">
                  {a.installed ? (a.version ?? 'installed') : 'not installed'}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      {selectedId && <AgentDetailPanel agentId={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
```

### P4.T5 — `AgentDetailPanel.tsx` `[sequential, depends on T4]`

**New:** `apps/desktop/src/pages/Workbench/AgentDetailPanel.tsx`

Fetches `GET /api/workbench/agents/:agentId`, shows:

- Header: agent name, installed version, protocol badge, `[Test]` `[Delete]` buttons.
- MCP Servers section: list from `GET /api/settings/mcp-servers` + toggles per `mcpBindings` (PUT/DELETE `/api/workbench/bindings/:agentType/mcp`).
- Skills section: same pattern via `/api/skills` + `/api/workbench/bindings/:agentType/skill`.
- API Keys section: list from `GET /api/settings/api-keys` (read-only here; "managed in API Keys tab") with a hint.
- `[ Project config now ]` button → `POST /api/workbench/agents/:agentId/project`.
- `[ Open Terminal ]` button → triggers terminal panel open (calls a prop callback that `App.tsx` wires up).

```tsx
import { useState, useEffect, useCallback } from 'react';
import { apiFetch, authJsonHeaders } from '../../utils/api.js';
import { useToast } from '../../components/Toast.js';

interface AgentDetail {
  name: string;
  description: string;
  external_config: string;
  mcpBindings: { id: string; mcp_server_name: string; enabled: boolean }[];
  skillBindings: { id: string; skill_name: string; enabled: boolean }[];
}
interface McpServer {
  name: string;
  enabled: boolean;
}
interface Skill {
  id: string;
  name: string;
}

export function AgentDetailPanel({
  agentId,
  onClose,
  onOpenTerminal,
}: {
  agentId: string;
  onClose: () => void;
  onOpenTerminal?: () => void;
}) {
  const { addToast } = useToast();
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);

  const fetchAll = useCallback(async () => {
    const [d, m, s] = await Promise.all([
      apiFetch(`/api/workbench/agents/${encodeURIComponent(agentId)}`).then((r) => r.json()),
      apiFetch('/api/settings/mcp-servers').then((r) => r.json()),
      apiFetch('/api/skills').then((r) => r.json()),
    ]);
    setDetail(d.agent);
    setMcpServers(m.servers ?? []);
    setSkills(s.skills ?? []);
  }, [agentId]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const toggleMcp = async (serverName: string, enable: boolean) => {
    await apiFetch(`/api/workbench/bindings/${encodeURIComponent(agentId)}/mcp`, {
      method: 'PUT',
      headers: authJsonHeaders(),
      body: JSON.stringify({ serverName, enabled: enable }),
    });
    await fetchAll();
  };

  const toggleSkill = async (skillName: string, enable: boolean) => {
    await apiFetch(`/api/workbench/bindings/${encodeURIComponent(agentId)}/skill`, {
      method: 'PUT',
      headers: authJsonHeaders(),
      body: JSON.stringify({ skillName, enabled: enable }),
    });
    await fetchAll();
  };

  const projectNow = async () => {
    const res = await apiFetch(
      `/api/workbench/agents/${encodeURIComponent(agentId)}/project?dryRun=0`,
      { method: 'POST' },
    );
    const data = await res.json();
    addToast(
      data.status === 'projected' ? 'Config projected' : 'Project failed',
      data.status === 'projected' ? 'success' : 'error',
    );
  };

  if (!detail)
    return <div className="w-80 border-l border-[var(--border-color)] p-4">Loading…</div>;
  const external = JSON.parse(detail.external_config ?? '{}');

  return (
    <div className="w-96 overflow-y-auto border-l border-[var(--border-color)] p-4">
      {/* ... header, sections, buttons ... */}
    </div>
  );
}
```

### P4.T6 — `AgentMarketGrid.ts` + `InstallDialog.tsx` (folded) `[parallel]`

**New:** `apps/desktop/src/pages/Workbench/AgentMarketGrid.tsx` — grid of `RECIPES` from `GET /api/workbench/agents` (shows all 9, highlighting uninstalled ones). Clicking an uninstalled agent opens `InstallDialog`.

**New:** `apps/desktop/src/pages/Workbench/InstallDialog.tsx` — folded from `AgentMarketPage.tsx:213-395`. Same SSE install log streaming logic, but reads from `POST /api/workbench/agents/install` (new route — or reuse `/api/install/install` which is still mounted). After install success, calls `onInstalled` callback.

### P4.T7 — Delete old pages + update `SettingsPage` `[sequential, depends on T2-T6]`

**Delete:**

- `apps/desktop/src/pages/DiscoveryPage.tsx`
- `apps/desktop/src/pages/WorkbenchPage.tsx` (old — the 468-line one)
- `apps/desktop/src/pages/AgentMarketPage.tsx`
- `apps/desktop/src/pages/settings/ExternalAgentsTab.tsx`

**Move `RulesTab`** from `DiscoveryPage` to `SettingsPage`:

- **Modify `apps/desktop/src/pages/SettingsPage.tsx:11`** — add `'rules'` to the tab union. Render `<RulesTab />` when active.

**Strip external-agent UI from `EmployeesPage`:**

- **Modify `apps/desktop/src/pages/EmployeesPage.tsx`** — remove `handleScan` (lines 94-147), the "Scan for CLI Agents" menu item (lines 264-269), the Agent Market view toggle (lines 300-301). Keep only built-in/custom AI employee management.

**Update `App.tsx` route table:**

- Replace `case 'discovery': return <DiscoveryPage />` with `case 'workbench': return <WorkbenchPage />` (importing from `./pages/Workbench/WorkbenchPage.js`).

**Grep for broken imports:** `grep -r "DiscoveryPage\|WorkbenchPage\|AgentMarketPage\|ExternalAgentsTab" apps/desktop/src/` — fix any remaining.

**Verify:** `pnpm -F @cabinet/desktop build` + manual: nav shows Workbench, no Discovery; Settings has Rules tab; Employees page has no scan UI.

### P4.T8 — `useScanner` hook `[parallel]`

**New:** `apps/desktop/src/hooks/useScanner.ts`

```typescript
import { useState, useCallback } from 'react';
import { apiFetch } from '../utils/api.js';

export function useScanner() {
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState<unknown[]>([]);

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      const res = await apiFetch('/api/workbench/agents/scan', { method: 'POST' });
      const data = await res.json();
      setResults(data.results ?? []);
      return data.results;
    } finally {
      setScanning(false);
    }
  }, []);

  return { scanning, results, scan };
}
```

### Phase 4 exit criteria

- [ ] Left nav has **Workbench** (no Discovery).
- [ ] Workbench has 4 sub-tabs: Agents / API Keys / MCP Servers / Skills.
- [ ] Agents tab: scan button works; agent cards show installed status; clicking a card opens detail panel with MCP/skill toggles + Project Now + Open Terminal.
- [ ] Agent Market grid accessible from Agents tab.
- [ ] Settings page has Rules tab (moved from Discovery); no ApiKeys/Mcp/Skills tabs there.
- [ ] Employees page has no external-agent scan UI.
- [ ] `grep -r "DiscoveryPage" apps/` returns 0 results.
- [ ] `pnpm typecheck && pnpm lint && pnpm -F @cabinet/desktop build` green.

---

## Phase 5 — Remaining projectors + MCP registry

**Goal:** all 9 agents have projectors; MCP Hub has "Add from registry".

**Files touched:** 8 new projectors, ~3 modified. Est. 4-5 days. Each projector is `[parallel]` with the others.

### P5.T1 — Verify unverified config paths `[sequential, blocking]`

Before writing any projector, run each agent's `--help` and read its config docs to confirm the paths in spec §7. Document findings in a comment at the top of each projector file.

Commands to run (on a dev machine or via webfetch of each agent's docs):

```
claude --help && cat ~/.claude/settings.json 2>/dev/null
codex --help
opencode --help
gemini --help
kimi --help
qwen-code --help
glm --help
aider --help
cline --help
```

Record the actual config file paths, JSON keys, and dispatch flags. Update `RECIPES` if any path is wrong.

### P5.T2-P5.9 — One projector per agent `[parallel, depends on T1]`

For each of: codex, opencode, gemini-cli, kimi, qwen-code, glm, aider, cline:

**New:** `packages/agent/src/projector/<agent>.ts` — implements `Projector`. Pattern follows `claude-code.ts` (P2.T6).

**Register** in `packages/agent/src/projector/index.ts`.

**Test:** `packages/agent/src/projector/<agent>.test.ts` — `project(..., { dryRun: true })` doesn't throw; real run writes expected file with expected keys.

**Each projector must handle:**

- API key injection (into the agent's native config format — JSON/YAML/TOML).
- MCP server list (into the agent's native `mcp`/`mcpServers` key).
- Skills (symlink/copy from `~/.cabinet/skills/<name>/` into the agent's skills dir, if the agent supports skills).
- Merge strategy: don't clobber user's existing config keys outside what Cabinet manages.

**Add YAML/TOML parsers** to `config-extractor.ts` — add `js-yaml` and `@iarna/toml` to `packages/agent/package.json` deps (check CABINET.md: "don't introduce new libs unless necessary" — these are necessary for Codex TOML and Aider YAML).

### P5.T10 — MCP registry route + UI `[sequential, depends on P2.T8]`

**New:** `apps/server/src/routes/workbench/mcp-reg.ts`

```typescript
import { Hono } from 'hono';
import { getServerContext } from '../../context.js';

export const mcpRegistryRouter = new Hono();

mcpRegistryRouter.get('/', async (c) => {
  // Fetch from GitHub MCP Registry API
  const res = await fetch('https://api.github.com/repos/mcp/registry/contents/servers.json');
  if (!res.ok) return c.json({ error: 'Registry unavailable' }, 502);
  const data = (await res.json()) as { download_url: string };
  const serversRes = await fetch(data.download_url);
  const servers = await serversRes.json();
  return c.json({ servers });
});

mcpRegistryRouter.post('/install', async (c) => {
  const { mcpServerRepo } = getServerContext();
  const body = await c.req.json();
  // body: { name, command, args, env }
  mcpServerRepo.upsert({
    name: body.name,
    transport_type: 'stdio',
    command: body.command,
    args: JSON.stringify(body.args ?? []),
    env: JSON.stringify(body.env ?? {}),
    source: 'registry',
  });
  return c.json({ status: 'installed' });
});
```

**Mount** in `apps/server/src/index.ts` at `/api/workbench/mcp/registry`.

**Modify** `apps/desktop/src/pages/Workbench/McpTab.tsx` — enable the "Add from registry" button (was stubbed in P4.T3). Opens a modal listing registry servers; clicking one calls `POST /api/workbench/mcp/registry/install`.

**Test:** `apps/server/src/routes/workbench/mcp-reg.test.ts` — mock `fetch`, assert `/` returns server list; `POST /install` inserts into `mcp_servers`.

**Verify:** `pnpm -F @cabinet/server test -- mcp-reg`

### P5.T11 — Dry-run safeguard on first projection `[sequential, depends on P5.T2-T9]`

**Modify** `AgentDetailPanel.tsx` — the `[ Project config now ]` button checks a per-agent flag `hasProjectedBefore` (stored in `agent_roles` as a JSON field `agentSpecific.projectedOnce`, or in a new lightweight `agent_state` table — prefer the former to avoid a new migration). If `false`, the first call uses `dryRun=1` and shows a diff modal; user confirms; second call does the real write and sets the flag.

**Verify:** manual — first Project Now on a fresh agent shows diff; second does the write.

### Phase 5 exit criteria

- [ ] All 9 agents in `RECIPES` have a working projector.
- [ ] Each projector's test passes.
- [ ] `config-extractor.ts` handles JSON + YAML + TOML.
- [ ] MCP tab has working "Add from registry" flow.
- [ ] First-time Project Now shows a dry-run diff.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` green.

---

## Phase 6 — Terminal env injection + polish

**Goal:** G4 fully done — terminal has correct env; terminal-only agents show chat banner.

**Files touched:** ~4 modified. Est. 1-2 days.

### P6.T1 — `pty.rs` env merge `[sequential]`

**File:** `apps/desktop/src-tauri/src/pty.rs:59-61`

**Change:** currently the spawn only injects the `env` from spawn args. Merge with `process::env` so the child inherits the parent env + extra:

```rust
let mut full_env: HashMap<String, String> = std::env::vars().collect();
if let Some(extra) = env {
    for (k, v) in extra.iter() {
        full_env.insert(k.clone(), v.clone());
    }
}
CommandBuilder::new(command).args(args).envs(full_env)
```

**Verify:** `cargo build` in `apps/desktop/src-tauri/` succeeds.

### P6.T2 — `useTerminal` + `TerminalTab` accept env from bindings `[sequential, depends on T1]`

**File:** `apps/desktop/src/hooks/useTerminal.ts:14`

**Change:** the hook already accepts `env?: Record<string, string>`. Ensure `TerminalTab.tsx` and `ChatView.tsx:269-285` build the env from the agent's bound API keys + MCP config paths:

```typescript
const terminalEnv = useMemo(() => {
  if (!activeExternalAgent) return undefined;
  const env: Record<string, string> = {};
  // API keys: read from a useApiKeys hook or fetch /api/settings/api-keys filtered by agent binding
  // MCP: set CLAUDE_CODE_MCP_CONFIG or equivalent per-agent env var
  return env;
}, [activeExternalAgent]);
```

This requires a new endpoint `GET /api/workbench/agents/:agentId/env` that returns the resolved env vars (API keys decrypted + MCP config path) for terminal injection — avoids putting key decryption logic in the frontend.

**New route** in `apps/server/src/routes/workbench/agents.ts`:

```typescript
workbenchAgentsRouter.get('/:agentId/env', (c) => {
  const agentId = c.req.param('agentId');
  const { agentRoleRepo, apiKeyRepo, agentBindingRepo } = getServerContext();
  const row = agentRoleRepo.findByName(agentId);
  if (!row) return c.json({ error: 'Not found' }, 404);
  // Resolve bound API keys (decrypt) → env vars per provider
  // Resolve bound MCP servers → env var pointing to a temp config file
  const env: Record<string, string> = {};
  // ... populate ...
  return c.json({ env });
});
```

### P6.T3 — Terminal-only agents: chat banner `[parallel]`

**File:** `apps/desktop/src/components/ChatView.tsx`

**Change:** when `activeExternalAgent` and the agent's `dispatchProtocol === 'terminal-only'`, render a banner above the chat input:

```tsx
{
  activeExternalAgent?.dispatchProtocol === 'terminal-only' && (
    <div className="bg-surface-muted border-b border-[var(--border-color)] px-4 py-2 text-sm">
      This agent doesn't support headless chat.{' '}
      <button onClick={openTerminal} className="text-accent underline">
        Open Terminal
      </button>
    </div>
  );
}
```

This requires `useAgents` to surface `external.dispatchProtocol` — fetch it from `/api/employees` which now includes `external` (P1.T7).

### P6.T4 — End-to-end manual test `[sequential, depends on T1-T3]`

Run the full user journey on Windows:

1. `pnpm build` + `cd apps/desktop && pnpm tauri:dev`
2. Workbench → Agents → Scan installed → Claude Code shows installed.
3. Click Claude Code card → toggle a MCP server on → Project config now → check `~/.claude/settings.json` has the MCP server.
4. Office → select Claude Code in top bar → send "hello" → get a real response.
5. Open terminal → `echo $ANTHROPIC_API_KEY` (or `echo %ANTHROPIC_API_KEY%` on Windows) → shows the key.
6. Restart server → repeat 4-5 → still works (no "no external config").

### Phase 6 exit criteria

- [ ] Terminal env contains the bound API key (verified by echoing in the terminal).
- [ ] Terminal-only agents show the chat banner with "Open Terminal" button.
- [ ] Full user journey (scan → bind → project → chat → terminal → restart → chat again) works on Windows.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` green.
- [ ] `cargo build` in `src-tauri/` succeeds.

---

## Risk Register & Rollback

| Risk                                                                  | Likelihood | Impact | Mitigation                                                                                                                      | Rollback                                                                                                                  |
| --------------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Projector writes wrong path → corrupts native config                  | Medium     | High   | Dry-run by default on first projection (P5.T11); projector unit tests with fixture files                                        | User restores from `~/.claude/settings.json.bak` — projector writes a `.bak` before overwriting                           |
| ACP protocol details wrong (method names, params)                     | Medium     | High   | P3 research block at top of Phase 3 — verify against goose source before coding                                                 | Fall back to `headless` dispatch for Claude Code (`dispatch.protocol: 'headless'` with `claude -p`); ACP is opportunistic |
| Migration 032 backfill fails for a weird `settings.mcp_servers` shape | Low        | Medium | Migration wraps backfill in try/catch, skips malformed entries                                                                  | Migration is idempotent — re-run after fixing the source data                                                             |
| Deleting old scanners breaks a test that referenced them              | High       | Low    | P2.T10 deletes only after `Scanner` passes equivalent tests; keep old test cases, point at `Scanner`                            | Revert the delete commit — old scanners still work until P2.T10                                                           |
| `external_config` backfill writes a stub that breaks dispatch         | Low        | Medium | Stub includes `dispatchProtocol: 'headless'` so dispatch works; full config populated on next scan                              | `UPDATE agent_roles SET external_config = NULL WHERE ...` — triggers re-scan                                              |
| YAML/TOML parser deps bloat the bundle                                | Low        | Low    | Only added to `packages/agent`, not the desktop bundle                                                                          | Remove the deps, restrict Phase 5 to JSON-config agents                                                                   |
| Windows `shell: true` injection (user-supplied command in a recipe)   | Low        | High   | Recipe `command` fields are hardcoded constants, not user input; `args` are also hardcoded                                      | N/A — not user-controlled                                                                                                 |
| Tauri PTY env leak (API key visible in subshell)                      | Medium     | Medium | Document in spec §12; prefer config-file projection over env for keys where possible (Claude Code already uses `settings.json`) | Set env keys to empty string, rely on config-file projection only                                                         |

### Rollback strategy per phase

- **Phase 1**: revert the 7-file commit — old behavior returns (with the bug). Safe to ship alone, so rollback = don't ship.
- **Phase 2**: revert the new routes + migration. Old `/api/agents/scan` still works (we kept it as a proxy). Migration 032 is additive (no destructive schema change), so leaving it in place is fine.
- **Phase 3**: revert ACP runtime. Dispatch falls back to headless (set `dispatchProtocol: 'headless'` in recipes).
- **Phase 4**: revert UI files. Old Discovery/Workbench/AgentMarket pages come back. Nav revert is one line.
- **Phase 5**: revert individual projector files — other agents still work.
- **Phase 6**: revert `pty.rs` + env route — terminal still works but without injected env.

---

## Test Matrix

| Layer        | What                                                           | Command                         | When                    |
| ------------ | -------------------------------------------------------------- | ------------------------------- | ----------------------- |
| Unit         | `@cabinet/agent` (scanner, projectors, runtimes, spawn helper) | `pnpm -F @cabinet/agent test`   | Every task in P1-P3, P5 |
| Unit         | `@cabinet/storage` (migration 032, mcp-server-repo)            | `pnpm -F @cabinet/storage test` | P2.T7                   |
| Unit         | `@cabinet/types` (typecheck only)                              | `pnpm -F @cabinet/types build`  | P2.T1                   |
| Integration  | `@cabinet/server` (routes, context)                            | `pnpm -F @cabinet/server test`  | P2.T8, P3.T4, P5.T10    |
| Build        | All packages compile                                           | `pnpm build`                    | End of every phase      |
| Typecheck    | All packages                                                   | `pnpm typecheck`                | End of every phase      |
| Lint         | All packages                                                   | `pnpm lint`                     | End of every phase      |
| Architecture | 4-layer dependency rules                                       | `pnpm lint:arch`                | End of every phase      |
| E2E          | Full desktop flow                                              | `cd tests/e2e && vitest run`    | End of Phase 4, Phase 6 |
| Manual       | Windows full journey                                           | §P6.T4                          | End of Phase 1, Phase 6 |

### Minimum test coverage per new module

| Module                          | Must have tests for                                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `utils/spawn.ts`                | cross-platform spawn returns exit 0                                                                         |
| `discovery/scanner.ts`          | `scanOne` with detected=true upserts agent + writes `external_config`; detected=false returns not-installed |
| `discovery/config-extractor.ts` | JSON path resolution (`~`, `%USERPROFILE%`, `%APPDATA%`); extracts apiKeys/mcpServers/skills from a fixture |
| `discovery/scanner-recipe.ts`   | every recipe has valid install for 3 platforms; command non-empty; dispatch.protocol valid                  |
| `projector/claude-code.ts`      | `dryRun` doesn't write; real run writes expected JSON; preserves existing keys not managed by Cabinet       |
| `projector/<each>.ts`           | same pattern as claude-code                                                                                 |
| `adapters/acp/acp-client.ts`    | connect → newSession → prompt round-trip with a mock ACP server                                             |
| `adapters/acp/acp-runtime.ts`   | `dispatchTask` calls newSession once, then prompt; returns `completed`                                      |
| `adapters/harness/factory.ts`   | `dispatchProtocol` routing to AcpRuntime / HeadlessCliRuntime                                               |
| `migrations/032_*.ts`           | backfills `mcp_servers` from `settings.mcp_servers`; backfills `external_config` stubs                      |
| `routes/workbench/agents.ts`    | scan returns 9 results; `:agentId/project?dryRun=1` returns 200; `:agentId` returns bindings                |
| `routes/workbench/mcp-reg.ts`   | `/` returns server list; `/install` inserts into `mcp_servers`                                              |

---

## Release Checklist (end of all phases)

- [ ] `pnpm build && pnpm typecheck && pnpm lint && pnpm lint:arch` all green
- [ ] `pnpm test` green across all packages
- [ ] `cd tests/e2e && vitest run` green
- [ ] `cargo build` in `apps/desktop/src-tauri/` succeeds
- [ ] Manual full journey on Windows (§P6.T4) passes
- [ ] Manual full journey on macOS (if available) passes
- [ ] `docs/superpowers/specs/2026-06-20-agent-workbench-design.md` marked "Superseded by 2026-06-21"
- [ ] `README.md` updated: Workbench section, remove Discovery references
- [ ] `CABINET.md` updated: new packages/paths if any layer assignments changed
- [ ] Every `[unverified]` in spec §7 confirmed and the tag removed
- [ ] No `grep -r "AutoDiscoverer\|CLI_DETECT_LIST\|AGENT_DEFINITIONS\|DiscoveryPage\|ExternalAgentsTab" packages/ apps/` results
- [ ] `git log --oneline` shows clean phase-by-phase commits

---

## Appendix A — Quick reference: file → phase → task

| File                                                                                         | Phase | Task                         |
| -------------------------------------------------------------------------------------------- | ----- | ---------------------------- |
| `packages/agent/src/utils/spawn.ts`                                                          | P1    | T1                           |
| `packages/agent/src/adapters/harness/base-cli.ts`                                            | P1    | T2                           |
| `packages/agent/src/daemon/build-external-config.ts`                                         | P1    | T3                           |
| `packages/agent/src/daemon/auto-discoverer.ts`                                               | P1    | T3 (modify), P2.T10 (delete) |
| `packages/agent/src/agent-roles.ts`                                                          | P1    | T3, T5                       |
| `apps/server/src/context/agents.ts`                                                          | P1    | T4                           |
| `apps/server/src/routes/employees.ts`                                                        | P1    | T6                           |
| `apps/desktop/src/App.tsx`                                                                   | P1    | T7                           |
| `packages/types/src/workbench.ts`                                                            | P2    | T1                           |
| `packages/types/src/primitives.ts`                                                           | P2    | T1                           |
| `packages/agent/src/discovery/scanner-recipe.ts`                                             | P2    | T2                           |
| `packages/agent/src/discovery/scanner.ts`                                                    | P2    | T3                           |
| `packages/agent/src/discovery/config-extractor.ts`                                           | P2    | T4                           |
| `packages/agent/src/projector/index.ts`                                                      | P2    | T5                           |
| `packages/agent/src/projector/claude-code.ts`                                                | P2    | T6                           |
| `packages/storage/src/migrations/032_*.ts`                                                   | P2    | T7                           |
| `apps/server/src/routes/workbench/agents.ts`                                                 | P2    | T8                           |
| `packages/agent/src/adapters/acp/acp-client.ts`                                              | P3    | T1                           |
| `packages/agent/src/adapters/acp/acp-runtime.ts`                                             | P3    | T2                           |
| `packages/agent/src/adapters/harness/factory.ts`                                             | P3    | T3                           |
| `apps/server/src/routes/secretary/agents/dispatch/external.ts`                               | P3    | T4                           |
| `packages/ui/src/navigation.tsx`                                                             | P4    | T1                           |
| `apps/desktop/src/pages/Workbench/WorkbenchPage.tsx`                                         | P4    | T2                           |
| `apps/desktop/src/pages/Workbench/ApiKeysTab.tsx`                                            | P4    | T3                           |
| `apps/desktop/src/pages/Workbench/McpTab.tsx`                                                | P4    | T3                           |
| `apps/desktop/src/pages/Workbench/SkillsTab.tsx`                                             | P4    | T3                           |
| `apps/desktop/src/pages/Workbench/AgentsTab.tsx`                                             | P4    | T4                           |
| `apps/desktop/src/pages/Workbench/AgentDetailPanel.tsx`                                      | P4    | T5                           |
| `apps/desktop/src/pages/Workbench/AgentMarketGrid.tsx`                                       | P4    | T6                           |
| `apps/desktop/src/pages/Workbench/InstallDialog.tsx`                                         | P4    | T6                           |
| `apps/desktop/src/pages/DiscoveryPage.tsx`                                                   | P4    | T7 (delete)                  |
| `apps/desktop/src/pages/WorkbenchPage.tsx` (old)                                             | P4    | T7 (delete)                  |
| `apps/desktop/src/pages/AgentMarketPage.tsx`                                                 | P4    | T7 (delete)                  |
| `apps/desktop/src/pages/EmployeesPage.tsx`                                                   | P4    | T7 (modify)                  |
| `apps/desktop/src/pages/SettingsPage.tsx`                                                    | P4    | T7 (modify)                  |
| `packages/agent/src/projector/{codex,opencode,gemini-cli,kimi,qwen-code,glm,aider,cline}.ts` | P5    | T2-T9                        |
| `apps/server/src/routes/workbench/mcp-reg.ts`                                                | P5    | T10                          |
| `apps/desktop/src-tauri/src/pty.rs`                                                          | P6    | T1                           |
| `apps/desktop/src/hooks/useTerminal.ts`                                                      | P6    | T2                           |
| `apps/desktop/src/components/ChatView.tsx`                                                   | P6    | T2, T3                       |

---

## Appendix B — Command quick-reference

```bash
# Build everything
pnpm build

# Typecheck everything (runs build first)
pnpm typecheck

# Lint everything
pnpm lint
pnpm lint:fix

# Architecture lint (4-layer rules)
pnpm lint:arch

# Test one package
pnpm -F @cabinet/agent test
pnpm -F @cabinet/agent test -- scanner     # filter by filename
pnpm -F @cabinet/server test -- workbench
pnpm -F @cabinet/storage test -- 032

# Test everything
pnpm test

# E2E tests
cd tests/e2e && vitest run

# Start server in dev mode
cd apps/server && pnpm dev

# Start desktop app
cd apps/desktop && pnpm tauri:dev

# Tauri Rust build
cd apps/desktop/src-tauri && cargo build

# Check for leftover references
grep -r "AutoDiscoverer\|CLI_DETECT_LIST\|AGENT_DEFINITIONS\|DiscoveryPage\|ExternalAgentsTab" packages/ apps/ --include="*.ts" --include="*.tsx"
```
