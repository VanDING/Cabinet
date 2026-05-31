# Getting Started

Cabinet is an open-source AI collaboration framework designed for super individuals and one-person companies. You are the **Captain**; the system is your Cabinet team. The core value is that the system digests most decision noise internally, only surfacing direction, boundaries, and exceptions to you.

## Quick Start

### Prerequisites

- **Node.js** 22+ with native ESM support
- **pnpm** for monorepo package management
- **Rust** toolchain (for Tauri desktop builds)

### Installation

```bash
# Clone the repository
git clone https://github.com/VanDING/Cabinet.git
cd Cabinet

# Install dependencies
pnpm install

# Build all packages
pnpm build
```

### Development Mode

Start the full stack in development mode:

```bash
# Terminal 1 — start the backend server
pnpm dev:server

# Terminal 2 — start the desktop app (Vite + Tauri)
pnpm dev:desktop
```

The desktop app will connect to the local server at `http://localhost:3000`.

### Without Desktop (Web Only)

If you prefer to run just the web frontend without Tauri:

```bash
cd apps/desktop
pnpm dev
```

This starts the React app in browser mode. Some native features (file system access, auto-updater) will be unavailable.

## First Steps

1. **Create a Project** — On first launch, create or import a project folder. Projects are the top-level containers for all work.
2. **Configure API Keys** — Go to **Settings > API Keys** and add your LLM provider keys. Supported providers include Anthropic, OpenAI, and Google.
3. **Set Delegation Tier** — In **Settings > Delegation**, choose your comfort level:
   - **T0 CaptainReview** — Every write and decision needs your confirmation.
   - **T1 StrategicGuard** (default) — Low-risk actions auto-execute; high-risk ones ask.
   - **T2 TrustedMode** — Most operations auto; only L3 decisions and destructive ops confirm.
   - **T3 FullAutonomy** — Everything auto; budget cap is the only gate.
4. **Chat with Your Secretary** — Open the chat panel and type a request. The Secretary will parse your intent, route to specialist agents when needed, and surface decisions for your approval.

## Project Structure

```
Cabinet/
├── apps/
│   ├── desktop/          # Tauri desktop app (React + Vite)
│   └── server/           # Node.js backend (Hono + Zod)
├── packages/
│   ├── types/            # Core TypeScript types
│   ├── events/           # Event bus (SQLite-backed)
│   ├── storage/          # SQLite persistence + migrations
│   ├── gateway/          # LLM gateway (Vercel AI SDK)
│   ├── agent/            # Agent loop, safety, context
│   ├── memory/           # 4-layer memory system
│   ├── secretary/        # Secretary agent + intent parser
│   ├── meeting/          # Meeting orchestration
│   ├── decision/         # Decision management (L0-L3)
│   ├── workflow/         # Workflow engine
│   ├── harness/          # Quality gates + observability
│   ├── ui/               # Shared React components
│   ├── organize/         # Project organization tools
│   └── cli/              # Command-line interface
├── tests/                # Unit, integration, and E2E tests
└── docs/site/            # VitePress documentation
```

## Next Steps

- Read the [Architecture Overview](./architecture) to understand the 4-layer design.
- Learn about [Development workflows](./development) for testing and debugging.
- Explore core concepts: [Agents](../concepts/agents), [Decisions](../concepts/decisions), [Memory](../concepts/memory-layers).
