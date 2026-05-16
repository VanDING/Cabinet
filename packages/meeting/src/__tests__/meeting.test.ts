import { describe, it, expect, beforeEach } from 'vitest';
import { MeetingService } from '../meeting-service.js';
import { MemoryEventBus } from '@cabinet/events';
import type { Advisor } from '../parallel-reasoning.js';

function makeAdvisor(id: string): Advisor {
  return { id, name: id, role: 'Analyst', model: 'claude-haiku-4-5', perspective: `Analyze from ${id} angle.` };
}

describe('MeetingService', () => {
  let bus: MemoryEventBus;
  let service: MeetingService;

  beforeEach(() => {
    bus = new MemoryEventBus();
    service = new MeetingService(bus);
  });

  it('starts and completes a meeting', async () => {
    const advisors = [makeAdvisor('a1'), makeAdvisor('a2'), makeAdvisor('a3')];
    const result = await service.startMeeting({
      id: 'meeting-1', topic: 'Budget review', advisors,
    });
    expect(result.consensus).toContain('Budget review');
    expect(result.rounds).toBeGreaterThan(0);
    expect(result.advisorResults).toHaveLength(3);
    expect(result.costEstimate).toBeGreaterThan(0);
    expect(bus.getAllEvents()).toHaveLength(2); // start + complete
  });

  it('includes simulated advisor perspectives without gateway', async () => {
    const advisors = [makeAdvisor('advisor-1'), makeAdvisor('advisor-2')];
    const result = await service.startMeeting({
      id: 'meeting-sim', topic: 'Test', advisors,
    });
    expect(result.advisorResults).toHaveLength(2);
    expect(result.advisorResults[0]!.content).toContain('advisor-1');
    expect(result.advisorResults[0]!.content).toContain('Test');
  });

  it('estimates cost', () => {
    const cost = service.estimateCost(3, 2);
    expect(cost.estimatedCostUsd).toBeGreaterThan(0);
    expect(cost.estimatedCostUsd).toBeLessThan(0.05);
    expect(cost.requiresConfirmation).toBe(false);
  });

  it('cost estimate returns structured estimate', () => {
    const cost = service.estimateCost(4, 2);
    expect(cost.advisorCount).toBe(4);
    expect(cost.rounds).toBe(2);
    expect(cost.estimatedCostUsd).toBeGreaterThan(0);
    expect(cost.estimatedTokens.total).toBeGreaterThan(0);
  });

  it('quickMeeting works without gateway', async () => {
    const result = await service.quickMeeting('Test', [makeAdvisor('a')]);
    expect(result.advisorResults).toHaveLength(1);
  });

  describe('LLM-powered meetings', () => {
    const mockGateway = {
      async generateText({ messages }: any) {
        const prompt = messages[0].content as string;
        // Extract topic from the prompt: Topic: "..." or on "..."
        const topicMatch = prompt.match(/Topic: "([^"]+)"/);
        const topic = topicMatch?.[1] ?? 'the topic';
        const nameMatch = prompt.match(/You are the ([^(]+)/);
        const advisorName = (nameMatch?.[1] ?? '').trim() || 'unknown';
        return {
          content: `Analysis from ${advisorName} on ${topic}: mock analysis.`,
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
        id: 'meeting-llm', topic: 'Q3 Strategy', advisors: [makeAdvisor('advisor-1')],
      });
      expect(result.advisorResults).toHaveLength(1);
      expect(result.advisorResults[0]!.content).toContain('Q3 Strategy');
    });

    it('handles LLM errors with fallback to simulated', async () => {
      const failingGateway = {
        ...mockGateway,
        async generateText() { throw new Error('API error'); },
      };
      const svc = new MeetingService(bus, failingGateway as any);
      const result = await svc.startMeeting({
        id: 'meeting-err', topic: 'Test', advisors: [makeAdvisor('advisor-1')],
      });
      expect(result.advisorResults).toHaveLength(1);
      // Falls back to simulated meeting on error
      expect(result.consensus).toContain('Meeting failed');
      expect(result.consensus).toContain('API error');
    });
  });
});
