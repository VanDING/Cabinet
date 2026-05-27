import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface Snapshot {
  /** Project root path. */
  root: string;
  /** File tree (first 3 levels), serialized as lines. */
  tree: string[];
  /** Key files discovered (package.json, README, CLAUDE.md, etc.). */
  keyFiles: string[];
  /** Human-readable one-line summary. */
  summary: string;
  /** When the snapshot was captured. */
  capturedAt: string;
}

/** In-memory cache for project snapshots per session. */
const snapshotCache = new Map<string, Snapshot>();

/** Key file names that help identify project type and structure. */
const KEY_FILE_NAMES = new Set([
  'package.json',
  'Cargo.toml',
  'pyproject.toml',
  'setup.py',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'CMakeLists.txt',
  'Makefile',
  'README.md',
  'CLAUDE.md',
  'LICENSE',
  'tsconfig.json',
  'vite.config.ts',
  'docker-compose.yml',
  'Dockerfile',
]);

export class ProjectSnapshot {
  /**
   * Capture a project snapshot by walking the file tree (first 3 levels).
   * Does not follow symlinks and skips node_modules/.git.
   */
  static capture(projectRoot: string): Snapshot {
    const tree: string[] = [];
    const keyFiles: string[] = [];

    const walk = (dir: string, depth: number) => {
      if (depth > 3) return;
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const name of entries) {
        if (
          name.startsWith('.') ||
          name === 'node_modules' ||
          name === 'dist' ||
          name === 'build' ||
          name === 'target'
        )
          continue;
        const fullPath = join(dir, name);
        let isDir: boolean;
        try {
          isDir = statSync(fullPath).isDirectory();
        } catch {
          continue;
        }
        const rel = relative(projectRoot, fullPath);
        const indent = '  '.repeat(depth);
        tree.push(`${indent}${isDir ? '📁' : '📄'} ${rel}`);
        if (!isDir && KEY_FILE_NAMES.has(name)) {
          keyFiles.push(rel);
        }
        if (isDir) {
          walk(fullPath, depth + 1);
        }
      }
    };

    walk(projectRoot, 0);

    const summary = ProjectSnapshot.buildSummary(projectRoot, keyFiles, tree.length);

    const snapshot: Snapshot = {
      root: projectRoot,
      tree: tree.slice(0, 200), // cap tree lines
      keyFiles,
      summary,
      capturedAt: new Date().toISOString(),
    };

    return snapshot;
  }

  /** Retrieve a cached snapshot for a project root. */
  static getCached(projectRoot: string): Snapshot | null {
    return snapshotCache.get(projectRoot) ?? null;
  }

  /** Store a snapshot keyed by project root (shared across sessions). */
  static store(projectRoot: string, snapshot: Snapshot): void {
    snapshotCache.set(projectRoot, snapshot);
  }

  /** Build a concise human-readable summary from discovered key files. */
  private static buildSummary(root: string, keyFiles: string[], totalEntries: number): string {
    const parts: string[] = [];
    parts.push(`Project root: ${root}`);
    if (keyFiles.length > 0) {
      parts.push(`Key files: ${keyFiles.join(', ')}`);
    }
    parts.push(`Scanned ${totalEntries} entries (first 3 levels).`);
    return parts.join(' | ');
  }
}
