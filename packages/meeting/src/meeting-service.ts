import type { EventBus } from '@cabinet/events';
import { MessageType } from '@cabinet/types';
import { MAX_DEBATE_ROUNDS, MAX_MEETING_ADVISORS } from '@cabinet/types';
import type { LLMGateway } from '@cabinet/gateway';

export interface MeetingConfig {
  id: string;
  topic: string;
  advisorIds: string[];
  maxRounds?: number;
}

export interface AdvisorResult {
  advisorId: string;
  perspective: string;
}

export interface MeetingResult {
  meetingId: string;
  consensus: string;
  minorityReport?: string;
  advisorResults: AdvisorResult[];
  rounds: number;
  costEstimate: number;
}

export class MeetingService {
  constructor(
    private readonly eventBus: EventBus,
    private readonly gateway?: LLMGateway
  ) {}

  async startMeeting(config: MeetingConfig): Promise<MeetingResult> {
    const maxRounds = config.maxRounds ?? MAX_DEBATE_ROUNDS;
    const advisorCount = Math.min(config.advisorIds.length, MAX_MEETING_ADVISORS);
    const advisors = config.advisorIds.slice(0, advisorCount);

    // Publish meeting started event
    await this.eventBus.publish({
      messageId: `meeting_start_${config.id}`,
      correlationId: config.id,
      causationId: null,
      timestamp: new Date(),
      messageType: MessageType.MeetingStarted,
      payload: { meetingId: config.id, topic: config.topic, advisorCount },
    });

    // Run advisors — real LLM if gateway available, otherwise simulated
    let advisorResults: AdvisorResult[];
    if (this.gateway) {
      advisorResults = await this.runParallelAdvisors(config.topic, advisors);
    } else {
      advisorResults = advisors.map(id => ({
        advisorId: id,
        perspective: `Perspective from ${id} on: ${config.topic}`,
      }));
    }

    // Synthesize consensus from perspectives
    const perspectives = advisorResults.map(r => r.perspective).join(' | ');
    const consensus = `Consensus on "${config.topic}" from ${advisorResults.length} advisors: ${perspectives.slice(0, 500)}`;

    const actualCost = this.estimateCost(advisorCount, 1);

    const result: MeetingResult = {
      meetingId: config.id,
      consensus,
      advisorResults,
      rounds: 1,
      costEstimate: actualCost,
    };

    // Publish result
    await this.eventBus.publish({
      messageId: `meeting_result_${config.id}`,
      correlationId: config.id,
      causationId: `meeting_start_${config.id}`,
      timestamp: new Date(),
      messageType: MessageType.MeetingCompleted,
      payload: {
        meetingId: config.id,
        consensus: result.consensus,
        rounds: result.rounds,
        cost: actualCost,
      },
    });

    return result;
  }

  private async runParallelAdvisors(topic: string, advisorIds: string[]): Promise<AdvisorResult[]> {
    if (!this.gateway) return [];

    const results: AdvisorResult[] = [];
    for (const id of advisorIds) {
      try {
        const response = await this.gateway.generateText({
          model: 'claude-haiku-4-5',
          messages: [{
            role: 'user',
            content: `You are advisor "${id}". Analyze this topic and give your perspective in 2-3 sentences:\n\n"${topic}"`,
          }],
          maxTokens: 300,
          temperature: 0.7,
        });
        results.push({ advisorId: id, perspective: response.content });
      } catch (error) {
        results.push({ advisorId: id, perspective: `[Error: ${(error as Error).message}]` });
      }
    }
    return results;
  }

  estimateCost(advisorCount: number, rounds: number): number {
    const avgTokensPerCall = 500;
    const costPer1kTokens = 0.003;
    return advisorCount * rounds * avgTokensPerCall / 1000 * costPer1kTokens;
  }
}
