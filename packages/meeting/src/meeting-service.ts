import type { EventBus } from '@cabinet/events';
import { MessageType } from '@cabinet/types';
import { MAX_DEBATE_ROUNDS, MAX_MEETING_ADVISORS } from '@cabinet/types';

export interface MeetingConfig {
  id: string;
  topic: string;
  advisorIds: string[];
  maxRounds?: number;
}

export interface MeetingResult {
  meetingId: string;
  consensus: string;
  minorityReport?: string;
  rounds: number;
}

export class MeetingService {
  constructor(private readonly eventBus: EventBus) {}

  async startMeeting(config: MeetingConfig): Promise<MeetingResult> {
    const maxRounds = config.maxRounds ?? MAX_DEBATE_ROUNDS;
    const advisorCount = Math.min(config.advisorIds.length, MAX_MEETING_ADVISORS);

    // Publish meeting started event
    await this.eventBus.publish({
      messageId: `meeting_start_${config.id}`,
      correlationId: config.id,
      causationId: null,
      timestamp: new Date(),
      messageType: MessageType.MeetingStarted,
      payload: { meetingId: config.id, topic: config.topic, advisorCount },
    });

    // Simulate consensus (in production, this would use parallel LLM reasoning)
    const result: MeetingResult = {
      meetingId: config.id,
      consensus: `Consensus on: ${config.topic} (from ${advisorCount} advisors, ${maxRounds} rounds)`,
      rounds: 1,
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
      },
    });

    return result;
  }

  estimateCost(advisorCount: number, rounds: number): number {
    const avgTokensPerRound = 2000;
    const costPer1kTokens = 0.003; // approx $3/M tokens
    return advisorCount * rounds * avgTokensPerRound / 1000 * costPer1kTokens;
  }
}
