import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqliteEventStore } from '../sqlite-store';
import { EventLogRepository } from '@cabinet/storage';
import { runEventBusContractTests } from './bus.contract.test';
import { createConnection, closeConnection, getConnection } from '@cabinet/storage';
import { runMigration001 } from '@cabinet/storage/migrations/001_initial';
import { MessageType } from '@cabinet/types';
import type { MessageEnvelope } from '@cabinet/types';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

let tmpDir: string;

function setupDb() {
  tmpDir = mkdtempSync(join(tmpdir(), 'cabinet-sqlite-store-'));
  createConnection(join(tmpDir, 'test.db'));
  runMigration001(getConnection());
}

// Top-level setup for ALL tests (contract + specific)
beforeAll(() => setupDb());
afterAll(() => {
  closeConnection();
  rmSync(tmpDir, { recursive: true, force: true });
});

// Run the contract tests (5 tests: publish, subscribe, unsubscribe, type filtering, async)
runEventBusContractTests(
  () => new SqliteEventStore(new EventLogRepository(getConnection())),
  () => {},
);

describe('SqliteEventStore specific', () => {
  it('getCausationChain traces complete causal chain via correlationId', async () => {
    const store = new SqliteEventStore(new EventLogRepository(getConnection()));

    await store.publish({
      messageId: 'root-msg',
      correlationId: 'chain-corr',
      causationId: null,
      timestamp: new Date('2026-01-01T10:00:00Z'),
      messageType: MessageType.SecretaryMessage,
      payload: { sessionId: 'sess-1', content: 'start' },
    });
    await store.publish({
      messageId: 'child-msg',
      correlationId: 'chain-corr',
      causationId: 'root-msg',
      timestamp: new Date('2026-01-01T10:00:01Z'),
      messageType: MessageType.TaskOrder,
      payload: { orderId: 'o1', action: 'process' },
    });
    await store.publish({
      messageId: 'grandchild-msg',
      correlationId: 'chain-corr',
      causationId: 'child-msg',
      timestamp: new Date('2026-01-01T10:00:02Z'),
      messageType: MessageType.TaskCompleted,
      payload: { orderId: 'o1', result: {} },
    });

    const chain = await store.getCausationChain('chain-corr');
    expect(chain).toHaveLength(3);
    expect(chain[0]!.messageId).toBe('root-msg');
    expect(chain[2]!.messageId).toBe('grandchild-msg');
  });

  it('events are persisted across store instances', async () => {
    const store1 = new SqliteEventStore(new EventLogRepository(getConnection()));
    await store1.publish({
      messageId: 'persist-msg',
      correlationId: 'persist-corr',
      causationId: null,
      timestamp: new Date(),
      messageType: MessageType.SecretaryMessage,
      payload: { sessionId: 'sess-1', content: 'persistent' },
    });

    const store2 = new SqliteEventStore(new EventLogRepository(getConnection()));
    const chain = await store2.getCausationChain('persist-corr');
    expect(chain).toHaveLength(1);
    expect(chain[0]!.messageId).toBe('persist-msg');
  });
});
