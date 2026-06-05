import { describe, it, expect, vi } from 'vitest';
import { AuditLogger } from '../audit-log.js';
import type { Database } from '@cabinet/storage';

// AuditLogger takes a Database and creates an AuditLogRepository internally.
// The AuditLogRepository methods are called on the db.
// We need to mock the db.exec / db.prepare interface.

function createMockDb(): Database {
  // Mock the SQLite-style db that AuditLogRepository expects
  const mockStmt = {
    run: vi.fn(),
    get: vi.fn(),
    all: vi.fn().mockReturnValue([]),
    bind: vi.fn().mockReturnThis(),
  };
  return {
    exec: vi.fn(),
    prepare: vi.fn().mockReturnValue(mockStmt),
    close: vi.fn(),
  } as unknown as Database;
}

describe('AuditLogger', () => {
  describe('constructor', () => {
    it('creates an AuditLogger instance', () => {
      const db = createMockDb();
      const logger = new AuditLogger(db);
      expect(logger).toBeInstanceOf(AuditLogger);
    });
  });

  describe('log', () => {
    it('calls repo.insert with the provided entry', () => {
      const db = createMockDb();
      const mockStmt = {
        run: vi.fn(),
        get: vi.fn(),
        all: vi.fn().mockReturnValue([]),
        bind: vi.fn().mockReturnThis(),
      };
      (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue(mockStmt);

      const logger = new AuditLogger(db);
      logger.log({
        entityType: 'decision',
        entityId: 'dec_123',
        action: 'approved',
        actor: 'captain',
        changes: { status: 'approved', oldStatus: 'pending' },
      });

      // Verify the insert was called via db.prepare().run()
      expect(db.prepare).toHaveBeenCalled();
      expect(mockStmt.run).toHaveBeenCalled();
    });
  });

  describe('findByEntity', () => {
    it('queries repo and maps rows to AuditEntry', () => {
      const db = createMockDb();
      const mockRows = [
        {
          entity_type: 'decision',
          entity_id: 'dec_1',
          action: 'created',
          actor: 'system',
          changes: JSON.stringify({ title: 'Test' }),
          timestamp: '2026-01-15T10:00:00.000Z',
        },
      ];
      const mockStmt = {
        run: vi.fn(),
        get: vi.fn(),
        all: vi.fn().mockReturnValue(mockRows),
        bind: vi.fn().mockReturnThis(),
      };
      (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue(mockStmt);

      const logger = new AuditLogger(db);
      const entries = logger.findByEntity('decision', 'dec_1');

      expect(entries).toHaveLength(1);
      expect(entries[0].entityType).toBe('decision');
      expect(entries[0].entityId).toBe('dec_1');
      expect(entries[0].action).toBe('created');
      expect(entries[0].actor).toBe('system');
      expect(entries[0].changes).toEqual({ title: 'Test' });
      expect(entries[0].timestamp).toBeInstanceOf(Date);
    });

    it('returns empty array for no matches', () => {
      const db = createMockDb();
      const mockStmt = {
        run: vi.fn(),
        get: vi.fn(),
        all: vi.fn().mockReturnValue([]),
        bind: vi.fn().mockReturnThis(),
      };
      (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue(mockStmt);

      const logger = new AuditLogger(db);
      const entries = logger.findByEntity('nonexistent', 'id');
      expect(entries).toEqual([]);
    });
  });

  describe('findAll', () => {
    it('returns all entries from repo', () => {
      const db = createMockDb();
      const mockRows = [
        {
          entity_type: 'decision',
          entity_id: 'dec_1',
          action: 'created',
          actor: 'system',
          changes: JSON.stringify({}),
          timestamp: '2026-01-15T10:00:00.000Z',
        },
        {
          entity_type: 'workflow',
          entity_id: 'wf_1',
          action: 'started',
          actor: 'captain',
          changes: JSON.stringify({ status: 'running' }),
          timestamp: '2026-01-15T11:00:00.000Z',
        },
      ];
      const mockStmt = {
        run: vi.fn(),
        get: vi.fn(),
        all: vi.fn().mockReturnValue(mockRows),
        bind: vi.fn().mockReturnThis(),
      };
      (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue(mockStmt);

      const logger = new AuditLogger(db);
      const entries = logger.findAll();

      expect(entries).toHaveLength(2);
      expect(entries[0].entityType).toBe('decision');
      expect(entries[1].entityType).toBe('workflow');
    });
  });
});
