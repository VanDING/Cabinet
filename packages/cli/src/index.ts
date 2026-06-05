#!/usr/bin/env node
import {
  createConnection,
  closeConnection,
  runMigration001,
  BackupManager,
} from '@cabinet/storage';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

export const DATA_DIR = join(homedir(), '.cabinet');
export const DB_PATH = join(DATA_DIR, 'cabinet.db');
export const BACKUP_DIR = join(DATA_DIR, 'backups');

// ── Argument parsing ──

export interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const rest: string[] = [];

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--help' || arg === '-h') return { command: 'help', positional: [], flags: {} };
    if (arg === '--version' || arg === '-v')
      return { command: 'version', positional: [], flags: {} };
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith('-')) {
          flags[arg.slice(2)] = next;
          i++;
        } else {
          flags[arg.slice(2)] = true;
        }
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        flags[arg.slice(1)] = next;
        i++;
      } else {
        flags[arg.slice(1)] = true;
      }
    } else {
      rest.push(arg);
    }
  }

  return { command: rest[0] ?? 'help', positional: rest.slice(1), flags };
}

// ── ANSI color helpers ──

const c = {
  reset: '\x1b[0m',
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  gray: (s: string) => `\x1b[90m${s}\x1b[0m`,
};

function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
    return pkg.version;
  } catch {
    return '2.0.0';
  }
}

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args.command === 'version') {
    console.log(`cabinet ${getVersion()}`);
    return;
  }

  if (args.command === 'help') {
    showHelp();
    return;
  }

  ensureDataDir();

  switch (args.command) {
    case 'start': {
      const port = String(args.flags.port ?? args.flags.p ?? '3000');
      console.log(c.bold('Cabinet Server'));
      console.log(c.gray(`Data: ${DATA_DIR}`));
      console.log(c.green(`Starting on http://localhost:${port}`));
      console.log(c.dim('Press Ctrl+C to stop'));
      console.log();

      const serverPath = join(import.meta.dirname, '..', '..', '..', 'apps', 'server');
      const child = spawn('node', ['--import', 'tsx', 'src/main.ts'], {
        cwd: serverPath,
        env: { ...process.env, PORT: port },
        stdio: 'inherit',
        shell: process.platform === 'win32',
      });

      child.on('error', (err) => {
        console.error(c.red(`Failed to start server: ${err.message}`));
        console.error(c.gray('Make sure @cabinet/server is installed and built.'));
        process.exit(1);
      });

      process.on('SIGINT', () => child.kill('SIGINT'));
      process.on('SIGTERM', () => child.kill('SIGTERM'));
      break;
    }

    case 'init': {
      console.log(c.cyan('Initializing database...'));
      const db = createConnection(DB_PATH);
      runMigration001(db);
      console.log(c.green(`Database initialized: ${DB_PATH}`));
      closeConnection();
      break;
    }

    case 'backup': {
      console.log(c.cyan('Creating backup...'));
      const db = createConnection(DB_PATH);
      const manager = new BackupManager({ dbPath: DB_PATH, backupDir: BACKUP_DIR });
      const path = await manager.backup();
      console.log(c.green(`Backup: ${path}`));
      const backups = manager.listBackups();
      console.log(c.gray(`Total backups: ${backups.length}`));
      closeConnection();
      break;
    }

    case 'restore': {
      const file = args.positional[0] ?? (args.flags.file as string | undefined);
      if (!file) {
        console.error(c.red('Usage: cabinet restore <backup-file>'));
        process.exit(1);
      }
      const db = createConnection(DB_PATH);
      const manager = new BackupManager({ dbPath: DB_PATH, backupDir: BACKUP_DIR });
      await manager.restore(file);
      console.log(c.green(`Restored: ${file}`));
      closeConnection();
      break;
    }

    case 'list-backups': {
      const db = createConnection(DB_PATH);
      const manager = new BackupManager({ dbPath: DB_PATH, backupDir: BACKUP_DIR });
      const backups = manager.listBackups();
      if (backups.length === 0) {
        console.log(c.gray('No backups found.'));
      } else {
        backups.forEach((b, i) => {
          console.log(
            `${c.cyan(String(i + 1))}. ${b.path} ${c.gray(`(${(b.size / 1024).toFixed(1)} KB)`)} - ${b.timestamp.toLocaleString()}`,
          );
        });
      }
      closeConnection();
      break;
    }

    case 'status': {
      console.log(c.bold(`Cabinet v${getVersion()}`));
      console.log(c.gray(`Data: ${DATA_DIR}`));
      if (existsSync(DB_PATH)) {
        const db = createConnection(DB_PATH);
        try {
          const projCount = (db.prepare('SELECT COUNT(*) as c FROM projects').get() as any)?.c ?? 0;
          const decCount = (db.prepare('SELECT COUNT(*) as c FROM decisions').get() as any)?.c ?? 0;
          console.log(c.green(`Database: ${DB_PATH}`));
          console.log(`  Projects:  ${projCount}`);
          console.log(`  Decisions: ${decCount}`);
        } catch {
          console.log(c.yellow('Database exists but may need migration. Run: cabinet init'));
        }
        closeConnection();
      } else {
        console.log(c.yellow('Database not initialized. Run: cabinet init'));
      }
      break;
    }

    case 'config': {
      console.log(c.bold('Configuration'));
      console.log(c.gray(`Data:    ${DATA_DIR}`));
      console.log(c.gray(`DB:      ${DB_PATH}`));
      console.log(c.gray(`Backups: ${BACKUP_DIR}`));
      console.log(c.bold('Environment'));
      console.log(`  PORT                 ${process.env.PORT ?? '3000'}`);
      console.log(
        `  ANTHROPIC_API_KEY    ${process.env.ANTHROPIC_API_KEY ? c.green('configured') : c.yellow('not set')}`,
      );
      console.log(
        `  OPENAI_API_KEY       ${process.env.OPENAI_API_KEY ? c.green('configured') : c.yellow('not set')}`,
      );
      console.log(
        `  DEEPSEEK_API_KEY     ${process.env.DEEPSEEK_API_KEY ? c.green('configured') : c.yellow('not set')}`,
      );
      break;
    }

    default: {
      console.error(c.red(`Unknown command: ${args.command}`));
      console.error(c.gray('Run: cabinet help'));
      process.exit(1);
    }
  }
}

function showHelp(): void {
  const v = getVersion();
  console.log();
  console.log(`  ${c.bold(`Cabinet CLI v${v}`)}  ${c.dim('AI Collaboration Framework')}`);
  console.log();
  console.log(`  ${c.bold('Usage:')} cabinet <command> [options]`);
  console.log();
  console.log(`  ${c.bold('Commands:')}`);
  console.log(`    ${c.cyan('start')}          Start the Cabinet server`);
  console.log(`    ${c.cyan('init')}           Initialize the database`);
  console.log(`    ${c.cyan('backup')}         Create a database backup`);
  console.log(`    ${c.cyan('restore')} <file>  Restore from a backup file`);
  console.log(`    ${c.cyan('list-backups')}   List all backups`);
  console.log(`    ${c.cyan('status')}         Show system status`);
  console.log(`    ${c.cyan('config')}         Show configuration`);
  console.log(`    ${c.cyan('help')}           Show this help`);
  console.log();
  console.log(`  ${c.bold('Options:')}`);
  console.log(`    ${c.dim('--help, -h')}      Show help`);
  console.log(`    ${c.dim('--version, -v')}   Show version`);
  console.log(`    ${c.dim('--port, -p')}      Server port (start command)`);
  console.log();
}

// Only auto-run when this file is the entry point (not when imported by tests)
const isEntryPoint = process.argv[1]?.includes('cabinet') || process.argv[1]?.endsWith('/index.js');
if (isEntryPoint || process.env.CABINET_CLI_TEST) {
  main().catch((err) => {
    console.error(c.red(`Error: ${err.message}`));
    process.exit(1);
  });
}
