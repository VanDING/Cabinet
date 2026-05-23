import { BACKUP_INTERVAL_MINUTES, BACKUP_KEEP_COUNT } from '@cabinet/types';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import Database from 'better-sqlite3';

export interface BackupConfig {
  dbPath: string;
  backupDir: string;
  intervalMinutes?: number;
  keepCount?: number;
  /** The live read-write connection, used for pre-backup WAL checkpoint. */
  liveConnection?: Database.Database;
}

export interface BackupResult {
  success: boolean;
  path?: string;
  error?: string;
}

export class BackupManager {
  private readonly config: Required<Omit<BackupConfig, 'liveConnection'>> & { liveConnection?: Database.Database };
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(config: BackupConfig) {
    this.config = {
      intervalMinutes: BACKUP_INTERVAL_MINUTES,
      keepCount: BACKUP_KEEP_COUNT,
      ...config,
    };
    mkdirSync(this.config.backupDir, { recursive: true });
  }

  /** Create a backup of the database. Returns structured result. */
  async backup(): Promise<BackupResult> {
    try {
      // Checkpoint WAL on the live connection so all writes are in the main file
      if (this.config.liveConnection) {
        try {
          this.config.liveConnection.pragma('wal_checkpoint(TRUNCATE)');
        } catch { /* non-fatal if live connection is unavailable */ }
      }

      if (!existsSync(this.config.dbPath)) {
        return { success: false, error: `Database file not found: ${this.config.dbPath}` };
      }

      const now = new Date();
      const timestamp = now.toISOString().replace(/[:.]/g, '-');
      const filename = `cabinet_backup_${timestamp}.db`;
      const destPath = join(this.config.backupDir, filename);

      const srcDb = new Database(this.config.dbPath, { readonly: true });
      await (srcDb as any).backup(destPath);
      srcDb.close();

      // Verify backup integrity
      const verifyDb = new Database(destPath, { readonly: true });
      const integrity = verifyDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
      verifyDb.close();

      if (integrity.length !== 1 || integrity[0]!.integrity_check !== 'ok') {
        try { unlinkSync(destPath); } catch { /* clean up corrupt file */ }
        return { success: false, error: `Backup integrity check failed: ${JSON.stringify(integrity)}` };
      }

      // Rotate old backups
      this.rotate();

      return { success: true, path: destPath };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { success: false, error };
    }
  }

  /** Start automatic periodic backups */
  startAutoBackup(): void {
    if (this.timer) return;
    this.timer = setInterval(
      () => {
        this.backup().then((result) => {
          if (!result.success) {
            console.error('Auto-backup failed:', result.error);
          }
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

  /**
   * Restore from a backup file.
   * - Validates the backup is a real SQLite database
   * - Creates a pre-restore snapshot of the current database
   * - Returns false and keeps the snapshot on failure
   */
  async restore(backupPath: string): Promise<boolean> {
    // Validate backup file exists and is a real SQLite database
    if (!existsSync(backupPath)) {
      throw new Error(`Backup file not found: ${backupPath}`);
    }
    try {
      const header = readFileSync(backupPath, { encoding: null }).subarray(0, 16);
      if (header.toString('utf8', 0, 15) !== 'SQLite format 3') {
        throw new Error('Not a valid SQLite database file');
      }
    } catch (err) {
      if ((err as Error).message.startsWith('Not a valid')) throw err;
      throw new Error(`Cannot read backup file: ${(err as Error).message}`);
    }

    // Create pre-restore snapshot
    const preRestorePath = join(this.config.backupDir, `pre_restore_${Date.now()}.db`);
    try {
      const srcDb = new Database(this.config.dbPath, { readonly: true });
      await (srcDb as any).backup(preRestorePath);
      srcDb.close();
    } catch {
      // Current DB may not exist or be corrupt — proceed anyway
    }

    // Perform restore
    try {
      const srcDb = new Database(backupPath, { readonly: true });
      await (srcDb as any).backup(this.config.dbPath);
      srcDb.close();

      // Verify restored DB
      const verifyDb = new Database(this.config.dbPath, { readonly: true });
      const integrity = verifyDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
      verifyDb.close();

      if (integrity.length !== 1 || integrity[0]!.integrity_check !== 'ok') {
        throw new Error(`Restored database integrity check failed: ${JSON.stringify(integrity)}`);
      }

      return true;
    } catch (err) {
      // Restore failed — the pre-restore snapshot is still available
      throw new Error(
        `Restore failed (pre-restore snapshot saved at ${preRestorePath}): ${(err as Error).message}`,
      );
    }
  }

  /**
   * Run database maintenance: VACUUM to reclaim space from deleted rows.
   * Should be called periodically (e.g., after each backup or weekly).
   */
  runMaintenance(): void {
    if (!this.config.liveConnection) return;
    try {
      this.config.liveConnection.pragma('wal_checkpoint(TRUNCATE)');
      this.config.liveConnection.exec('VACUUM');
    } catch (err) {
      console.error('Database maintenance failed:', (err as Error).message);
    }
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
