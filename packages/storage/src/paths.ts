import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, mkdirSync } from 'node:fs';

/** Cabinet user data directory: ~/.cabinet (cross-platform). */
export const CABINET_DIR = join(homedir(), '.cabinet');

/** All subdirectories created on first startup. */
export const CABINET_SUBDIRS = [
  'agents',
  'skills',
  'mcp',
  'projects',
  'plugins',
  'sessions',
  'plans',
  'backups',
  'logs',
  'rules',
] as const;

export function ensureCabinetDir(): string {
  if (!existsSync(CABINET_DIR)) {
    mkdirSync(CABINET_DIR, { recursive: true });
  }
  for (const sub of CABINET_SUBDIRS) {
    const p = join(CABINET_DIR, sub);
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
  }
  return CABINET_DIR;
}
