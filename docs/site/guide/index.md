# Getting Started

## Installation

```bash
# Clone the repository
git clone https://github.com/cabinet/cabinet.git
cd cabinet

# Install dependencies
pnpm install

# Start development
cd apps/server && pnpm dev    # API server on :3000
cd apps/desktop && pnpm tauri:dev  # Desktop app
```

## Configuration

Create `apps/server/.env`:
```env
PORT=3000
ANTHROPIC_API_KEY=sk-ant-api03-your-key
CABINET_MASTER_PASSWORD=your-secret
```

## Architecture

Cabinet follows a layered architecture with 13 packages:

```
apps/server     ← REST API + WebSocket
apps/desktop    ← Tauri 2.x + React 19
packages/       ← 13 business logic packages
```

See the [Architecture](/guide/architecture) page for details.
