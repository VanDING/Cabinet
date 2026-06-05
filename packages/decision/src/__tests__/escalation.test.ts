import { describe, it, expect, vi } from 'vitest';
import { EscalationService } from '../escalation.js';
import { MessageType } from '@cabinet/types';
import type { EventBus } from '@cabinet/events';

describe('EscalationService', () => {
  function createMockEventBus(): EventBus {
    return {
      publish: vi.fn().mockResolvedValue(undefined),
    } as unknown as EventBus;
  }

  describe('constructor', () => {
    it('creates an EscalationService instance', () => {
      const bus = createMockEventBus();
      const service = new EscalationService(bus);
      expect(service).toBeInstanceOf(EscalationService);
    });
  });

  describe('escalate', () => {
    it('publishes an escalation event to the event bus', async () => {
      const bus = createMockEventBus();
      const service = new EscalationService(bus);

      await service.escalate('dec_001', 'Budget Decision', 'L2');

      expect(bus.publish).toHaveBeenCalledTimes(1);
      const event = (bus.publish as ReturnType<typeof vi.fn>).mock.calls[0][0];

      expect(event.messageId).toMatch(/^escalation_dec_001_\d+$/);
      expect(event.correlationId).toBe('dec_001');
      expect(event.causationId).toBeNull();
      expect(event.timestamp).toBeInstanceOf(Date);
      expect(event.messageType).toBe(MessageType.SystemNotification);
      expect(event.payload.type).toBe('decision_escalation');
      expect(event.payload.message).toBe('Decision escalated: Budget Decision (Level: L2)');
      expect(event.payload.data.decisionId).toBe('dec_001');
      expect(event.payload.data.title).toBe('Budget Decision');
      expect(event.payload.data.level).toBe('L2');
      expect(event.payload.data.urgency).toBe('normal');
    });

    it('marks L3 escalations as immediate urgency', async () => {
      const bus = createMockEventBus();
      const service = new EscalationService(bus);

      await service.escalate('dec_002', 'Critical Security Issue', 'L3');

      const event = (bus.publish as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(event.payload.data.urgency).toBe('immediate');
      expect(event.payload.message).toContain('L3');
    });

    it('includes decisionId and level in payload data', async () => {
      const bus = createMockEventBus();
      const service = new EscalationService(bus);

      await service.escalate('dec_abc', 'Test', 'L1');

      const event = (bus.publish as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(event.payload.data).toEqual({
        decisionId: 'dec_abc',
        title: 'Test',
        level: 'L1',
        urgency: 'normal',
      });
    });
  });
});
