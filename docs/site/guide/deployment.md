# Deployment

Cabinet is designed as a **local-first** application. The primary distribution method is a Tauri desktop app with an embedded local server. However, the server can also be deployed independently for team or remote scenarios.

## Desktop App Distribution

### Building the Tauri App

```bash
# Build production bundles for all platforms
pnpm build:desktop

# Or target a specific platform
pnpm build:desktop --target aarch64-apple-darwin
```

Outputs appear in `apps/desktop/src-tauri/target/release/bundle/`:
- `.msi` (Windows)
- `.dmg` (macOS)
- `.AppImage` / `.deb` (Linux)

### Auto-Updater

Tauri's built-in updater checks GitHub Releases for new versions. Configure the updater endpoint in `apps/desktop/src-tauri/tauri.conf.json`:

```json
{
  "plugins": {
    "updater": {
      "active": true,
      "endpoints": ["https://api.github.com/repos/VanDING/Cabinet/releases/latest"],
      "pubkey": "YOUR_PUBLIC_KEY"
    }
  }
}
```

The updater requires signed releases. See `docs/signing-guide.md` in the repository for key generation and CI integration.

## Server-Only Deployment

The backend (`apps/server`) is a standard Node.js HTTP service. It can run on a VPS, internal server, or container.

### Docker

A `Dockerfile` is provided at the repository root:

```bash
# Build image
docker build -t cabinet-server .

# Run
docker run -p 3000:3000 \
  -v cabinet-data:/data \
  -e CABINET_DATA_DIR=/data \
  cabinet-server
```

### Environment Variables

| Variable | Default | Description |
| :------- | :------ | :---------- |
| `CABINET_PORT` | `3000` | HTTP server port |
| `CABINET_DATA_DIR` | `~/.cabinet` | SQLite database and log storage |
| `CABINET_LOG_LEVEL` | `info` | Log verbosity (`debug`, `info`, `warn`, `error`) |
| `CABINET_BACKUP_DIR` | `~/.cabinet/backups` | Automatic backup destination |
| `CABINET_WEB_URL` | — | Allowed CORS origin for web frontend |

### Reverse Proxy (Nginx Example)

```nginx
server {
    listen 443 ssl http2;
    server_name cabinet.example.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

WebSocket support (`/ws`) requires the `Upgrade` headers as shown above.

## Data Management

### Automatic Backups

Backups run every 6 hours by default (configurable in **Settings > Backups**). The system retains the 7 most recent snapshots.

- **Backup naming**: `cabinet_backup_YYYYMMDD_HHMMSS.db`
- **Location**: `~/.cabinet/backups/` (desktop) or `$CABINET_BACKUP_DIR` (server)

### Manual Backup

```bash
# Via CLI
npx @cabinet/cli backup --output ./my-backup.db

# Via API
curl -X POST http://localhost:3000/api/backups \
  -H "Authorization: Bearer $TOKEN"
```

### Restore

```bash
# Via CLI
npx @cabinet/cli restore --file ./my-backup.db

# Via API
curl -X POST http://localhost:3000/api/backups/restore \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"filePath": "/path/to/backup.db"}'
```

> **Warning**: Restoring replaces the current database. Ensure no active sessions are writing before restoring.

## Security Checklist

Before deploying to production:

- [ ] API Keys are encrypted with AES-256-GCM at rest; only decrypted in memory at runtime
- [ ] Audit logging is enabled and covers decision changes, API key changes, workflow execution, and backup operations
- [ ] The `CABINET_WEB_URL` CORS origin is restricted to your actual frontend domain
- [ ] Backups do not contain unencrypted API keys (keys are stored separately in the encrypted `api_keys` table)
- [ ] SQL queries use parameterized statements (enforced by `better-sqlite3`)
- [ ] Zod schemas validate all API request bodies
- [ ] The delegation tier is set to at least **T1 StrategicGuard** (never T3 in shared environments)

## Updating

### Desktop App

The Tauri auto-updater checks on launch. If an update is available, a notification appears in the UI. The user can defer or install immediately.

### Server

```bash
# Pull latest code
git pull origin main

# Rebuild packages
pnpm install
pnpm build

# Restart server
pm2 restart cabinet-server
```

Database migrations run automatically on server startup. Always back up before major version upgrades.

## Troubleshooting

| Issue | Cause | Solution |
| :---- | :---- | :------- |
| Desktop shows "Server not found" | Backend not running | Start `apps/server` or check port conflict |
| WebSocket disconnects repeatedly | Reverse proxy missing upgrade headers | Add `proxy_set_header Upgrade` and `Connection` |
| High memory usage | Long-term memory index growing | Trigger consolidation via **Memory > Consolidate** |
| Budget alerts firing too early | RMB vs USD confusion | Limits are in **RMB**; adjust in Settings |
| Tauri build fails | Missing Rust toolchain | Install `rustup` and `cargo` |
