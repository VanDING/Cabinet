import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryEventBus } from '../memory-bus';
import { runEventBusContractTests } from './bus.contract.test';
import { MessageType } from '@cabinet/types';
import type { MessageEnvelope } from '@cabinet/types';

// Run the contract tests
runEventBusContractTests(
  () => new MemoryEventBus(),
  () => {}
);

// Memory-specific tests
describe('MemoryEventBus specific', () => {
  let bus: MemoryEventBus;

  beforeEach(() => {
    bus = new MemoryEventBus();
  });

  it('getCausationChain returns events with the same correlationId', async () => {
    const e1: MessageEnvelope = {
      messageId: 'msg-1',
      correlationId: 'corr-x',
      causationId: null,
      timestamp: new Date('2026-01-01T10:00:00Z'),
      messageType: MessageType.TaskOrder,
      payload: { orderId: 'o1', action: 'start' },
    };
    const e2: MessageEnvelope = {
      messageId: 'msg-2',
      correlationId: 'corr-x',
      causationId: 'msg-1',
      timestamp: new Date('2026-01-01T10:00:01Z'),
      messageType: MessageType.TaskCompleted,
      payload: { orderId: 'o1', result: {} },
    };

    await bus.publish(e1);
    await bus.publish(e2);

    const chain = await bus.getCausationChain('corr-x');
    expect(chain).toHaveLength(2);
    expect(chain[0]!.messageId).toBe('msg-1');
    expect(chain[1]!.messageId).toBe('msg-2');
  });

  it('getAllEvents returns all published events sorted by timestamp', async () => {
    const events: MessageEnvelope[] = [
      {
        messageId: 'later',
        correlationId: 'corr-1',
        causationId: null,
        timestamp: new Date('2026-01-01T10:00:02Z'),
        messageType: MessageType.TaskOrder,
        payload: {},
      },
      {
        messageId: 'earlier',
        correlationId: 'corr-1',
        causationId: null,
        timestamp: new Date('2026-01-01T10:00:01Z'),
        messageType: MessageType.TaskOrder,
        payload: {},
      },
    ];

    await bus.publish(events[0]!);
    await bus.publish(events[1]!);

    const all = bus.getAllEvents();
    expect(all).toHaveLength(2);
    expect(all[0]!.timestamp.getTime()).toBeLessThanOrEqual(all[1]!.timestamp.getTime());
  });
});
