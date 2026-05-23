import { BACKUP_INTERVAL_MINUTES, BACKUP_KEEP_COUNT } from '@cabinet/types';
import { join } from 'node:path';
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import Database from 'better-sqlite3';

export interface BackupConfig {
  dbPath: string;
  backupDir: string;
  intervalMinutes?: number;
  keepCount?: number;
}

export class BackupManager {
  private readonly config: Required<BackupConfig>;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(config: BackupConfig) {
    this.config = {
      intervalMinutes: BACKUP_INTERVAL_MINUTES,
      keepCount: BACKUP_KEEP_COUNT,
      ...config,
    };
    mkdirSync(this.config.backupDir, { recursive: true });
  }

  /** Create a backup of the database */
  async backup(): Promise<string> {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-');
    const filename = `cabinet_backup_${timestamp}.db`;
    const destPath = join(this.config.backupDir, filename);

    const srcDb = new Database(this.config.dbPath, { readonly: true });

    // better-sqlite3 v12+: backup(filename: string) returns Promise<void>
    // Always await — if sync (v11 scenario), await is a no-op; if async, it correctly waits
    await (srcDb as any).backup(destPath);

    srcDb.close();

    // Rotate old backups
    this.rotate();

    return destPath;
  }

  /** Start automatic periodic backups */
  startAutoBackup(): void {
    if (this.timer) return;
    // Offset by random amount to avoid exact-time clustering
    this.timer = setInterval(
      () => {
        this.backup().catch((error: Error) => {
          console.error('Auto-backup failed:', error.message);
        });
      },
      this.config.intervalMinutes * 60 * 1000,
    );
  }

  /** Stop automatic backups */
  stopAutoBackup(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** List all backups sorted by time (newest first) */
  listBackups(): { path: string; size: number; timestamp: Date }[] {
    try {
      const files = readdirSync(this.config.backupDir)
        .filter((f) => f.startsWith('cabinet_backup_') && f.endsWith('.db'))
        .map((f) => {
          const fullPath = join(this.config.backupDir, f);
          const stats = statSync(fullPath);
          return { path: fullPath, size: stats.size, timestamp: stats.mtime };
        })
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      return files;
    } catch {
      return [];
    }
  }

  /** Restore from a backup file */
  async restore(backupPath: string): Promise<void> {
    const srcDb = new Database(backupPath, { readonly: true });

    await (srcDb as any).backup(this.config.dbPath);

    srcDb.close();
  }

  /** Remove old backups exceeding keepCount */
  private rotate(): void {
    const backups = this.listBackups();
    const toDelete = backups.slice(this.config.keepCount);
    for (const backup of toDelete) {
      try {
        unlinkSync(backup.path);
      } catch {
        /* ignore */
      }
    }
  }
}
