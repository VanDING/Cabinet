# Agent Workbench Design

**Date:** 2026-06-20
**Status:** Draft
**Supersedes:** N/A

## Overview

Transform Cabinet from a single-agent chat interface into a unified agent workbench that discovers, installs, configures, and orchestrates multiple AI agents — both built-in and external.

The workbench covers five areas, each building on the previous:

1. **Agent Discovery & Config Scanning** — detect installed CLI agents, read their config files, extract API keys / MCP servers / skills
2. **Install Recipe System** — one-click installation of agents via platform-aware scripts
3. **ChatView Redesign** — agent top bar, session sidebar, multi-agent conversation
4. **Embedded Terminal** — xterm-based terminal for external agent TUI
5. **Unified Management Console** — API key vault, MCP hub, skill registry cross-agent

## 1. Agent Discovery & Config Scanning

### Current State

`AutoDiscoverer` (packages/agent/src/daemon/auto-discoverer.ts) only checks if CLI tools exist in PATH via `--version`. UI scan route (`POST /api/agents/scan`) duplicates this logic with different naming. Neither reads agent config files.

### Design

Each known agent defines a `ScannerRecipe`:

```typescript
interface ScannerRecipe {
  id: string;                    // 'claude-code'
  name: string;
  detectCommand: string;         // 'claude --version'
  platforms: {
    [platform: string]: {        // 'win32-x64' | 'darwin-arm64' | 'linux-x64'
      configPaths: string[];     // e.g. ['~/.claude.json', '%APPDATA%/Claude/claude.json']
      parsers: ConfigParser[];
    };
  };
}

interface ConfigParser {
  file: string;                  // config file path (relative to configPaths)
  format: 'json' | 'yaml' | 'toml';
  extract: {
    apiKeys?: { provider: string; path: string }[];        // JSON path to key
    mcpServers?: { path: string; nameTemplate: string }[]; // path to MCP server list
    skills?: { path: string }[];                            // path to skill list
  };
}
```

### Pre-built Scanner Recipes

| Agent | Config Files | Extractable |
|-------|-------------|-------------|
| Claude Code | `~/.claude.json`, `~/.claude/projects/*.json` | MCP servers, API keys, skills, hooks |
| Codex | `~/.codex/config.json`, `~/.codex/mcp.json` | API keys, MCP servers |
| OpenCode | `opencode.json` (project root + global) | Model config, MCP, permissions |
| Cursor | `~/.cursor/config.json` | MCP servers, model config |
| Gemini CLI | `~/.config/google-gemini/config.json` | API keys |
| Kimi | `~/.kimi/config.json` | API keys |
| Qwen Code | `~/.qwen/config.json` | API keys |
| GLM | `~/.zhipu/config.json` | API keys |

### Flow

```
User clicks "Scan for Agents" (or auto-scan at startup)
  → For each known agent:
    1. Run detectCommand (--version) — exists?
    2. For each configPath matching current platform:
       a. Resolve path (handle ~, %APPDATA%, etc.)
       b. If file exists, parse with format parser
       c. Extract API keys → Key Vault
       d. Extract MCP servers → MCP Hub
       e. Extract skills → Skill Registry
    3. Register agent as employee with source='external_cli'
    4. Store extracted config references in external_config field
```

### Files to Create/Modify

- New: `packages/agent/src/discovery/scanner-recipes.ts` — scanner recipe definitions
- New: `packages/agent/src/discovery/config-parser.ts` — parse + extract from config files
- New: `packages/agent/src/discovery/index.ts` — orchestrator
- Modify: `apps/server/src/routes/agents.ts` — scan route uses new scanner
- Modify: `packages/agent/src/daemon/auto-discoverer.ts` — use shared scanner

---

## 2. Install Recipe System

### Design

Each agent defines an `InstallRecipe` with platform-specific methods:

```typescript
interface InstallRecipe {
  id: string;
  name: string;
  description: string;
  icon: string;                  // brand icon reference
  platforms: {
    [platform: string]: {
      methods: InstallMethod[];
    };
  };
}

interface InstallMethod {
  type: 'brew' | 'npm' | 'pip' | 'winget' | 'choco' | 'binary' | 'cargo' | 'manual';
  label: string;                 // "Homebrew" / "npm" / etc.
  command: string;               // install command template
  checkCommand: string;          // post-install verification
  elevated?: boolean;            // requires admin/sudo
}
```

### Pre-built Recipes

| Agent | Windows | macOS | Linux |
|-------|---------|-------|-------|
| Claude Code | npm install | npm install / brew | npm install |
| Codex | winget/npm | brew/npm | curl+chmod/npm |
| Kimi | pip install | pip install | pip install |
| GLM | pip install | pip install | pip install |
| Qwen Code | npm install | npm install | npm install |
| Gemini CLI | npm install | brew/npm | apt/npm |

### UI

- Agent market panel: grid of agent cards with install button
- Install dialog: shows available methods for current OS, recommended first
- Real-time install log (SSE from server subprocess)
- Auto-scan after install

### Storage

Recipes stored as JSON files in `{dataDir}/recipes/`, loadable at startup. User can add custom recipes.

### Files to Create

- `packages/agent/src/install/install-recipe.ts` — type + validation
- `packages/agent/src/install/installer.ts` — execute recipe method, stream output
- `apps/server/src/routes/install.ts` — `POST /api/agents/install`, `GET /api/agents/install/log/:taskId`
- `packages/agent/src/install/recipes/` — pre-built recipe JSON files

---

## 3. ChatView Redesign (Immediate Priority)

### Current Deficiency

- Agent selection is a dropdown with 3 hardcoded options
- No external agents visible in chat UI
- Session history button is confusing
- No visual distinction between agents

### New Layout

```
┌──────────────────────────────────────────────────────────────┐
│  Agent Top Bar (固定高度 64px)                                │
│                                                              │
│  [Sc] [Cu] [Cl] [Co] [Ki] [GL] [Qw] [Op] ...  ◄  ░░░░░░    │
│   Sec  Cur  Clau Code Kimi GLM  Qwen Open     ↕ drag        │
│                                                              │
│  ← 选中高亮边框 + 底部活动指示条                              │
│  ← 状态点: ● active / ○ idle / ⊗ offline                    │
├────────────┬─────────────────────────────────────────────────┤
│ Session    │  Chat Messages                                   │
│ Sidebar    │  (现有 ChatView 内容)                             │
│            │                                                  │
│ Claude     │  [消息 + 思考 + 工具 + 结构化输出]               │
│  ● 重构API │                                                  │
│  ○ 调试bug │                                                  │
│  ○ 分析    │                                                  │
│            │                                                  │
│ Codex      │                                                  │
│  ○ 迁移    │                                                  │
│  ○ 文档    ├─────────────────────────────────────────────────┤
│            │  Chat Panel (input area)                        │
│            │  @Claude | [textarea...] | [Send] | [Context▾]  │
│            │  [project: xxx] [model: sonnet] [tier: max]     │
└────────────┴─────────────────────────────────────────────────┘
```

### Components

#### AgentTopBar (new)

```
apps/desktop/src/components/chat/AgentTopBar.tsx
```

- Horizontal scrollable row of agent avatars
- Each: DiceBear avatar (42px) + brand logo badge + status dot
- Active agent highlighted with bottom indicator line
- Scroll via wheel/drag if overflow
- Right side: session sidebar toggle button (☰) + drag handle

Data source: `GET /api/employees` → filtered to `kind === 'ai'`

#### SessionSidebar (new)

```
apps/desktop/src/components/chat/SessionSidebar.tsx
```

- Width: 260px (resizable)
- Hidden by default (`translateX(-100%)` + `hidden` class)
- Toggle button in AgentTopBar
- Groups sessions by agent (selected agent expanded, others collapsed)
- Each session: title, date, message count, status dot
- Click to switch session
- + New session button at top

Data source: `useSessions()` filtered by `session.agentId`

#### ChatView (modify)

```
apps/desktop/src/components/ChatView.tsx
```

- Wraps AgentTopBar + flex row of SessionSidebar + messages
- Pass `activeAgent` down to messages for routing indicator
- Empty state: "Start a conversation with [Agent Name]"

#### ChatPanel (modify)

```
apps/desktop/src/components/ChatPanel.tsx
```

- Remove session history button (clock icon, lines ~463-482)
- Keep: textarea, send/stop, context bar (project/model/tier/skill), @mention
- Session tabs in top bar: replace with simpler "current session" label
- session switching handled by SessionSidebar

### State Changes

#### ChatContext.tsx

- `activeAgent`: extend from `'secretary' | 'organize' | 'curator'` to `string` (any agent ID)
- Add `agents: AgentInfo[]` — list from API
- `setActiveAgent(id: string)` — switch target, reload sessions for that agent
- Sent messages include `targetAgent: activeAgent` in API body

### Data Flow

```
AgentTopBar.onSelect(agentId)
  → ChatContext.setActiveAgent(agentId)
    → if sessions for this agent exist: show them in sidebar
    → if no active session: create new session with agentId metadata
  → SessionSidebar re-renders with filtered sessions
  → Send message → POST /api/secretary/chat { targetAgent: agentId, ... }
```

### Migration Path

1. Create AgentTopBar component (standalone, testable)
2. Create SessionSidebar component (standalone)
3. Modify ChatView to embed both
4. Modify ChatPanel to remove session history button + integrate agent context
5. Modify ChatContext for external agent support
6. Wire up agent switching to chat API targetAgent

---

## 4. Embedded Terminal

### Design

Embedded xterm.js terminal for launching external agents in their native TUI mode (e.g., Claude Code's interactive terminal, Codex CLI).

```
┌──────────────────────────────────────┐
│  Terminal Tab Bar                     │
│  [Claude Code] [Codex] [+] [×]      │
├──────────────────────────────────────┤
│                                      │
│  ┌─── claude code ──────────────┐    │
│  │ $ claude                     │    │
│  │ ▸ Analyzing project...       │    │
│  │ ▸ What would you like me     │    │
│  │   to help with?              │    │
│  └──────────────────────────────┘    │
│                                      │
└──────────────────────────────────────┘
```

### Architecture

- Uses Tauri's PTY support (already exists in `src-tauri/src/pty.rs`)
- Frontend: `@xterm/xterm` + `@xterm/addon-fit` + `@xterm/addon-web-links`
- Each terminal session = one PTY process running the agent CLI
- Agent env vars injected: API keys, MCP config, etc.
- Terminal sessions persisted in session metadata

### Integration with Chat

- Chat message can spawn a terminal session
- Terminal output can be referenced in chat context
- "Open in terminal" button on agent cards

### Files to Create

- `apps/desktop/src/components/terminal/TerminalTab.tsx` — single tab
- `apps/desktop/src/components/terminal/TerminalPanel.tsx` — multi-tab panel
- `apps/desktop/src/components/terminal/xterm.css` — custom theme
- `apps/desktop/src/hooks/useTerminal.ts` — PTY lifecycle hook
- `apps/server/src/routes/terminal.ts` — PTY websocket relay (if needed)

---

## 5. Unified Management Console

### API Key Vault

- Encrypted SQLite storage (DB schema: `api_keys` table)
- Provider: Anthropic, OpenAI, DeepSeek, Google, OpenRouter, custom
- Multiple keys per provider with auto-failover
- Key health check: periodic test request
- Auto-injection: when launching external agent, write key to its env or config

### MCP Hub

- Single unified MCP endpoint: `localhost:{port}/mcp` (aggregates all servers)
- Server sources:
  - Scanned from external agent configs
  - User-added via UI
  - Smithery marketplace integration
- Per-agent MCP binding: `agent.mcpServers: string[]`
- Dynamic start/stop with health monitoring
- Namespace per server to prevent tool conflicts

### Skill Registry (cross-agent)

- Current skill system extended: skills can be bound to external agents
- Auto-scan `~/.claude/skills/` and similar paths
- Skill marketplace: built-in curated library
- Per-agent skill enable/disable

### Management UI

- Tab in main navigation: "Workbench"
- Sub-tabs: API Keys | MCP Servers | Skills | Agent Recipes
- Each: list view + add/edit modal

---

## Implementation Phases

### Phase 1 (Current) — ChatView Redesign
- AgentTopBar
- SessionSidebar
- ChatView/ChatPanel modifications
- ChatContext external agent support

### Phase 2 — Discovery & Recipes
- Deep config scanning
- Install recipe system
- Agent market UI
- API key vault (basic)

### Phase 3 — MCP Hub & Skills
- Unified MCP endpoint
- Cross-agent skill binding
- MCP/Skill management UI

### Phase 4 — Embedded Terminal
- xterm.js integration
- PTY session management
- Chat + terminal integration

### Phase 5 — Polish & Scale
- API key rotation / health checks
- Agent recipe editor (user custom recipes)
- Performance optimization

---

## Files Changed Summary

### Phase 1 (ChatView Redesign)

| File | Action |
|------|--------|
| `apps/desktop/src/components/chat/AgentTopBar.tsx` | Create |
| `apps/desktop/src/components/chat/SessionSidebar.tsx` | Create |
| `apps/desktop/src/components/chat/SessionGroup.tsx` | Create |
| `apps/desktop/src/components/ChatView.tsx` | Modify |
| `apps/desktop/src/components/ChatPanel.tsx` | Modify |
| `apps/desktop/src/contexts/ChatContext.tsx` | Modify |
| `apps/desktop/src/hooks/useSessions.ts` | Modify |
| `apps/desktop/src/hooks/useEmployees.ts` | Use existing |

### Phase 2

| File | Action |
|------|--------|
| `packages/agent/src/discovery/scanner-recipes.ts` | Create |
| `packages/agent/src/discovery/config-parser.ts` | Create |
| `packages/agent/src/discovery/index.ts` | Create |
| `packages/agent/src/install/install-recipe.ts` | Create |
| `packages/agent/src/install/installer.ts` | Create |
| `packages/agent/src/install/recipes/` | Create |
| `apps/server/src/routes/install.ts` | Create |
| `apps/desktop/src/pages/AgentMarketPage.tsx` | Create |
| `apps/desktop/src/components/InstallDialog.tsx` | Create |
| Modify `apps/server/src/routes/agents.ts` | Modify |

### Phase 3

| File | Action |
|------|--------|
| `apps/server/src/mcp/mcp-hub.ts` | Create/Modify |
| `apps/desktop/src/pages/WorkbenchPage.tsx` | Create |
| `apps/desktop/src/components/KeyVaultPanel.tsx` | Create |
| `apps/desktop/src/components/McpHubPanel.tsx` | Create |
| `apps/desktop/src/components/SkillManagerPanel.tsx` | Create |

### Phase 4

| File | Action |
|------|--------|
| `apps/desktop/src/components/terminal/TerminalTab.tsx` | Create |
| `apps/desktop/src/components/terminal/TerminalPanel.tsx` | Create |
| `apps/desktop/src/components/terminal/xterm.css` | Create |
| `apps/desktop/src/hooks/useTerminal.ts` | Create |
| `apps/desktop/src/hooks/usePty.ts` | Create |

---

## Architecture Diagram (Phase 1 focus)

```
┌──────────────────────────────────────────────────────────────┐
│  AgentTopBar                                                  │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐     │
│  │  Sc  │ │  Cu  │ │  Cl  │ │  Co  │ │  Ki  │ │  GL  │ ... │
│  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘     │
└──────────────────────────┬───────────────────────────────────┘
                           │ setActiveAgent(id)
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  ChatContext                                                  │
│  ┌─────────────┐ ┌──────────────┐ ┌──────────────────┐      │
│  │ activeAgent │ │ agents[]     │ │ sessionsByAgent  │      │
│  │ = claude    │ │ = [sec,cur,  │ │ = { claude: [...],│      │
│  │             │ │   claude,...]│ │   codex: [...] } │      │
│  └─────────────┘ └──────────────┘ └──────────────────┘      │
└──────────┬───────────────────────────────────────────────────┘
           │
     ┌─────┴─────┐
     │           │
     ▼           ▼
┌─────────┐ ┌──────────────────────────────────────────────────┐
│ Session │ │ Chat Messages + Input                            │
│ Sidebar │ │                                                  │
│         │ │ ChatView (existing, renders messages)            │
│ Claude: │ │ ChatPanel (existing, minus history button)       │
│  ● Ref  │ │                                                  │
│  ○ Bug  │ │ POST /api/secretary/chat { targetAgent, ... }    │
└─────────┘ └──────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│  Server Dispatch (existing)                                   │
│                                                              │
│  chat/dispatch.ts → specialist.ts → external.ts              │
│                                                              │
│  targetAgent = 'external_cli:claude'                         │
│    → dispatchToExternalAgent()                               │
│    → CliAdapter / HarnessRuntime                             │
│                                                              │
│  targetAgent = 'secretary'                                   │
│    → AgentLoop (existing path)                               │
└──────────────────────────────────────────────────────────────┘
```
