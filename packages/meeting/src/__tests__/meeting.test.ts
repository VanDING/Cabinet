import { describe, it, expect, beforeEach } from 'vitest';
import { MeetingService } from '../meeting-service.js';
import { MemoryEventBus } from '@cabinet/events';

describe('MeetingService', () => {
  let bus: MemoryEventBus;
  let service: MeetingService;

  beforeEach(() => {
    bus = new MemoryEventBus();
    service = new MeetingService(bus);
  });

  it('starts and completes a meeting', async () => {
    const result = await service.startMeeting({
      id: 'meeting-1', topic: 'Budget review', advisorIds: ['a1', 'a2', 'a3'],
    });
    expect(result.consensus).toContain('Budget review');
    expect(result.rounds).toBeGreaterThan(0);
    expect(bus.getAllEvents()).toHaveLength(2); // start + complete
  });

  it('caps advisors at MAX_MEETING_ADVISORS', async () => {
    const result = await service.startMeeting({
      id: 'meeting-2', topic: 'Test', advisorIds: ['a','b','c','d','e','f','g'],
    });
    expect(result.consensus).toContain('5 advisors'); // capped
  });

  it('estimates cost', () => {
    const cost = service.estimateCost(3, 2);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(0.05); // ~$0.036
  });
});
