# Phase 7 — Audit Remediation Plan

**Date:** 2026-06-21
**Trigger:** Phase 1-6 implementation audit
**Spec:** [`2026-06-21-agent-workbench-redesign.md`](../specs/2026-06-21-agent-workbench-redesign.md)
**Original plan:** [`2026-06-21-agent-workbench-implementation.md`](./2026-06-21-agent-workbench-implementation.md)

---

## Audit Summary

| Category                 | Count |
| ------------------------ | ----- |
| Critical bugs (blocking) | 1     |
| Medium bugs              | 2     |
| Deviations from plan     | 4     |
| Missing tests            | 6     |
| Tests created            | 5     |

This plan fixes the critical bug first (Phase 7a), then handles cleanup and tests (Phase 7b), and defers the AgentDaemon refactor (Phase 7c) as lower priority.

---

## Phase 7a — Hotfix: decrypt API keys before use

**Goal:** Projectors and terminal env endpoints use real (decrypted) API keys, not encrypted ciphertext.

**Reference:** `apps/server/src/crypto.ts` provides `decryptApiKey(encrypted, masterPassword)`. Master password is exported from `apps/server/src/routes/settings/persistence.ts:6` as `MASTER_PW`.

**Files:** 1 modified. Est. 0.5 day.

### P7a.T1 — Fix `/project` route encryption

**File:** `apps/server/src/routes/workbench/agents.ts`

**Problem line 99:** `key: k.encrypted_key` — passes AES-256 ciphertext to projector.

**Fix:**

```typescript
import { decryptApiKey } from '../../crypto.js';
import { MASTER_PW } from '../settings/persistence.js';

// In the project endpoint, change line 99 from:
const apiKeys = apiKeyRepo.findAll().map((k) => ({ provider: k.provider, key: k.encrypted_key }));
// to:
const apiKeys = apiKeyRepo.findAll().map((k) => ({
  provider: k.provider,
  key: decryptApiKey(k.encrypted_key, MASTER_PW),
}));
```

**Verify:** manual — after fix, Project Now on Claude Code should write the real Anthropic key (not encrypted base64) to `~/.claude/settings.json`.

### P7a.T2 — Fix `/env` route encryption

**File:** `apps/server/src/routes/workbench/agents.ts`

**Problem line 65:** `env[\`${upper}\_API_KEY\`] = key.encrypted_key` — encrypted value in env.

**Fix:**

```typescript
for (const key of apiKeyRepo.findAll()) {
  env[`${key.provider.toUpperCase()}_API_KEY`] = decryptApiKey(key.encrypted_key, MASTER_PW);
}
```

**Verify:** manual — after fix, opening terminal for a CLI agent and running `echo $ANTHROPIC_API_KEY` (or `%ANTHROPIC_API_KEY%` on Windows) should show the real key, not encrypted base64.

### Phase 7a exit criteria

- [ ] `pnpm -F @cabinet/server build` green
- [ ] `/project` passes decrypted key to projector
- [ ] `/env` returns decrypted env vars
- [ ] Commit

---

## Phase 7b — Cleanup & Missing Tests

**Goal:** Delete stale files, remove duplicate settings copies, add test coverage for critical paths.

**Files:** ~6 deleted, ~5 modified, ~6 new test files. Est. 1–2 days.

### P7b.T1 — Delete old discovery files `[parallel]`

**Plan ref:** P2.T10 (incomplete — files remained on disk)

**Delete:**

- `packages/agent/src/discovery/agent-definitions.ts`
- `packages/agent/src/discovery/config-scanner.ts`
- `packages/agent/src/discovery/index.ts`

**Grep check first:**

```bash
grep -r "agent-definitions\|config-scanner\|'./discovery/index'" packages/ apps/ --include="*.ts"
```

**Condition:** only delete if zero matches found outside the files themselves. The `agent/src/index.ts` already removed the exports (P2.T10). The `installer.ts` already switched to `RECIPES`. So this should be safe.

**Verify:** `pnpm build && pnpm typecheck` green.

### P7b.T2 — Delete duplicate settings copies `[parallel]`

**Plan ref:** DEV-3 (settings tabs were copied not moved)

**Delete:**

- `apps/desktop/src/pages/settings/ApiKeysTab.tsx`
- `apps/desktop/src/pages/settings/McpTab.tsx`
- `apps/desktop/src/pages/settings/SkillsTab.tsx`

**Modify `apps/desktop/src/pages/settings/index.ts`** — remove exports:

```typescript
// Remove these 3 lines:
// export { SkillsTab } from './SkillsTab.js';
// export { ApiKeysTab } from './ApiKeysTab.js';
// export { McpTab } from './McpTab.js';
```

Keep all other exports (RulesTab, BackupsTab, MaintenanceTab, AuditTab, OthersTab, ThemeTab, MonitorTab, PisTab).

**Grep check:** ensure no other file imports ApiKeysTab/McpTab/SkillsTab from `./settings/index.js`.

```bash
grep -r "from.*settings.*ApiKeysTab\|from.*settings.*McpTab\|from.*settings.*SkillsTab" apps/ --include="*.tsx"
```

**Verify:** `pnpm -F @cabinet/desktop exec npx tsc --noEmit --pretty` — zero errors.

### P7b.T3 — Add missing test: `HarnessRuntime / BaseCliRuntime` `[parallel]`

**Plan ref:** P1.T2 (missing test)

**New:** `packages/agent/src/adapters/harness/__tests__/base-cli.test.ts`

Tests:

- `dispatchTask` uses `spawnCrossPlatform` (mock it, verify called)
- `execSimple` uses `spawnCrossPlatform`
- `parseOutput` extracts tagged sections correctly
- Error handling: timeout → `status: 'timed_out'`, spawn error → `status: 'failed'`

**Verify:** `pnpm -F @cabinet/agent test -- base-cli`

### P7b.T4 — Add missing test: `context/agents` `[parallel]`

**Plan ref:** P1.T4 (missing test)

**New:** `apps/server/src/context/__tests__/agents.test.ts`

Tests:

- `external_config` JSON is parsed into `AgentRole.external`
- Row with NULL `external_config` → `external: undefined`
- Row with invalid JSON → `external: undefined` (graceful)
- Row with non-CLI/A2A protocol → `external: undefined`
- Only `external_cli`/`external_a2a` rows get `external` populated

**Verify:** `pnpm -F @cabinet/server test -- agents`

### P7b.T5 — Add missing test: `AcpRuntime` `[parallel]`

**Plan ref:** P3.T2 (missing test)

**New:** `packages/agent/src/adapters/acp/__tests__/acp-runtime.test.ts`

Tests:

- `start()` creates AcpClient and calls `connect()`
- `dispatchTask` calls `newSession` once then `prompt`, returns completed
- Error during dispatch → `status: 'failed'`
- `cancelTask` calls AcpClient.cancel

**Verify:** `pnpm -F @cabinet/agent test -- acp-runtime`

### P7b.T6 — Add missing test: `McpServerRepository` `[parallel]`

**Plan ref:** P2.T7 (no test for new repo)

**New:** `packages/storage/src/repositories/__tests__/mcp-server-repo.test.ts`

Tests:

- `upsert` inserts new row, updates existing
- `findAll` returns all rows
- `findByName` returns correct row or null
- `delete` removes row

**Verify:** `pnpm -F @cabinet/storage test -- mcp-server`

### P7b.T7 — Add missing test: `mcp-reg` route `[parallel]`

**Plan ref:** P5.T10 (missing test)

**New:** `apps/server/src/routes/workbench/__tests__/mcp-reg.test.ts`

Tests:

- `GET /` returns JSON with `servers` array
- `GET /` returns 502 when GitHub API fails
- `POST /install` inserts into mcp_servers and returns 200

**Verify:** `pnpm -F @cabinet/server test -- mcp-reg`

### Phase 7b exit criteria

- [ ] Zero stale discovery files on disk
- [ ] Zero duplicate settings tabs in `pages/settings/`
- [ ] 5 new test files created, all passing
- [ ] `pnpm build && pnpm typecheck && pnpm lint` green
- [ ] `pnpm test` passes all new + existing tests
- [ ] Commit

---

## Phase 7c — Replace AutoDiscoverer with Scanner in AgentDaemon (deferrable)

**Goal:** Single discovery path. `AgentDaemon` uses `Scanner` instead of `AutoDiscoverer`. Old `auto-discoverer.ts` deleted.

**Files:** ~5 modified, 1 deleted. Est. 1 day.

### P7c.T1 — Add `lastResults` cache + `discover()` to Scanner `[sequential]`

**File:** `packages/agent/src/discovery/scanner.ts`

Scanner needs two additional methods to match AutoDiscoverer's interface:

```typescript
private lastResults: ScanResult[] = [];

getLastResults(): ScanResult[] {
  return this.lastResults;
}
```

And `scanAll()` should cache:

```typescript
async scanAll(): Promise<ScanResult[]> {
  const results = await Promise.all(RECIPES.map((r) => this.scanOne(r)));
  this.lastResults = results;
  return results;
}
```

**Verify:** `pnpm -F @cabinet/agent test -- scanner` — existing + new tests pass.

### P7c.T2 — Update `AgentDaemon` to use Scanner `[sequential, depends on T1]`

**Files:**

- `packages/agent/src/daemon/agent-daemon/daemon.ts`
- `packages/agent/src/daemon/agent-daemon/internal.ts`
- `packages/agent/src/daemon/agent-daemon/discovery.ts`

**Changes:**

1. `daemon.ts:22` — replace `import { AutoDiscoverer, type DiscoveryResult } from '../auto-discoverer.js'` with `import { Scanner } from '../../discovery/scanner.js'`
2. `daemon.ts:49` — change `private discoverer: AutoDiscoverer` to `private discoverer: Scanner`
3. `daemon.ts:88` — change `new AutoDiscoverer(registry, undefined)` to `new Scanner(registry, undefined)`
4. `internal.ts:11` — change import and line 35 type
5. `discovery.ts:10` — change `discover()` call to `scanAll()` (Scanner exposes both)
6. Update `getDiscoveredAgents()` to map `ScanResult` → agent list

**Key type mapping:**

```typescript
// Old: triggerDiscovery → discoverer.discover() → DiscoveryResult[]
// New: triggerDiscovery → discoverer.scanAll() → ScanResult[]

// Old: discoverer.getLastResults() → DiscoveryResult[]
// New: discoverer.getLastResults() → ScanResult[]
```

**Verify:** `pnpm -F @cabinet/agent build` + `pnpm -F @cabinet/agent test -- agent-daemon` — existing tests must pass (they mock AutoDiscoverer, update mocks).

### P7c.T3 — Update daemon test mocks `[sequential, depends on T2]`

**File:** `packages/agent/src/daemon/agent-daemon/__tests__/agent-daemon.test.ts`

Line 20 currently has `AutoDiscoverer: function () { ... }`. Change to `Scanner: function () { ... }` with matching `scanAll()` and `getLastResults()` methods.

**Verify:** `pnpm -F @cabinet/agent test -- agent-daemon`

### P7c.T4 — Delete `auto-discoverer.ts` `[sequential, depends on T3]`

**Delete:**

- `packages/agent/src/daemon/auto-discoverer.ts`
- `packages/agent/src/daemon/__tests__/auto-discoverer.test.ts`
- `packages/agent/src/daemon/build-external-config.ts` — move to `packages/agent/src/utils/` or keep in `daemon/`? Keep in daemon/ since AgentDaemon still references it.

**Modify `packages/agent/src/daemon/index.ts`** — remove AutoDiscoverer export, add DiscoveryResult type export (if needed by consumers).

**Grep for remaining references:**

```bash
grep -r "AutoDiscoverer" packages/ apps/ --include="*.ts"
```

If zero, build and test.

**Verify:** `pnpm build && pnpm typecheck && pnpm test` green.

### Phase 7c exit criteria

- [ ] `AgentDaemon` uses `Scanner` (no `AutoDiscoverer` anywhere)
- [ ] `auto-discoverer.ts` deleted from disk
- [ ] `grep -r "AutoDiscoverer" packages/ apps/` returns zero results
- [ ] All existing daemon tests pass with Scanner mocks
- [ ] `pnpm build && pnpm typecheck && pnpm lint && pnpm test` green
- [ ] Commit

---

## Phase 7 End-to-End Verification

After all 7a-7c are committed:

- [ ] `pnpm build && pnpm typecheck && pnpm lint && pnpm lint:arch` green
- [ ] Full test suite passes: `pnpm test` (only pre-existing failures)
- [ ] `grep -r "encrypted_key" apps/server/src/routes/workbench/agents.ts` returns zero matches for key routing (confirms decryption is used)
- [ ] `grep -r "AutoDiscoverer" packages/ apps/ --include="*.ts"` returns zero results
- [ ] `grep -r "agent-definitions\|config-scanner\|discovery/index" packages/ --include="*.ts"` returns zero results
- [ ] `ls packages/agent/src/discovery/` shows only: `scanner-recipe.ts`, `scanner.ts`, `config-extractor.ts`, `__tests__/`
- [ ] `ls apps/desktop/src/pages/settings/` does NOT contain: `ApiKeysTab.tsx`, `McpTab.tsx`, `SkillsTab.tsx`

---

## File Changes Summary

### Phase 7a (Hotfix)

| File                                         | Action                                         |
| -------------------------------------------- | ---------------------------------------------- |
| `apps/server/src/routes/workbench/agents.ts` | Modify — decrypt keys in `/project` and `/env` |

### Phase 7b (Cleanup)

| File                                                                  | Action                    |
| --------------------------------------------------------------------- | ------------------------- |
| `packages/agent/src/discovery/agent-definitions.ts`                   | **Delete**                |
| `packages/agent/src/discovery/config-scanner.ts`                      | **Delete**                |
| `packages/agent/src/discovery/index.ts`                               | **Delete**                |
| `apps/desktop/src/pages/settings/ApiKeysTab.tsx`                      | **Delete**                |
| `apps/desktop/src/pages/settings/McpTab.tsx`                          | **Delete**                |
| `apps/desktop/src/pages/settings/SkillsTab.tsx`                       | **Delete**                |
| `apps/desktop/src/pages/settings/index.ts`                            | Modify — remove 3 exports |
| `packages/agent/src/adapters/harness/__tests__/base-cli.test.ts`      | **Create**                |
| `apps/server/src/context/__tests__/agents.test.ts`                    | **Create**                |
| `packages/agent/src/adapters/acp/__tests__/acp-runtime.test.ts`       | **Create**                |
| `packages/storage/src/repositories/__tests__/mcp-server-repo.test.ts` | **Create**                |
| `apps/server/src/routes/workbench/__tests__/mcp-reg.test.ts`          | **Create**                |

### Phase 7c (AgentDaemon refactor)

| File                                                                    | Action                                                 |
| ----------------------------------------------------------------------- | ------------------------------------------------------ |
| `packages/agent/src/discovery/scanner.ts`                               | Modify — add `lastResults` + `getLastResults()`        |
| `packages/agent/src/daemon/agent-daemon/daemon.ts`                      | Modify — replace AutoDiscoverer → Scanner              |
| `packages/agent/src/daemon/agent-daemon/internal.ts`                    | Modify — update type                                   |
| `packages/agent/src/daemon/agent-daemon/discovery.ts`                   | Modify — update function                               |
| `packages/agent/src/daemon/agent-daemon/__tests__/agent-daemon.test.ts` | Modify — update mocks                                  |
| `packages/agent/src/daemon/auto-discoverer.ts`                          | **Delete**                                             |
| `packages/agent/src/daemon/__tests__/auto-discoverer.test.ts`           | **Delete**                                             |
| `packages/agent/src/daemon/index.ts`                                    | Modify — remove AutoDiscoverer export                  |
| `packages/agent/src/index.ts`                                           | Modify — remove AutoDiscoverer export (if still there) |

### Phase 7 Execution order

```
Phase 7a (T1-T2)          ──── critical, do first
   │
   ▼
Phase 7b (T1-T7)          ──── parallel tasks (delete files + new tests)
   │
   ▼
Phase 7c (T1-T4)          ──── sequential (T1→T2→T3→T4)
   │
   ▼
End-to-end verification
```

---

## Notes

- BUG-1 fix (P7a.T1-T2) should be the **first commit** — it unblocks actual agent usage.
- Phase 7b tasks P7b.T1-T2 (deletes) and P7b.T3-T7 (tests) are independent and can run in parallel.
- Phase 7c is the highest-effort task (touches AgentDaemon internals). If time is constrained, defer to a follow-up PR.
- DEV-2 (HeadlessCliRuntime refactor) and DEV-4 (getAvailableAgents type change) are accepted deviations — no action needed.
- P5.T1 (config path verification) requires installing each agent CLI on a dev machine. Deferred to first smoke test on real hardware.
