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
    expect(result.advisorResults).toHaveLength(3);
    expect(result.costEstimate).toBeGreaterThan(0);
    expect(bus.getAllEvents()).toHaveLength(2); // start + complete
  });

  it('includes simulated advisor perspectives without gateway', async () => {
    const result = await service.startMeeting({
      id: 'meeting-sim', topic: 'Test', advisorIds: ['advisor-1', 'advisor-2'],
    });
    expect(result.advisorResults).toHaveLength(2);
    expect(result.advisorResults[0]!.perspective).toContain('advisor-1');
    expect(result.advisorResults[0]!.perspective).toContain('Test');
  });

  it('caps advisors at MAX_MEETING_ADVISORS', async () => {
    const result = await service.startMeeting({
      id: 'meeting-2', topic: 'Test', advisorIds: ['a','b','c','d','e','f','g'],
    });
    expect(result.consensus).toContain('5 advisors'); // capped
    expect(result.advisorResults).toHaveLength(5);
  });

  it('estimates cost', () => {
    const cost = service.estimateCost(3, 2);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(0.05); // ~$0.009
  });

  describe('LLM-powered meetings', () => {
    const mockGateway = {
      async generateText({ messages }: any) {
        const prompt = messages[0].content as string;
        // Extract advisor id and topic from the prompt
        const advisorMatch = prompt.match(/"([^"]+)"/);
        const advisorId = advisorMatch ? advisorMatch[1] : 'unknown';
        const topicMatch = prompt.match(/"([^"]+)"\s*$/m);
        const topic = topicMatch ? topicMatch[1] : prompt;
        return {
          content: `Perspective from ${advisorId} on ${topic}: this is a mock analysis.`,
          usage: { promptTokens: 10, completionTokens: 5 },
          model: 'test',
        };
      },
      async *streamText() { yield { type: 'done' as const }; },
      async listModels() { return []; },
      async generateEmbeddings() { return { embeddings: [], model: '', usage: { tokens: 0 } }; },
    };

    it('uses LLM gateway when provided', async () => {
      const svc = new MeetingService(bus, mockGateway as any);
      const result = await svc.startMeeting({
        id: 'meeting-llm', topic: 'Q3 Strategy', advisorIds: ['advisor-1'],
      });
      expect(result.advisorResults).toHaveLength(1);
      expect(result.advisorResults[0]!.perspective).toContain('Q3 Strategy');
    });

    it('handles LLM errors gracefully', async () => {
      const failingGateway = {
        ...mockGateway,
        async generateText() { throw new Error('API error'); },
      };
      const svc = new MeetingService(bus, failingGateway as any);
      const result = await svc.startMeeting({
        id: 'meeting-err', topic: 'Test', advisorIds: ['advisor-1'],
      });
      expect(result.advisorResults).toHaveLength(1);
      expect(result.advisorResults[0]!.perspective).toContain('[Error: API error]');
    });
  });
});
