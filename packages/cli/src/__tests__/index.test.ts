import { describe, it, expect, vi, beforeAll } from 'vitest';

// Mock storage module BEFORE importing the source, to prevent side effects
// (the source auto-imports @cabinet/storage which creates DB connections)
vi.mock('@cabinet/storage', () => ({
  createConnection: vi.fn(),
  closeConnection: vi.fn(),
  runMigration001: vi.fn(),
  BackupManager: vi.fn().mockImplementation(() => ({
    startAutoBackup: vi.fn(),
    stopAutoBackup: vi.fn(),
    runMaintenance: vi.fn(),
  })),
}));

import { parseArgs, DATA_DIR, DB_PATH, BACKUP_DIR } from '../index.js';

describe('parseArgs (from source)', () => {
  it('returns help command for --help', () => {
    expect(parseArgs(['node', 'cabinet', '--help'])).toEqual({
      command: 'help',
      positional: [],
      flags: {},
    });
  });

  it('returns help command for -h', () => {
    expect(parseArgs(['node', 'cabinet', '-h'])).toEqual({
      command: 'help',
      positional: [],
      flags: {},
    });
  });

  it('returns version command for --version', () => {
    expect(parseArgs(['node', 'cabinet', '--version'])).toEqual({
      command: 'version',
      positional: [],
      flags: {},
    });
  });

  it('returns version command for -v', () => {
    expect(parseArgs(['node', 'cabinet', '-v'])).toEqual({
      command: 'version',
      positional: [],
      flags: {},
    });
  });

  it('parses --flag=value syntax', () => {
    const result = parseArgs(['node', 'cabinet', 'start', '--port=8080']);
    expect(result.command).toBe('start');
    expect(result.flags.port).toBe('8080');
  });

  it('parses --flag value syntax', () => {
    const result = parseArgs(['node', 'cabinet', 'start', '--port', '8080']);
    expect(result.command).toBe('start');
    expect(result.flags.port).toBe('8080');
  });

  it('parses boolean flags', () => {
    const result = parseArgs(['node', 'cabinet', 'start', '--verbose']);
    expect(result.command).toBe('start');
    expect(result.flags.verbose).toBe(true);
  });

  it('parses short flags (-p)', () => {
    const result = parseArgs(['node', 'cabinet', 'start', '-p', '3000']);
    expect(result.command).toBe('start');
    expect(result.flags.p).toBe('3000');
  });

  it('parses short boolean flags', () => {
    const result = parseArgs(['node', 'cabinet', 'backup', '-f']);
    expect(result.command).toBe('backup');
    expect(result.flags.f).toBe(true);
  });

  it('captures positional arguments after command', () => {
    const result = parseArgs(['node', 'cabinet', 'restore', 'my-backup.db']);
    expect(result.command).toBe('restore');
    expect(result.positional).toEqual(['my-backup.db']);
  });

  it('defaults to help when no command given', () => {
    const result = parseArgs(['node', 'cabinet']);
    expect(result.command).toBe('help');
    expect(result.positional).toEqual([]);
  });

  it('handles mixed flags and positional args', () => {
    const result = parseArgs(['node', 'cabinet', 'start', '--port=9000', 'extra-arg']);
    expect(result.command).toBe('start');
    expect(result.flags.port).toBe('9000');
    expect(result.positional).toEqual(['extra-arg']);
  });

  it('handles config command', () => {
    const result = parseArgs(['node', 'cabinet', 'config']);
    expect(result.command).toBe('config');
  });

  it('handles unknown commands as the command name', () => {
    const result = parseArgs(['node', 'cabinet', 'unknown-cmd']);
    expect(result.command).toBe('unknown-cmd');
  });
});

describe('path constants (from source)', () => {
  it('DATA_DIR resolves under homedir/.cabinet', () => {
    expect(DATA_DIR).toContain('.cabinet');
  });

  it('DB_PATH resolves under DATA_DIR/cabinet.db', () => {
    expect(DB_PATH).toContain('cabinet.db');
  });

  it('BACKUP_DIR resolves under DATA_DIR/backups', () => {
    expect(BACKUP_DIR).toContain('backups');
  });
});
