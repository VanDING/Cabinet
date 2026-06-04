//
// WorkspaceManager — isolated working directories for agent tasks.
//
// Three-tier GC (inspired by Multica):
//   - Full cleanup: completed/cancelled tasks, 24h TTL
//   - Orphan cleanup: directories without .gc_meta.json, 72h TTL
//   - Artifact cleanup: node_modules, .next, .turbo, 12h TTL
//

import { mkdirSync, rmSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { AgentDaemonRepository } from '@cabinet/storage';

const DEFAULT_WORKSPACES_ROOT = join(homedir(), '.cabinet', 'workspaces');

const ARTIFACT_PATTERNS = ['node_modules', '.next', '.turbo', 'dist', '.cache'];

export interface WorkspaceManagerConfig {
  rootDir?: string;
  fullCleanupTtlMs?: number;    // default 24h
  orphanCleanupTtlMs?: number;  // default 72h
  artifactCleanupTtlMs?: number; // default 12h
}

export class WorkspaceManager {
  private rootDir: string;
  private fullCleanupTtlMs: number;
  private orphanCleanupTtlMs: number;
  private artifactCleanupTtlMs: number;

  constructor(
    private readonly repo: AgentDaemonRepository,
    config: WorkspaceManagerConfig = {},
  ) {
    this.rootDir = config.rootDir ?? DEFAULT_WORKSPACES_ROOT;
    this.fullCleanupTtlMs = config.fullCleanupTtlMs ?? 86_400_000;
    this.orphanCleanupTtlMs = config.orphanCleanupTtlMs ?? 259_200_000;
    this.artifactCleanupTtlMs = config.artifactCleanupTtlMs ?? 43_200_000;
  }

  /** Create an isolated workspace directory for a task. */
  createWorkspace(agentId: string, taskId: string): string {
    const path = join(this.rootDir, agentId, taskId);
    mkdirSync(path, { recursive: true });

    // Write GC metadata
    writeFileSync(
      join(path, '.gc_meta.json'),
      JSON.stringify({ agentId, taskId, createdAt: new Date().toISOString() }),
    );

    // Persist to DB
    const expiresAt = new Date(Date.now() + this.fullCleanupTtlMs).toISOString();
    this.repo.createWorkspace({
      id: `${agentId}_${taskId}`,
      agent_id: agentId,
      task_id: taskId,
      path,
      size_bytes: 0,
      status: 'active',
      created_at: new Date().toISOString(),
      last_used_at: new Date().toISOString(),
      expires_at: expiresAt,
    });

    return path;
  }

  /** Get the workspace path for a task (does NOT create). */
  getWorkspacePath(agentId: string, taskId: string): string {
    return join(this.rootDir, agentId, taskId);
  }

  /** Calculate workspace directory size in bytes. */
  getWorkspaceSize(path: string): number {
    try {
      let size = 0;
      const entries = readdirSync(path, { withFileTypes: true });
      for (const entry of entries) {
        const full = join(path, entry.name);
        if (entry.isDirectory() && entry.name !== '.git') {
          size += this.getWorkspaceSize(full);
        } else if (entry.isFile()) {
          size += statSync(full).size;
        }
      }
      return size;
    } catch {
      return 0;
    }
  }

  /** Run garbage collection. Returns count of cleaned items. */
  runGC(): { fullCleaned: number; orphanCleaned: number; artifactCleaned: number } {
    const result = { fullCleaned: 0, orphanCleaned: 0, artifactCleaned: 0 };

    // Full cleanup: expired workspaces from DB
    try {
      const expired = this.repo.findExpiredWorkspaces();
      for (const ws of expired) {
        try {
          if (existsSync(ws.path)) {
            rmSync(ws.path, { recursive: true, force: true });
          }
          this.repo.updateWorkspaceStatus(ws.id, 'cleaned');
          result.fullCleaned++;
        } catch { /* skip */ }
      }
    } catch { /* DB error — skip */ }

    // Orphan cleanup: directories without .gc_meta.json
    try {
      if (existsSync(this.rootDir)) {
        const now = Date.now();
        const agentDirs = readdirSync(this.rootDir, { withFileTypes: true });
        for (const agentDir of agentDirs) {
          if (!agentDir.isDirectory()) continue;
          const agentPath = join(this.rootDir, agentDir.name);
          const taskDirs = readdirSync(agentPath, { withFileTypes: true });
          for (const taskDir of taskDirs) {
            if (!taskDir.isDirectory()) continue;
            const taskPath = join(agentPath, taskDir.name);
            const metaFile = join(taskPath, '.gc_meta.json');
            if (!existsSync(metaFile)) {
              try {
                const stat = statSync(taskPath);
                if (now - stat.mtimeMs > this.orphanCleanupTtlMs) {
                  rmSync(taskPath, { recursive: true, force: true });
                  result.orphanCleaned++;
                }
              } catch { /* skip */ }
            }
          }
        }
      }
    } catch { /* FS error — skip */ }

    // Artifact cleanup: remove regenerable build output
    try {
      if (existsSync(this.rootDir)) {
        const now = Date.now();
        this.cleanArtifactsRecursive(this.rootDir, now, result);
      }
    } catch { /* FS error — skip */ }

    return result;
  }

  private cleanArtifactsRecursive(
    dir: string, now: number, result: { artifactCleaned: number }, depth = 0,
  ): void {
    if (depth > 4) return;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name === '.git') continue;
        const full = join(dir, entry.name);
        if (ARTIFACT_PATTERNS.includes(entry.name)) {
          try {
            const stat = statSync(full);
            if (now - stat.mtimeMs > this.artifactCleanupTtlMs) {
              rmSync(full, { recursive: true, force: true });
              result.artifactCleaned++;
            }
          } catch { /* skip */ }
        } else {
          this.cleanArtifactsRecursive(full, now, result, depth + 1);
        }
      }
    } catch { /* skip */ }
  }
}
