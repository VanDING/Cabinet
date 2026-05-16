import type { EventBus } from '@cabinet/events';
import { MessageType } from '@cabinet/types';
import type { LLMGateway } from '@cabinet/gateway';
import { DebateProtocol, type DebateConfig, type DebateResult } from './debate-protocol.js';
import { ParallelReasoning, type Advisor, type AdvisorReasoning } from './parallel-reasoning.js';
import { CrossValidator } from './cross-validator.js';
import { estimateMeetingCost } from './cost-estimator.js';

export interface MeetingConfig {
  id: string;
  topic: string;
  advisors: Advisor[];
  debate?: DebateConfig;
}

export interface MeetingResult {
  meetingId: string;
  consensus: string;
  minorityReport?: string;
  advisorResults: AdvisorReasoning[];
  rounds: number;
  costEstimate: number;
  crossValidation?: {
    agreements: string[];
    disagreements: string[];
    contradictions: string[];
    gaps: string[];
    coherenceScore: number;
  };
}

export class MeetingService {
  constructor(
    private readonly eventBus: EventBus,
    private readonly gateway?: LLMGateway,
  ) {}

  /** Get a pre-meeting cost estimate without running anything. */
  estimateCost(advisorCount: number, rounds: number = 1, model: string = 'claude-haiku-4-5') {
    return estimateMeetingCost(advisorCount, rounds, model);
  }

  async startMeeting(config: MeetingConfig): Promise<MeetingResult> {
    const advisorCount = config.advisors.length;

    // Publish meeting started event
    await this.eventBus.publish({
      messageId: `meeting_start_${config.id}`,
      correlationId: config.id,
      causationId: null,
      timestamp: new Date(),
      messageType: MessageType.MeetingStarted,
      payload: { meetingId: config.id, topic: config.topic, advisorCount },
    });

    let result: MeetingResult;

    if (this.gateway) {
      try {
        const debateProtocol = new DebateProtocol(this.gateway, config.debate);
        const debateResult = await debateProtocol.debate(
          config.topic,
          config.advisors,
          config.debate,
        );
        result = this.toMeetingResult(config.id, config.topic, debateResult);
      } catch (e) {
        // Fall back to simulated meeting on LLM failure
        result = {
          ...this.simulatedMeeting(config),
          consensus: `Meeting failed: ${(e as Error).message}. Falling back to simulated analysis.`,
        };
      }
    } else {
      // Simulated mode (no LLM)
      result = this.simulatedMeeting(config);
    }

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
        cost: result.costEstimate,
      },
    });

    return result;
  }

  /** Simple single-round meeting (for backward compatibility and quick consultations). */
  async quickMeeting(
    topic: string,
    advisors: Advisor[],
  ): Promise<MeetingResult> {
    if (!this.gateway) {
      return this.simulatedMeeting({
        id: `quick_${Date.now()}`,
        topic,
        advisors,
      });
    }

    const reasoning = new ParallelReasoning(this.gateway);
    const reasonings = await reasoning.reason(advisors, topic);

    // Quick chair synthesis
    const perspectives = reasonings
      .map(r => `[${r.advisor.name}]: ${r.content}`)
      .join('\n');

    let synthesis = '';
    if (this.gateway) {
      const chairResponse = await this.gateway.generateText({
        model: 'claude-haiku-4-5',
        messages: [{
          role: 'user',
          content: `Synthesize these perspectives on "${topic}" in 2-3 sentences:\n${perspectives}`,
        }],
        maxTokens: 300,
      });
      synthesis = chairResponse.content;
    }

    return {
      meetingId: `quick_${Date.now()}`,
      consensus: synthesis,
      advisorResults: reasonings,
      rounds: 1,
      costEstimate: advisors.length * 500 / 1000 * 0.003,
    };
  }

  private toMeetingResult(
    meetingId: string,
    topic: string,
    debate: DebateResult,
  ): MeetingResult {
    const lastValidation = debate.finalValidation;
    return {
      meetingId,
      consensus: debate.finalSynthesis,
      minorityReport: lastValidation?.disagreements.length
        ? `Disagreements: ${lastValidation.disagreements.join('; ')}`
        : undefined,
      advisorResults: debate.rounds.flatMap(r => r.reasonings),
      rounds: debate.rounds.length,
      costEstimate: debate.totalEstimatedCost,
      crossValidation: lastValidation ? {
        agreements: lastValidation.agreements,
        disagreements: lastValidation.disagreements,
        contradictions: lastValidation.contradictions,
        gaps: lastValidation.gaps,
        coherenceScore: lastValidation.coherenceScore,
      } : undefined,
    };
  }

  private simulatedMeeting(config: MeetingConfig): MeetingResult {
    const results = config.advisors.map(a => ({
      advisor: a,
      content: `Perspective from ${a.name} on: ${config.topic}`,
    }));

    const est = estimateMeetingCost(config.advisors.length, 1);

    return {
      meetingId: config.id,
      consensus: `Simulated consensus on "${config.topic}" from ${config.advisors.length} advisors.`,
      advisorResults: results,
      rounds: 1,
      costEstimate: est.estimatedCostUsd,
    };
  }
}
