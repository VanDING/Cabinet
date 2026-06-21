# Agent Workbench Redesign

**Date:** 2026-06-21
**Status:** Accepted
**Supersedes:** [`2026-06-20-agent-workbench-design.md`](./2026-06-20-agent-workbench-design.md) — that Draft was partially implemented (AgentTopBar, terminal, bindings tab) but the unification, dispatch fix, and projector pattern were not done. This spec replaces it wholesale and re-states the already-shipped parts for completeness.

---

## 1. Goals

Five user-facing capabilities, each with a verifiable success criterion. Anything not listed here is out of scope.

| #   | Capability                                                               | Acceptance criterion                                                                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | Scan locally installed agent CLIs and auto-configure                     | After clicking **Scan** in Workbench → Agents, every installed agent (Claude Code, Codex, OpenCode, Gemini CLI, Kimi, Qwen Code, GLM, Aider, Cline) appears with status `installed`, and its native config files have been parsed: API keys land in the Key Vault, MCP servers in the MCP Hub, skills in the Skill Registry. |
| G2  | One-click install of agents                                              | Clicking **Install** on an uninstalled agent card runs the platform-appropriate install command, streams the log into the dialog, and on success the agent flips to `installed` and is auto-scanned.                                                                                                                         |
| G3  | In-app chat with loaded external agents                                  | Selecting an external agent in the Office top bar and sending a message returns a real response from that agent (no `not found`, no `no external config`). ACP-speaking agents (Claude Code, Codex) go through ACP; the rest go through headless CLI (`<cmd> -p` / `--message` / `exec` + `--output-format json`).           |
| G4  | Embed the external agent's own terminal in the UI                        | Opening the terminal panel for an external agent spawns the agent's native TUI in xterm.js, with env vars (API keys + MCP config paths) injected from the unified config + per-agent bindings.                                                                                                                               |
| G5  | Unified management of API keys / memory / MCP / skills across all agents | There is **exactly one** place to edit each of: API keys, MCP servers, skills — all under top-level nav **Workbench**. Per-agent enable/disable of MCP servers and skills lives on the agent's detail panel. On agent launch, Cabinet projects the unified config into the agent's native config files.                      |

## 2. Non-Goals

- Building a new agent runtime. Cabinet's own `AgentLoop` stays; this spec is about **managing and driving external agents**, not reinventing them.
- An MCP "super-proxy" that aggregates all MCP servers behind one endpoint. We project MCP server lists into each agent's native config instead (per cc-switch pattern).
- A custom skill authoring UI. Skills are authored as `SKILL.md` (existing system); this spec only unifies where they are listed and bound.
- Memory unification across agents. Each external agent keeps its own native memory (`CLAUDE.md`, `.aider.chat.history.md`, etc.). Cabinet's internal multi-tier memory stays for built-in agents. Cross-agent memory is a later spec.
- Mobile/web client. Desktop + server only.

---

## 3. Market Research Summary

The full research is in the conversation transcript; the decisions that shaped this spec:

| Reference                                                               | What we borrow                                                                                                                                                       | What we don't                                                                |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **cc-switch** (farion1231, ~105k★, Tauri+Rust, MIT)                     | Source-of-truth-in-app + project-to-native-files pattern; Tauri + xterm.js + portable-pty stack; per-agent config file map                                           | UX only — we can't import a competing Tauri app                              |
| **opencode** (anomalyco, ~177k★, TS, MIT)                               | Config schema shape: `provider`/`mcp`/`agent`/`permission`/`instructions`, `{env:VAR}` + `{file:path}` substitution, global+project merge with documented precedence | Its TUI/agent runtime — opencode is itself an agent, not a manager           |
| **goose** (aaif-goose, ~50k★, Rust, Apache-2.0)                         | **ACP (Agent Client Protocol)** as the structural interface for driving Claude Code/Codex; recipe YAML format for portable workflows                                 | Goose's own agent runtime                                                    |
| **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`, commercial ToS) | `query()` async generator + `ClaudeAgentOptions{ allowedTools, mcpServers, hooks, agents, resume, permissionMode }` for G3 with Claude Code                          | Not vendored — used as a runtime dep when the user has Claude Code installed |
| **cline** (cline, ~64k★, TS, Apache-2.0)                                | `cline --json` streaming + `@cline/sdk` pattern; `.cline/skills/` + `.clinerules` convention                                                                         | IDE extension — not relevant to desktop workbench                            |
| **claude-code-router** (musistudio, ~35k★, TS, MIT)                     | `Providers` + `Router` config schema as reference for key+model routing                                                                                              | The proxy-sidecar approach — we use projection instead (user decision)       |
| **continue** (continuedev, ~34k★, TS, Apache-2.0)                       | Flat `models[]` + `mcpServers{}` shape as a secondary mental model                                                                                                   | IDE extension plumbing                                                       |
| **GitHub MCP Registry** (github.com/mcp)                                | Discovery source for MCP servers listed in the MCP Hub "Add from registry" flow                                                                                      | —                                                                            |

**License caution:** Claude Agent SDK is under Anthropic Commercial ToS (not OSS). We depend on it only when the user has already installed Claude Code (so they've already accepted those terms). We do not vendor or redistribute the SDK.

---

## 4. Current-State Diagnosis

Three concrete problems this spec must fix.

### 4.1 The "not found" bug has four layered causes

Traced via `packages/agent/src/daemon/auto-discoverer.ts`, `apps/server/src/context/agents.ts`, `packages/agent/src/agent-roles.ts`, `packages/agent/src/adapters/harness/base-cli.ts`, `apps/server/src/routes/secretary/agents/dispatch/external.ts`:

1. **Three scanners, three agent lists, no reconciliation.**
   - `AutoDiscoverer.KNOWN_CLI_AGENTS` (`auto-discoverer.ts:25-34`) — 8 entries, registers in `AgentRoleRegistry` + `agent_roles` DB.
   - UI scan route `CLI_DETECT_LIST` (`routes/agents.ts:405-437`) — 6 entries with **different names** (`'cursor'` vs `'cursor-agent'`), does **not** register anything; UI then POSTs to `/api/employees` writing to a **different table**.
   - Deep scanner `AGENT_DEFINITIONS` (`discovery/agent-definitions.ts:34-256`) — 8 entries, reads config files, does **not** register.

2. **`external_config` column is written-but-not-read, then written-but-omitted.**
   - `AutoDiscoverer.registerCliAgent` (`auto-discoverer.ts:157-170`) upserts the `agent_roles` row but **omits `external_config`** from the payload → column stays NULL.
   - `context/agents.ts:11-34` loads `agent_roles` rows into the registry on startup but **never parses `external_config`** → `roleDef.external` is `undefined` after restart.
   - `registerExternalAgent` (`agent-roles.ts:477`) early-returns when the role name is already in the registry → on restart, `AutoDiscoverer.discover()` cannot repopulate `external`.
   - `dispatchToExternalAgent` (`external.ts:15-16`) checks `roleDef?.external` → undefined → returns `[Error] Agent external_cli:claude has no external config.` User sees this as "not found".

3. **Windows `spawn` without `shell: true` → ENOENT for `.cmd` shims.**
   - `BaseCliRuntime.dispatchTask` (`base-cli.ts:132-137`) spawns with no `shell` flag. On Windows, `claude` is `claude.cmd`; Node's `spawn` throws `ENOENT` whose message contains "not found".
   - Detection works because `auto-discoverer.ts:131` and `discovery/index.ts:17` use `shell: isWindows`, but dispatch doesn't.

4. **Two id formats.**
   - Runtime-registered external agents: `id = 'external_cli:claude'` (`employees.ts:45`).
   - DB-only external agents: `id = 'agent_external_cli:claude'` (`employees.ts:21`).
   - `App.tsx:128-132` derives the terminal command by `agent.id.replace('external_cli:', '')` → works only for the first form; the second form tries to spawn `agent_external_cli:claude` as a command.

### 4.2 Three overlapping settings surfaces

| Concern                            | Editable in                                                                   | Read-only mirror in                                                         | Unique feature in                                          |
| ---------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------- |
| API keys                           | `SettingsPage → ApiKeysTab`                                                   | `WorkbenchPage → ApiKeysTab` (`WorkbenchPage.tsx:423-464`, comment at :442) | —                                                          |
| MCP servers                        | `DiscoveryPage → McpTab`                                                      | `WorkbenchPage → McpTab` (`WorkbenchPage.tsx:320-376`, comment at :345)     | —                                                          |
| Skills                             | `DiscoveryPage → SkillsTab`                                                   | `WorkbenchPage → SkillsTab` (`WorkbenchPage.tsx:378-421`, comment at :395)  | —                                                          |
| Per-agent MCP/skill bindings       | —                                                                             | —                                                                           | `WorkbenchPage → BindingsTab` (`WorkbenchPage.tsx:90-318`) |
| External agents (scan/test/delete) | `EmployeesPage` (`:94-147`)                                                   | `settings/ExternalAgentsTab.tsx` (redirect stub)                            | —                                                          |
| Agent install                      | `AgentMarketPage` + embedded in `EmployeesPage` + embedded in `DiscoveryPage` | —                                                                           | —                                                          |

Three pages (`Settings`, `Discovery`, `Workbench`) overlap on the same data. `Workbench` is a label on a tab inside `Discovery`, with three of its four sub-tabs being read-only mirrors. There is no `WorkbenchConfig` type, no `WorkbenchService`, no `WorkbenchRepository`. Nav (`packages/ui/src/navigation.tsx:29-35`) has no Workbench item.

### 4.3 Things that already work and we keep

- Tauri PTY + xterm.js + `useTerminal` hook (`apps/desktop/src-tauri/src/pty.rs`, `apps/desktop/src/hooks/useTerminal.ts`, `apps/desktop/src/components/terminal/`) — works, only needs env injection from bindings.
- `AgentTopBar` (`apps/desktop/src/components/chat/AgentTopBar.tsx`) — shipped, keep.
- Bindings tables `agent_mcp_bindings` + `agent_skill_bindings` (migration `031`) — schema is right, keep.
- `agent_roles.external_config` column (migration `024`) — schema is right, we just need to actually write and read it.
- Install SSE streaming (`packages/agent/src/install/installer.ts`, `routes/install.ts`) — works, refactor to use `ScannerRecipe.install`.
- `HarnessRuntime` interface (`packages/agent/src/adapters/harness-runtime.ts:64-90`) — good abstraction, extend it for ACP.

---

## 5. New Architecture

### 5.1 Single source of truth + Projector pattern

Cabinet DB is the canonical store for all agent-related config. On agent launch, a per-agent **Projector** writes the unified config into the agent's native config files.

```
┌─────────────────────────────────────────────────────────────────┐
│  Cabinet DB (canonical source)                                  │
│  ┌────────────┐ ┌─────────────┐ ┌────────┐ ┌────────────────┐  │
│  │ api_keys   │ │ mcp_servers │ │ skills │ │ agents         │  │
│  │ (AES-256)  │ │ (unified)   │ │        │ │ + agent_bind.. │  │
│  └─────┬──────┘ └──────┬──────┘ └───┬────┘ └────────┬───────┘  │
│        │               │            │               │          │
└────────┼───────────────┼────────────┼───────────────┼──────────┘
         │               │            │               │
         ▼               ▼            ▼               ▼
┌─────────────────────────────────────────────────────────────────┐
│  UnifiedConfig (in-memory snapshot, built on agent launch)      │
│  { apiKeys, mcpServers, skills, agentBinding }                  │
└────────────────────────────┬────────────────────────────────────┘
                             │
             ┌───────────────┼───────────────┬─────────────┐
             ▼               ▼               ▼             ▼
   ┌─────────────────┐ ┌──────────────┐ ┌────────────┐ ┌──────────┐
   │ ClaudeCodeProj  │ │ CodexProj    │ │ OpenCodePr │ │ KimiProj │ ...
   │ writes:         │ │ writes:      │ │ writes:    │ │ writes:  │
   │ ~/.claude/      │ │ ~/.codex/    │ │ ~/.config/ │ │ ~/.kimi/ │
   │   settings.json │ │   config.toml│ │   opencode/│ │  config  │
   │ ~/.claude.json  │ │   mcp.json   │ │   opencode.│ │          │
   │ .mcp.json       │ │              │ │   json     │ │          │
   └─────────────────┘ └──────────────┘ └────────────┘ └──────────┘
                             │
                             ▼
                    [spawn agent CLI with env]
```

**Why this over the proxy approach (claude-code-router style):** user decision (Q1). Projection works for every agent that has a config file (all of them do); proxy only works for agents that let you redirect their HTTP endpoint (Claude Code via `ANTHROPIC_BASE_URL`, but not Codex CLI / Gemini CLI / Aider / Kimi-CLI which don't expose that). Projection also gives the agent its full native experience (hooks, skills, sub-agents) — a proxy flattens that to "just a model".

**Why this over "let each agent keep its own config, Cabinet only reads":** because the user's G5 is "manage **as reuse** across all agents". If Cabinet only reads, the user has to keep N config files in sync by hand — that's the status quo and the reason they filed this issue.

**Projector interface:**

```typescript
interface Projector {
  agentId: string; // 'claude-code'
  nativeConfigPaths(): { win32: string[]; darwin: string[]; linux: string[] };
  project(config: UnifiedConfig, opts: ProjectOptions): Promise<void>;
  // Optional: read native config back into Cabinet (used by scanner, not launch)
  extract(): Promise<ExtractedConfig>;
}

interface UnifiedConfig {
  apiKeys: ApiKeyEntry[]; // from Key Vault (decrypted in-memory)
  mcpServers: McpServerEntry[]; // from MCP Hub, filtered by agent binding
  skills: SkillEntry[]; // from Skill Registry, filtered by agent binding
  agentSpecific: Record<string, unknown>; // per-agent extras (e.g. Claude Code hooks)
}

interface ProjectOptions {
  targetDir?: 'user' | 'project' | string; // write to user home or a project dir
  dryRun?: boolean;
  mergeStrategy?: 'replace' | 'merge'; // replace native config or merge with existing
}
```

### 5.2 Single ScannerRecipe engine (replaces 3 scanners)

One recipe per known agent. One orchestrator. Three callers (startup auto-discover, manual scan, post-install re-scan) all use the same path.

```typescript
interface ScannerRecipe {
  id: string; // 'claude-code'
  name: string; // 'Claude Code'
  command: string; // 'claude'
  detectArgs: string[]; // ['--version']
  icon: string; // brand icon key
  description: string;
  install: {
    // per-platform install methods
    win32: InstallMethod[];
    darwin: InstallMethod[];
    linux: InstallMethod[];
  };
  nativeConfigPaths: {
    // where this agent stores its config
    win32: string[];
    darwin: string[];
    linux: string[];
  };
  extract: {
    // how to read native config back
    apiKeys?: ConfigExtractor[];
    mcpServers?: ConfigExtractor[];
    skills?: ConfigExtractor[];
  };
  projectorId: string; // which Projector to use on launch
  dispatch: {
    // how to drive this agent for G3
    protocol: 'acp' | 'headless' | 'terminal-only';
    headlessArgs?: string[]; // for 'headless': ['-p', '--output-format', 'json']
    supportsJsonStream?: boolean;
    sdkPackage?: string; // for Claude Agent SDK
  };
}

interface InstallMethod {
  type: 'npm' | 'pip' | 'brew' | 'winget' | 'choco' | 'cargo' | 'binary' | 'manual';
  label: string;
  command: string;
  checkCommand: string; // post-install verify
  elevated?: boolean;
  url?: string; // for 'manual'
}
```

**Orchestrator:**

```typescript
class Scanner {
  async scanAll(): Promise<ScanResult[]> {
    return Promise.all(RECIPES.map((r) => this.scanOne(r)));
  }
  async scanOne(recipe: ScannerRecipe): Promise<ScanResult> {
    const installed = await this.detect(recipe); // shell: isWindows
    if (!installed) return { ...recipe, installed: false };
    const version = await this.version(recipe);
    const extracted = await this.extractConfig(recipe); // read native files
    await this.upsertAgent(recipe, version, extracted); // write to DB + registry
    return { ...recipe, installed: true, version, extracted };
  }
}
```

**Reconciliation:** `upsertAgent` writes to `agent_roles` with full `external_config` JSON (fixes 4.1#2). On startup, `context/agents.ts` reads `external_config` and parses it into the registry (fixes 4.1#2). `registerExternalAgent` upserts instead of early-returning (fixes 4.1#2).

### 5.3 Dispatch chain fix + ACP-first

```
ChatContext.setActiveAgent('external_cli:claude')
  → POST /api/secretary/chat { targetAgent, message }
    → dispatchToSpecialist(targetAgent, ...)
      → if roleType starts with 'external_': dispatchToExternalAgent(...)
        → registry.get(agentId)                       // now has .external (fix 4.1#2)
        → choose runtime by recipe.dispatch.protocol:
            'acp'           → AcpRuntime              // new
            'headless'      → HeadlessCliRuntime      // refactored BaseCliRuntime
            'terminal-only' → (terminal panel only, chat returns "use terminal")
        → runtime.dispatchTask(task)                  // all spawn calls use shell: isWindows
```

**ACP runtime** (`packages/agent/src/adapters/acp/`) — implements `HarnessRuntime`. Speaks ACP to Claude Code / Codex. Reference: goose's ACP client. Streams structured agent events (tool calls, file edits, messages) — far cleaner than screen-scraping a terminal.

**Headless runtime** — refactored `BaseCliRuntime`. Spawn `<cmd> -p "<prompt>"` with `--output-format json --input-format stream-json` (Claude Code, Gemini CLI) or `--message "<prompt>" --yes` (Aider) or `exec "<prompt>"` (Codex) or `--json "<prompt>"` (Cline). Parse streaming JSON into `ExternalTaskResult`.

**Terminal-only** — for agents that expose neither ACP nor a headless mode. Chat returns a "this agent is interactive-only, click **Open Terminal**" message and the user uses the embedded terminal.

**Id format:** one rule, enforced everywhere — external agent ids are `external_cli:<command>` and `external_a2a:<name>`. No `agent_` prefix. `employees.ts:21` is fixed. `App.tsx:128-132` is fixed to read `agent.external.command` instead of string-replacing the id.

### 5.4 Unified Workbench top-level nav

Replace three overlapping surfaces with one. The nav gets a new top-level item **Workbench**. `Discovery` is removed; `Settings` keeps only user prefs.

```
Top-level nav (left rail):
  Office          (chat — unchanged)
  Workbench       (NEW top-level — was a tab in Discovery)
  Workflows       (unchanged)
  Memory          (unchanged)
  Factory         (unchanged)
  Employees       (the AI team — external agents moved out)
  Settings        ( Theme / Monitor / PIS / Backups / Maintenance / Audit / Others )
```

```
Workbench page (sub-tabs):
┌──────────────────────────────────────────────────────────────┐
│  Workbench                                                   │
│  [ Agents ] [ API Keys ] [ MCP Servers ] [ Skills ]          │
├──────────────────────────────────────────────────────────────┤
│  Agents tab:                                                 │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  [ Scan installed ]   [ Agent Market ]                  │ │
│  │                                                         │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │ │
│  │  │ Claude   │ │ Codex    │ │ OpenCode │ │ Gemini   │  │ │
│  │  │ ● v1.0   │ │ ● v0.5   │ │ ○ —      │ │ ● v0.2   │  │ │
│  │  │ [Open]   │ │ [Open]   │ │ [Install]│ │ [Open]   │  │ │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘  │ │
│  │                                                         │ │
│  │  Click [Open] on an agent → right panel:                │ │
│  │  ┌────────────────────────────────────────────────────┐ │ │
│  │  │ Claude Code                          [Test] [Del]  │ │ │
│  │  │ ────────────────────────────────────────────────── │ │ │
│  │  │ Status: installed v1.0                              │ │ │
│  │  │ Path:   C:\...\claude.cmd                           │ │ │
│  │  │ Protocol: ACP                                       │ │ │
│  │  │ ────────────────────────────────────────────────── │ │ │
│  │  │ MCP Servers (toggle per-server):                   │ │ │
│  │  │  [✓] filesystem   [✓] playwright   [ ] github     │ │ │
│  │  │ Skills (toggle per-skill):                         │ │ │
│  │  │  [✓] tdd          [ ] brainstorming                │ │ │
│  │  │ API Keys (inherited from Key Vault):               │ │ │
│  │  │  Anthropic: ••••••••••3a4f   [Rotate]              │ │ │
│  │  │ ────────────────────────────────────────────────── │ │ │
│  │  │ [ Project config now ]   [ Open Terminal ]         │ │ │
│  └────────────────────────────────────────────────────┘ │ │
└──────────────────────────────────────────────────────────────┘
```

**Tabs:**

| Tab             | Source                                                                                           | Action                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| **Agents**      | New — replaces `EmployeesPage` external scan UI + `AgentMarketPage` + `DiscoveryPage` market tab | List/scan/install/test/delete; per-agent detail panel with MCP/skill bindings + API key inheritance + project-now + open-terminal |
| **API Keys**    | Moved from `SettingsPage → ApiKeysTab` (the existing `pages/settings/ApiKeysTab.tsx` component)  | The only editable surface for API keys                                                                                            |
| **MCP Servers** | Moved from `DiscoveryPage → McpTab` (the existing `pages/settings/McpTab.tsx` component)         | The only editable surface for MCP servers; gains "Add from registry" (GitHub MCP Registry)                                        |
| **Skills**      | Moved from `DiscoveryPage → SkillsTab` (the existing `pages/settings/SkillsTab.tsx` component)   | The only editable surface for skills                                                                                              |

**Removed:**

- `apps/desktop/src/pages/DiscoveryPage.tsx` — its tabs are all moved (Rules → Settings; Skills/MCP/Market/Workbench → Workbench).
- `apps/desktop/src/pages/WorkbenchPage.tsx` (old) — its read-only mirror tabs are deleted; its unique Bindings tab is folded into the Agents detail panel.
- `apps/desktop/src/pages/AgentMarketPage.tsx` — folded into Workbench → Agents tab → "Agent Market" toggle.
- `apps/desktop/src/pages/settings/ExternalAgentsTab.tsx` — stub, deleted.
- `apps/desktop/src/pages/EmployeesPage.tsx` external-agent scan UI — moved to Workbench → Agents. `EmployeesPage` keeps only built-in/custom AI employees.

### 5.5 Embedded terminal as fallback

Already implemented. Three fixes:

1. **Env injection from bindings** — `useTerminal` and `pty_spawn` accept `env` built from the agent's bound API keys + MCP config paths. `pty.rs:59-61` currently only injects the spawn-arg env; change to merge `process.env` + spawn env.
2. **Command from `external.command`, not id string replace** — `App.tsx:128-132` reads `agent.external.command` from the registry instead of `agent.id.replace('external_cli:', '')`.
3. **Terminal-only agents** — for agents with `dispatch.protocol === 'terminal-only'`, the chat panel shows a banner "This agent doesn't support headless chat. [Open Terminal]".

---

## 6. Data Model

### 6.1 Reused tables (no schema change)

- `api_keys` (migration `001` + `017`) — canonical API key vault. AES-256 encrypted. Cols: `provider`, `encrypted_key`, `base_url`, `model`.
- `skills` (migration `001` + `008`) — canonical skill registry.
- `agent_mcp_bindings` + `agent_skill_bindings` (migration `031`) — per-agent enable/disable. `agent_type` column already matches our `external_cli:<command>` id.
- `agent_roles` (migration `001` + `024` + `025`) — **the canonical agent table**. We use `external_config` (TEXT JSON) properly now. `daemon_config` stays for pull-mode.

### 6.2 New table: `mcp_servers` (unified)

Today MCP server config lives in two places: `settings` table key `'mcp_servers'` (JSON blob) + `~/.cabinet/settings.json` field `mcpServers`. We promote it to a real table for queryability and per-server health tracking.

```sql
CREATE TABLE mcp_servers (
  name TEXT PRIMARY KEY,
  transport_type TEXT NOT NULL,           -- 'stdio' | 'sse' | 'http'
  command TEXT,                           -- stdio: 'npx'
  args TEXT,                              -- stdio: JSON array
  env TEXT,                               -- stdio: JSON object
  url TEXT,                               -- sse/http
  headers TEXT,                           -- sse/http: JSON object
  enabled INTEGER NOT NULL DEFAULT 1,
  health_status TEXT,                     -- 'unknown' | 'healthy' | 'unhealthy'
  last_health_check INTEGER,
  source TEXT,                            -- 'user' | 'scanned' | 'registry'
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

Migration `032_workbench_unified_config.ts` also:

- Reads existing `settings.mcp_servers` JSON, inserts rows into `mcp_servers`, then **leaves the `settings` row** for one release (back-compat) with a deprecation comment.
- Backfills `agent_roles.external_config` for rows where it's NULL but the role is `external_cli:*` — runs the scanner once during migration.

### 6.3 `external_config` JSON shape (stored in `agent_roles.external_config`)

```typescript
interface ExternalAgentConfig {
  // packages/types/src/primitives.ts:339 — extended
  protocol: 'cli' | 'a2a';
  dispatchProtocol: 'acp' | 'headless' | 'terminal-only'; // NEW
  command: string; // 'claude'
  args?: string[]; // default args for terminal launch
  env?: Record<string, string>; // extra env (NOT api keys — those come from vault)
  workingDirectory?: string;
  sdkPackage?: string; // '@anthropic-ai/claude-agent-sdk' for Claude Code
  nativeConfigPaths: {
    // where the projector writes
    win32: string[];
    darwin: string[];
    linux: string[];
  };
  installMethod?: InstallMethod; // last-used install method
  detectCommand: string; // 'claude --version'
  // A2A-only:
  baseUrl?: string;
  healthCheckUrl?: string;
  authConfig?: { type: 'api_key' | 'oauth'; header?: string; envVar?: string };
  timeoutMs?: number;
  maxRetries?: number;
}
```

### 6.4 `UnifiedConfig` type (new, in-memory only — not persisted as one blob)

```typescript
// packages/types/src/workbench.ts (NEW)
interface UnifiedConfig {
  apiKeys: ApiKeyEntry[]; // decrypted in-memory, never persisted together
  mcpServers: McpServerEntry[]; // filtered by agent_binding for the target agent
  skills: SkillEntry[]; // filtered by agent_binding for the target agent
  agentSpecific: Record<string, unknown>;
}
```

---

## 7. Per-Agent Specs

For each supported agent: detect, native config paths, projector writes, dispatch protocol, install methods. **Verify against the agent's current docs before implementing each projector** — these paths are based on market research and a few are marked `[unverified]`.

### 7.1 Claude Code

- **Detect:** `claude --version`
- **Native config paths:**
  - Win32: `%USERPROFILE%\.claude\settings.json`, `%USERPROFILE%\.claude.json`, `<project>/.mcp.json`
  - Darwin/Linux: `~/.claude/settings.json`, `~/.claude.json`, `<project>/.mcp.json`
- **Projector writes:**
  - `settings.json`: `{ "env": { "ANTHROPIC_API_KEY": "<decrypted>" }, "mcpServers": {...}, "permissions": {...} }`
  - `.mcp.json` (project-scoped): MCP server list from binding
  - Skills: symlink/copy from `~/.cabinet/skills/<name>/` into `~/.claude/skills/<name>/`
- **Dispatch:** `acp` (via `@anthropic-ai/claude-agent-sdk`'s `query()`)
- **Install:** `npm i -g @anthropic-ai/claude-code` (all platforms); fallback `brew install claude-code` (darwin)

### 7.2 Codex CLI

- **Detect:** `codex --version`
- **Native config paths:** `[unverified]` `~/.codex/config.toml`, `~/.codex/mcp.json`
- **Projector writes:** TOML config with API key + model; MCP JSON
- **Dispatch:** `acp` (Codex supports ACP per goose docs) `[unverified — confirm before implementing]`
- **Install:** `npm i -g @openai/codex` (all); `brew install --cask codex` (darwin); `winget install OpenAI.Codex` (win32)

### 7.3 OpenCode

- **Detect:** `opencode --version`
- **Native config paths:** `~/.config/opencode/opencode.json` (win32: `%APPDATA%\opencode\opencode.json`), `~/.local/share/opencode/auth.json`
- **Projector writes:** `opencode.json` with `provider` (incl. `{env:VAR}` substitution), `mcp` (local + remote), `agent`, `permission`, `instructions`
- **Dispatch:** `headless` — `opencode run "<prompt>"` (non-interactive) `[unverified — confirm flag]`
- **Install:** `npm i -g opencode-ai` (all); `brew install opencode` (darwin); `scoop install opencode` (win32)

### 7.4 Gemini CLI

- **Detect:** `gemini --version`
- **Native config paths:** `[unverified]` `~/.gemini/settings.json`
- **Projector writes:** settings with `GEMINI_API_KEY` env, MCP server list
- **Dispatch:** `headless` — `gemini -p "<prompt>" --output-format json`
- **Install:** `npm i -g @google/gemini-cli` (all — `[unverified package name]`); `brew install gemini-cli` (darwin)

### 7.5 Kimi-CLI

- **Detect:** `kimi --version`
- **Native config paths:** `[unverified]` `~/.kimi/config.json`
- **Projector writes:** API key + model
- **Dispatch:** `headless` — `[unverified flag]`
- **Install:** `pip install kimi-cli` (all)

### 7.6 Qwen Code

- **Detect:** `qwen-code --version`
- **Native config paths:** `[unverified]` `~/.qwen/config.json`
- **Projector writes:** API key + model
- **Dispatch:** `headless` — `[unverified flag]`
- **Install:** `npm i -g @qwen-code/qwen-code` (all)

### 7.7 GLM

- **Detect:** `glm --version`
- **Native config paths:** `[unverified]` `~/.zhipu/config.json`
- **Projector writes:** API key + model
- **Dispatch:** `headless` — `[unverified flag]`
- **Install:** `pip install glm-cli` (all)

### 7.8 Aider

- **Detect:** `aider --version`
- **Native config paths:** `~/.aider.conf.yml`, `<project>/.aider.conf.yml`
- **Projector writes:** YAML config with `model: <provider>/<model>`, api keys via env
- **Dispatch:** `headless` — `aider --message "<prompt>" --yes --json`
- **Install:** `pip install aider-chat` (all); `brew install aider` (darwin)

### 7.9 Cline

- **Detect:** `cline --version`
- **Native config paths:** `~/.cline/` (rules, skills, mcp) `[unverified]`
- **Projector writes:** `.cline/skills/`, `.clinerules`, MCP config
- **Dispatch:** `headless` — `cline --json "<prompt>"` (stdin streaming)
- **Install:** `npm i -g cline` (all)

> **Unverified items above must be confirmed by reading each agent's `--help` output and config docs before its projector is implemented.** A projector that writes to the wrong path silently corrupts the user's config. Add a `--dry-run` first-run safeguard that prints the diff and asks the user to confirm.

---

## 8. File Changes

### 8.1 New files

| Path                                                              | Purpose                                                                                                                      |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `packages/types/src/workbench.ts`                                 | `UnifiedConfig`, `Projector`, `ProjectOptions`, `ScanResult`, `ScannerRecipe`, `InstallMethod`, `ExtractedConfig` types      |
| `packages/agent/src/discovery/scanner-recipe.ts`                  | `RECIPES: ScannerRecipe[]` — one per known agent (consolidates `KNOWN_CLI_AGENTS` + `CLI_DETECT_LIST` + `AGENT_DEFINITIONS`) |
| `packages/agent/src/discovery/scanner.ts`                         | `Scanner` class — `scanAll()`, `scanOne(recipe)`, `detect()`, `extractConfig()`, `upsertAgent()`                             |
| `packages/agent/src/discovery/config-extractor.ts`                | Read native config files (JSON/YAML/TOML), apply `ConfigExtractor` paths, return `ExtractedConfig`                           |
| `packages/agent/src/projector/index.ts`                           | `ProjectorRegistry` — maps `projectorId` → `Projector` instance                                                              |
| `packages/agent/src/projector/types.ts`                           | `Projector` interface (re-exported from types)                                                                               |
| `packages/agent/src/projector/claude-code.ts`                     | ClaudeCodeProjector                                                                                                          |
| `packages/agent/src/projector/codex.ts`                           | CodexProjector                                                                                                               |
| `packages/agent/src/projector/opencode.ts`                        | OpenCodeProjector                                                                                                            |
| `packages/agent/src/projector/gemini-cli.ts`                      | GeminiCliProjector                                                                                                           |
| `packages/agent/src/projector/kimi.ts`                            | KimiProjector                                                                                                                |
| `packages/agent/src/projector/qwen-code.ts`                       | QwenCodeProjector                                                                                                            |
| `packages/agent/src/projector/glm.ts`                             | GlmProjector                                                                                                                 |
| `packages/agent/src/projector/aider.ts`                           | AiderProjector                                                                                                               |
| `packages/agent/src/projector/cline.ts`                           | ClineProjector                                                                                                               |
| `packages/agent/src/adapters/acp/acp-client.ts`                   | ACP protocol client (reference: goose)                                                                                       |
| `packages/agent/src/adapters/acp/acp-runtime.ts`                  | `AcpRuntime implements HarnessRuntime`                                                                                       |
| `packages/agent/src/adapters/harness/headless-cli.ts`             | Refactored `BaseCliRuntime` — headless CLI mode with JSON stream parsing                                                     |
| `apps/server/src/routes/workbench/agents.ts`                      | New `/api/workbench/agents` routes: list, scan, scan-one, install, test, delete, get-detail, project-now                     |
| `apps/server/src/routes/workbench/mcp-reg.ts`                     | `/api/workbench/mcp/registry` — list/install from GitHub MCP Registry                                                        |
| `apps/server/src/context/scanner.ts`                              | Wires `Scanner` singleton into server context                                                                                |
| `apps/desktop/src/pages/Workbench/WorkbenchPage.tsx`              | Top-level Workbench page (sub-tab host)                                                                                      |
| `apps/desktop/src/pages/Workbench/AgentsTab.tsx`                  | Agent list + scan + market toggle + detail panel                                                                             |
| `apps/desktop/src/pages/Workbench/AgentDetailPanel.tsx`           | Per-agent config + bindings + project-now + open-terminal                                                                    |
| `apps/desktop/src/pages/Workbench/AgentMarketGrid.tsx`            | Install grid (folded from `AgentMarketPage`)                                                                                 |
| `apps/desktop/src/pages/Workbench/InstallDialog.tsx`              | Install SSE dialog (folded from `AgentMarketPage`)                                                                           |
| `apps/desktop/src/pages/Workbench/ApiKeysTab.tsx`                 | Moved from `pages/settings/ApiKeysTab.tsx` (no logic change)                                                                 |
| `apps/desktop/src/pages/Workbench/McpTab.tsx`                     | Moved from `pages/settings/McpTab.tsx` + new "Add from registry"                                                             |
| `apps/desktop/src/pages/Workbench/SkillsTab.tsx`                  | Moved from `pages/settings/SkillsTab.tsx` (no logic change)                                                                  |
| `apps/desktop/src/hooks/useScanner.ts`                            | Hook wrapping `/api/workbench/agents/scan`                                                                                   |
| `packages/storage/src/migrations/032_workbench_unified_config.ts` | New `mcp_servers` table + backfill + `external_config` backfill                                                              |

### 8.2 Modified files

| Path                                                           | Change                                                                                                                                                                             |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/agent/src/daemon/auto-discoverer.ts`                 | **Delete.** Replaced by `discovery/scanner.ts`. (Keep `DiscoveryResult` type if anything imports it — move to `packages/types`.)                                                   |
| `packages/agent/src/discovery/index.ts`                        | **Delete.** Replaced by `discovery/scanner.ts`.                                                                                                                                    |
| `packages/agent/src/discovery/agent-definitions.ts`            | **Delete.** Folded into `discovery/scanner-recipe.ts`.                                                                                                                             |
| `packages/agent/src/discovery/config-scanner.ts`               | **Delete.** Folded into `discovery/config-extractor.ts`.                                                                                                                           |
| `packages/agent/src/agent-roles.ts`                            | `registerExternalAgent` — change early-return to upsert (lines 466-507). `AgentRoleRegistry.reload` — accept `external_config` JSON, parse into `external` field.                  |
| `packages/agent/src/adapters/harness/base-cli.ts`              | Add `shell: isWindows` to all `spawn` calls (lines 132-137, 252-263). Rename to `headless-cli.ts` OR keep filename and refactor internally — prefer rename for clarity.            |
| `packages/agent/src/adapters/harness/factory.ts`               | Add `'acp'` branch (lines 80-101). Read `dispatchProtocol` from `external_config` instead of inferring from command.                                                               |
| `packages/agent/src/install/installer.ts`                      | Use `ScannerRecipe.install` methods instead of `AGENT_DEFINITIONS`. (Lines 30-100.)                                                                                                |
| `apps/server/src/context/agents.ts`                            | Load `external_config` JSON from `agent_roles` rows, parse into `AgentRoleRegistry` (lines 11-34).                                                                                 |
| `apps/server/src/context/daemon.ts`                            | Use `Scanner` instead of `AutoDiscoverer` (lines 15, 127-130).                                                                                                                     |
| `apps/server/src/routes/agents.ts`                             | Remove `CLI_DETECT_LIST` + divergent `/scan` impl (lines 405-544). `/scan` delegates to `Scanner.scanAll()`. `/api/agents` reads from `agent_roles` with parsed `external_config`. |
| `apps/server/src/routes/install.ts`                            | Use `ScannerRecipe.install`. `/deep-scan` delegates to `Scanner.scanAll()`.                                                                                                        |
| `apps/server/src/routes/workbench.ts`                          | **Split** into `routes/workbench/` subfolder. Keep bindings endpoints; add agent management endpoints.                                                                             |
| `apps/server/src/routes/employees.ts`                          | Remove external-agent POST path (lines 81-128 for `source='external_cli'`). External agents are not employees. `:id/test` only for non-external. (Lines 21, 45 — fix id format.)   |
| `apps/server/src/routes/secretary/agents/dispatch/external.ts` | ACP branch (lines 6-110). Read `external_config.dispatchProtocol`.                                                                                                                 |
| `apps/server/src/routes/settings/mcp.ts`                       | Read/write from new `mcp_servers` table instead of `settings` blob (lines 60-65). Keep back-compat read from `settings.mcp_servers` for one release.                               |
| `apps/server/src/index.ts`                                     | Mount new `/api/workbench/agents`, `/api/workbench/mcp/registry`. Remove old `/api/install/*` routes (folded into workbench). (Lines 67-103.)                                      |
| `apps/desktop/src/App.tsx`                                     | Fix `activeExternalAgent` to read `agent.external.command` (lines 128-132). Add Workbench top-level route.                                                                         |
| `apps/desktop/src/pages/SettingsPage.tsx`                      | Remove `ApiKeysTab` from tabs (line 11). Keep Theme/Monitor/PIS/Backups/Maintenance/Audit/Others. Add Rules tab here (moved from Discovery).                                       |
| `apps/desktop/src/pages/EmployeesPage.tsx`                     | Remove external-agent scan UI (lines 94-147, 264-269) + Agent Market toggle (lines 300-301). Keep only built-in/custom AI employee management.                                     |
| `packages/ui/src/navigation.tsx`                               | Add `Workbench` top-level item. Remove `Discovery`. (Lines 29-35.)                                                                                                                 |
| `apps/desktop/src/components/ChatView.tsx`                     | Terminal env from bindings (lines 269-285).                                                                                                                                        |
| `apps/desktop/src/components/terminal/TerminalTab.tsx`         | Accept `env` prop from bindings.                                                                                                                                                   |
| `apps/desktop/src-tauri/src/pty.rs`                            | Inherit `process.env` + merge spawn `env` (lines 59-61).                                                                                                                           |
| `apps/desktop/src/contexts/ChatContext.tsx`                    | `activeAgent` already extended — verify it accepts `external_cli:*` ids (line 342).                                                                                                |
| `packages/types/src/primitives.ts`                             | Extend `ExternalAgentConfig` with `dispatchProtocol`, `nativeConfigPaths`, `sdkPackage` (lines 339-356).                                                                           |
| `packages/types/src/index.ts`                                  | Re-export `workbench.ts`.                                                                                                                                                          |

### 8.3 Deleted files

| Path                                                    | Reason                                       |
| ------------------------------------------------------- | -------------------------------------------- |
| `apps/desktop/src/pages/DiscoveryPage.tsx`              | Tabs distributed to Workbench + Settings.    |
| `apps/desktop/src/pages/WorkbenchPage.tsx` (old)        | Replaced by `pages/Workbench/` folder.       |
| `apps/desktop/src/pages/AgentMarketPage.tsx`            | Folded into `Workbench/AgentMarketGrid.tsx`. |
| `apps/desktop/src/pages/settings/ExternalAgentsTab.tsx` | Stub — deleted.                              |
| `apps/desktop/src/pages/settings/ApiKeysTab.tsx`        | Moved to `pages/Workbench/ApiKeysTab.tsx`.   |
| `apps/desktop/src/pages/settings/McpTab.tsx`            | Moved to `pages/Workbench/McpTab.tsx`.       |
| `apps/desktop/src/pages/settings/SkillsTab.tsx`         | Moved to `pages/Workbench/SkillsTab.tsx`.    |
| `packages/agent/src/daemon/auto-discoverer.ts`          | Replaced by `discovery/scanner.ts`.          |
| `packages/agent/src/discovery/index.ts`                 | Replaced by `discovery/scanner.ts`.          |
| `packages/agent/src/discovery/agent-definitions.ts`     | Folded into `discovery/scanner-recipe.ts`.   |
| `packages/agent/src/discovery/config-scanner.ts`        | Folded into `discovery/config-extractor.ts`. |

---

## 9. DB Migration

`packages/storage/src/migrations/032_workbench_unified_config.ts`:

1. **Create `mcp_servers` table** (schema in §6.2).
2. **Backfill from `settings.mcp_servers`:** read the JSON blob, insert one row per server. Keep the `settings` row for back-compat (mark deprecated in a comment).
3. **Backfill `agent_roles.external_config`:** for every row where `type LIKE 'external_%'` AND `external_config IS NULL`, run the scanner for that command and write the JSON. If the CLI is no longer installed, leave NULL but write a minimal stub `{ protocol: 'cli', command: '<name>', dispatchProtocol: 'headless' }` so `dispatchToExternalAgent` doesn't bail with "no external config".
4. **Drop `employees.external_config` usage:** no schema change (column stays for compat), but code stops writing to it. A future migration can drop the column.

Migration is **one-directional** (per repo convention — no down migrations).

---

## 10. Implementation Phases

Each phase ends with a working, shippable state. Phases are ordered so that the bug fix (Phase 1) lands first — that alone closes the user's "not found" complaint.

### Phase 1 — Fix the dispatch chain (ship alone if needed)

**Goal:** external agents actually work end-to-end. No UI changes.

1. `BaseCliRuntime` / all `spawn` calls — add `shell: isWindows`. → verify: `pnpm -F @cabinet/agent test` passes; manual test on Windows: spawn `claude --version`.
2. `AutoDiscoverer.registerCliAgent` — write `external_config` JSON into the upsert payload. → verify: after scan, `SELECT external_config FROM agent_roles WHERE name='external_cli:claude'` is non-NULL.
3. `context/agents.ts` — parse `external_config` JSON into `AgentRoleRegistry`. → verify: after server restart, `registry.get('external_cli:claude').external` is defined.
4. `registerExternalAgent` — upsert instead of early-return. → verify: restart doesn't lose `external`.
5. `employees.ts:21,45` — single id format `external_cli:<command>`. → verify: `/api/employees` returns consistent ids.
6. `App.tsx:128-132` — read `agent.external.command`. → verify: terminal spawns the right binary.

**Done criterion:** scanning + chatting + terminal for Claude Code all work on Windows after a server restart.

### Phase 2 — Single Scanner + Projector skeleton

**Goal:** one scanner, one recipe list. Projector infra exists but only Claude Code projector is implemented.

1. Create `ScannerRecipe` type + `RECIPES` array (fold all three existing lists).
2. Create `Scanner` class with `scanAll` / `scanOne` / `detect` / `extractConfig` / `upsertAgent`.
3. Create `Projector` interface + `ProjectorRegistry`.
4. Implement `ClaudeCodeProjector` (writes `~/.claude/settings.json` + `.mcp.json`).
5. Replace `AutoDiscoverer` + `discovery/index.ts` + UI scan route list with `Scanner`.
6. Migration `032`: create `mcp_servers` table + backfill.
7. `routes/install.ts` uses `ScannerRecipe.install`.

**Done criterion:** `POST /api/workbench/agents/scan` returns one consistent list; Claude Code launch projects API key + MCP servers into `~/.claude/`.

### Phase 3 — ACP runtime + headless refactor

**Goal:** G3 works for Claude Code (ACP) + Aider/Gemini (headless).

1. Implement `AcpClient` (reference goose).
2. Implement `AcpRuntime implements HarnessRuntime`.
3. Refactor `BaseCliRuntime` → `HeadlessCliRuntime` with JSON stream parsing.
4. `HarnessRuntimeFactory` — ACP / headless / terminal-only branches by `dispatchProtocol`.
5. `dispatchToExternalAgent` — use the new factory.
6. Add `aider`, `gemini-cli` headless arg recipes; test end-to-end.

**Done criterion:** chat with Claude Code goes through ACP; chat with Aider goes through `aider --message` + JSON.

### Phase 4 — Unified Workbench UI

**Goal:** G5 — one place for everything.

1. Create `pages/Workbench/` folder with 4 sub-tabs.
2. Move `ApiKeysTab`, `McpTab`, `SkillsTab` into Workbench.
3. Implement `AgentsTab` (list + scan + market toggle + detail panel).
4. Implement `AgentDetailPanel` (per-agent MCP/skill bindings + project-now + open-terminal).
5. Implement `AgentMarketGrid` + `InstallDialog` (folded from `AgentMarketPage`).
6. Add Workbench to top-level nav; remove Discovery.
7. Move Rules from Discovery to Settings.
8. Strip external-agent UI from `EmployeesPage`.

**Done criterion:** user can scan, install, configure bindings, project config, and launch chat/terminal — all from Workbench. No duplicate surfaces.

### Phase 5 — Remaining projectors + MCP registry

**Goal:** long tail.

1. Implement projectors: Codex, OpenCode, Gemini CLI, Kimi, Qwen Code, GLM, Cline.
2. Verify each agent's native config paths (the `[unverified]` items in §7) before shipping each projector.
3. MCP Hub "Add from registry" — fetch from GitHub MCP Registry, write to `mcp_servers`.
4. Per-agent `--dry-run` projector safeguard: first run prints diff, user confirms.

**Done criterion:** every agent in §7 has a working projector + dispatch + install.

### Phase 6 — Terminal env injection + polish

1. `pty.rs` env merge.
2. `useTerminal` + `TerminalTab` accept env from bindings.
3. `ChatView` passes bound env when spawning terminal.
4. Terminal-only agents: chat banner with "Open Terminal" button.

**Done criterion:** opening terminal for Claude Code has the right `ANTHROPIC_API_KEY` + MCP path env.

---

## 11. Acceptance Criteria (per goal)

**G1 — Scan & auto-configure:**

- [ ] `POST /api/workbench/agents/scan` returns one list (no three-list divergence).
- [ ] For each installed agent, `agent_roles.external_config` is non-NULL and parseable.
- [ ] Extracted API keys appear in `GET /api/workbench/api-keys`.
- [ ] Extracted MCP servers appear in `GET /api/workbench/mcp`.
- [ ] Extracted skills appear in `GET /api/workbench/skills`.
- [ ] After server restart, `registry.get('external_cli:claude').external` is defined (no "no external config" error).

**G2 — One-click install:**

- [ ] Workbench → Agents → uninstalled agent card has **Install** button.
- [ ] Clicking Install opens a dialog with platform-appropriate methods.
- [ ] Install log streams live (SSE).
- [ ] On success, agent flips to `installed` and is auto-scanned (G1 criteria fire).

**G3 — In-app chat:**

- [ ] Selecting `external_cli:claude` in AgentTopBar and sending a message returns a real Claude Code response.
- [ ] Same for `external_cli:aider` (headless) and `external_cli:gemini` (headless).
- [ ] No `[Error] Agent ... has no external config.` anywhere in the chat path.
- [ ] On Windows, no `ENOENT` for `.cmd` shims (`shell: isWindows` applied).

**G4 — Embedded terminal:**

- [ ] Opening terminal for `external_cli:claude` spawns `claude` (not `agent_external_cli:claude`).
- [ ] Terminal env contains the agent's bound API key (verify via `echo $ANTHROPIC_API_KEY` in the terminal).
- [ ] Terminal-only agents show a chat banner with **Open Terminal** button.

**G5 — Unified management:**

- [ ] There is exactly one editable surface for API keys (Workbench → API Keys).
- [ ] Exactly one for MCP servers (Workbench → MCP Servers).
- [ ] Exactly one for skills (Workbench → Skills).
- [ ] No read-only mirror tabs exist.
- [ ] Per-agent MCP/skill bindings live on the agent's detail panel.
- [ ] **Project Now** on an agent detail panel writes the unified config into that agent's native config files (verify by diffing `~/.claude/settings.json` before/after).

---

## 12. Risks & Mitigations

| Risk                                                           | Mitigation                                                                                                                                                                                    |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Projector writes to wrong path → corrupts user's native config | Each projector's first run is `--dry-run` by default, prints a diff, user confirms. Projector unit tests against fixture config files.                                                        |
| `[unverified]` agent config paths in §7 turn out to be wrong   | Phase 5 lands projectors one at a time. Each PR must include a manual verification step that runs the agent's `--help` and reads its config docs.                                             |
| ACP support is narrower than expected (only Claude Code today) | `dispatchProtocol` falls back to `headless` then `terminal-only`. ACP is opportunistic, not load-bearing.                                                                                     |
| Claude Agent SDK commercial license                            | We depend on it only when the user has already installed Claude Code (accepted ToS). Not vendored, not redistributed.                                                                         |
| MCP `mcp_servers` table migration loses data                   | Migration reads `settings.mcp_servers` first, copies to new table, leaves the old row for one release. Add a smoke test that asserts row counts match.                                        |
| `external_config` backfill fails for uninstalled agents        | Migration writes a minimal stub so dispatch doesn't bail. Full config populated on next scan.                                                                                                 |
| Three-scanner removal breaks tests                             | Phase 2 deletes old scanners only after `Scanner` passes their tests. Keep old test cases, point them at `Scanner`.                                                                           |
| Terminal env leak (API key in PTY env, visible to subshell)    | Document this; PTY env is the only way to pass keys to non-SDK agents. Future: per-agent config file projection replaces env for keys (already the case for Claude Code via `settings.json`). |

---

## 13. Out of Scope (future specs)

- Cross-agent memory consolidation (each agent keeps native memory for now).
- A Cabinet-hosted MCP super-proxy (single endpoint aggregating all MCP servers).
- Custom skill authoring UI in Workbench (skills still authored as `SKILL.md` files).
- ACP **server** mode (Cabinet as an ACP agent — Cabinet is a manager, not an agent).
- Mobile and web clients.
- Per-project agent config overrides (the projector already supports `targetDir: 'project'`, but the UI for it is deferred).
- Claude Agent SDK vendoring / redistribution.

---

## 14. References

- Prior spec: [`2026-06-20-agent-workbench-design.md`](./2026-06-20-agent-workbench-design.md) (superseded)
- Embedded terminal design: [`2026-06-20-embedded-terminal-design.md`](./2026-06-20-embedded-terminal-design.md)
- cc-switch: https://github.com/farion1231/cc-switch (Tauri+Rust, MIT)
- opencode config: https://opencode.ai/config.json (JSON schema)
- goose ACP: https://github.com/aaif-goose/goose
- Claude Agent SDK: https://docs.claude.com/en/api/agent-sdk/overview
- claude-code-router: https://github.com/musistudio/claude-code-router
- continue config: https://github.com/continuedev/continue
- GitHub MCP Registry: https://github.com/mcp
