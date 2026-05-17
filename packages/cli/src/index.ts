#!/usr/bin/env node
import {
  createConnection,
  closeConnection,
  runMigration001,
  BackupManager,
  getConnection,
} from '@cabinet/storage';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, existsSync } from 'node:fs';

const DATA_DIR = join(homedir(), '.cabinet');
const DB_PATH = join(DATA_DIR, 'cabinet.db');
const BACKUP_DIR = join(DATA_DIR, 'backups');

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'help';
  ensureDataDir();

  switch (command) {
    case 'start': {
      console.log('Starting Cabinet server...');
      console.log('Run: cd apps/server && pnpm dev');
      console.log(`Data directory: ${DATA_DIR}`);
      break;
    }

    case 'init': {
      console.log('Initializing Cabinet database...');
      const db = createConnection(DB_PATH);
      runMigration001(db);
      console.log(`Database initialized at: ${DB_PATH}`);
      closeConnection();
      break;
    }

    case 'backup': {
      console.log('Creating backup...');
      const db = createConnection(DB_PATH);
      const manager = new BackupManager({ dbPath: DB_PATH, backupDir: BACKUP_DIR });
      const path = manager.backup();
      console.log(`Backup created: ${path}`);
      const backups = manager.listBackups();
      console.log(`Total backups: ${backups.length}`);
      closeConnection();
      break;
    }

    case 'restore': {
      const file = process.argv[3];
      if (!file) {
        console.error('Usage: cabinet restore <backup-file>');
        process.exit(1);
      }
      const db = createConnection(DB_PATH);
      const manager = new BackupManager({ dbPath: DB_PATH, backupDir: BACKUP_DIR });
      manager.restore(file);
      console.log(`Restored from: ${file}`);
      closeConnection();
      break;
    }

    case 'list-backups': {
      const db = createConnection(DB_PATH);
      const manager = new BackupManager({ dbPath: DB_PATH, backupDir: BACKUP_DIR });
      const backups = manager.listBackups();
      if (backups.length === 0) {
        console.log('No backups found.');
      } else {
        backups.forEach((b, i) => {
          console.log(
            `${i + 1}. ${b.path} (${(b.size / 1024).toFixed(1)} KB) - ${b.timestamp.toLocaleString()}`,
          );
        });
      }
      closeConnection();
      break;
    }

    case 'status': {
      console.log('Cabinet v2.0.0');
      console.log(`Data directory: ${DATA_DIR}`);
      if (existsSync(DB_PATH)) {
        const db = createConnection(DB_PATH);
        const orgCount = (db.prepare('SELECT COUNT(*) as c FROM organizations').get() as any).c;
        const decisionCount = (db.prepare('SELECT COUNT(*) as c FROM decisions').get() as any).c;
        console.log(`Database: ${DB_PATH}`);
        console.log(`Organizations: ${orgCount}`);
        console.log(`Decisions: ${decisionCount}`);
        closeConnection();
      } else {
        console.log('Database not initialized. Run: cabinet init');
      }
      break;
    }

    case 'config': {
      console.log(`Data directory: ${DATA_DIR}`);
      console.log(`Database: ${DB_PATH}`);
      console.log(`Backups: ${BACKUP_DIR}`);
      console.log('Environment variables:');
      console.log(`  PORT=${process.env.PORT ?? '3000'}`);
      console.log(
        `  ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY ? '***configured***' : 'not set'}`,
      );
      console.log(
        `  OPENAI_API_KEY=${process.env.OPENAI_API_KEY ? '***configured***' : 'not set'}`,
      );
      break;
    }

    case 'help':
    default: {
      console.log(`
Cabinet CLI v2.0.0 — AI Collaboration Framework

Usage: cabinet <command>

Commands:
  init           Initialize the database
  start          Start the Cabinet server
  backup         Create a database backup
  restore <file> Restore from a backup file
  list-backups   List all backups
  status         Show system status
  config         Show configuration
  help           Show this help
`);
      break;
    }
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
