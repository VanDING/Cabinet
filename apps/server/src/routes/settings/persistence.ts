import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { config } from '../../config.js';
import { CABINET_DIR } from '@cabinet/storage';

export const MASTER_PW = config.masterPassword;
export const SETTINGS_PATH = join(CABINET_DIR, 'settings.json');

export function loadSettings(): Record<string, unknown> {
  try {
    if (existsSync(SETTINGS_PATH)) {
      return JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));
    }
  } catch {
    /* file missing or corrupt */
  }
  return {};
}

export function saveSettings(updates: Record<string, unknown>): void {
  const current = loadSettings();
  const merged = { ...current, ...updates };
  writeFileSync(SETTINGS_PATH, JSON.stringify(merged, null, 2), 'utf-8');
}

export function parseNum(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
