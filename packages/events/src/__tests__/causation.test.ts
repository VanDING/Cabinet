import { describe, it, expect } from 'vitest';
import { buildCausationChain, validateCausation, isRootEvent } from '../causation';
import { MessageType } from '@cabinet/types';
import type { MessageEnvelope } from '@cabinet/types';

function makeEnvelope(
  overrides: Partial<Pick<MessageEnvelope, 'messageId' | 'correlationId' | 'causationId' | 'timestamp'>> = {},
): MessageEnvelope {
  return {
    messageId: 'msg-1',
    correlationId: 'corr-1',
    causationId: null,
    timestamp: new Date(),
    messageType: MessageType.SecretaryMessage,
    payload: { sessionId: 'sess-1', content: 'test' },
    ...overrides,
  } as MessageEnvelope;
}

describe('buildCausationChain', () => {
  it('returns events sorted by timestamp (oldest first)', () => {
    const t1 = new Date('2026-01-01T10:00:00Z');
    const t2 = new Date('2026-01-01T10:00:01Z');
    const t3 = new Date('2026-01-01T10:00:02Z');

    const events: MessageEnvelope[] = [
      makeEnvelope({ messageId: 'msg-3', causationId: 'msg-2', timestamp: t3 }),
      makeEnvelope({ messageId: 'msg-1', causationId: null, timestamp: t1 }),
      makeEnvelope({ messageId: 'msg-2', causationId: 'msg-1', timestamp: t2 }),
    ];

    const chain = buildCausationChain('msg-3', events);
    expect(chain).toHaveLength(3);
    expect(chain[0]!.messageId).toBe('msg-1');
    expect(chain[1]!.messageId).toBe('msg-2');
    expect(chain[2]!.messageId).toBe('msg-3');
  });

  it('returns only the target event if it has no causation chain', () => {
    const event = makeEnvelope({ messageId: 'msg-root', causationId: null });
    const chain = buildCausationChain('msg-root', [event]);
    expect(chain).toHaveLength(1);
    expect(chain[0]!.messageId).toBe('msg-root');
  });

  it('returns empty array if target event not found', () => {
    const chain = buildCausationChain('nonexistent', []);
    expect(chain).toHaveLength(0);
  });

  it('breaks cycles gracefully', () => {
    const events: MessageEnvelope[] = [
      makeEnvelope({ messageId: 'msg-a', causationId: 'msg-b' }),
      makeEnvelope({ messageId: 'msg-b', causationId: 'msg-a' }),
    ];
    const chain = buildCausationChain('msg-a', events);
    expect(chain.length).toBeGreaterThan(0);
    expect(chain.length).toBeLessThanOrEqual(2);
  });
});

describe('isRootEvent', () => {
  it('returns true for null causationId', () => {
    expect(isRootEvent(makeEnvelope({ causationId: null }))).toBe(true);
  });

  it('returns false for non-null causationId', () => {
    expect(isRootEvent(makeEnvelope({ causationId: 'msg-prev' }))).toBe(false);
  });
});

describe('validateCausation', () => {
  it('returns valid for a correct chain', () => {
    const events: MessageEnvelope[] = [
      makeEnvelope({ messageId: 'parent', causationId: null }),
      makeEnvelope({ messageId: 'child', causationId: 'parent' }),
    ];
    const result = validateCausation(events);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns invalid if causationId references nonexistent message', () => {
    const events: MessageEnvelope[] = [makeEnvelope({ messageId: 'child', causationId: 'ghost' })];
    const result = validateCausation(events);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns invalid for duplicate messageIds', () => {
    const events: MessageEnvelope[] = [
      makeEnvelope({ messageId: 'dup' }),
      makeEnvelope({ messageId: 'dup' }),
    ];
    const result = validateCausation(events);
    expect(result.valid).toBe(false);
  });
});
