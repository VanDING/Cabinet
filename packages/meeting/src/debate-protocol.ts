import type { LLMGateway } from '@cabinet/gateway';
import { ParallelReasoning, type Advisor, type AdvisorReasoning } from './parallel-reasoning.js';
import { CrossValidator, type CrossValidation } from './cross-validator.js';

export interface DebateRound {
  round: number;
  reasonings: AdvisorReasoning[];
  validation: CrossValidation | null;
}

export interface DebateResult {
  meetingId: string;
  topic: string;
  rounds: DebateRound[];
  finalSynthesis: string;
  /** The cross-validation from the final round. */
  finalValidation: CrossValidation | null;
  /** Total cost estimate. */
  totalEstimatedCost: number;
  /** Incurred LLM call count. */
  totalLlmCalls: number;
}

export interface DebateConfig {
  /** Max number of debate rounds. Default 2. */
  maxRounds?: number;
  /** Whether to cross-validate after each round. Default true. */
  crossValidate?: boolean;
  /** Whether to show advisors previous round results. Default true. */
  shareContext?: boolean;
}

/**
 * Multi-round debate protocol.
 *
 * Flow:
 *   Round 1: All advisors give independent perspectives
 *   Round 2+: Advisors see previous round context and respond
 *   Final:    Chair synthesizes with full debate record
 *
 * Each round can optionally include cross-validation to detect contradictions.
 */
export class DebateProtocol {
  private readonly parallelReasoning: ParallelReasoning;
  private readonly crossValidator: CrossValidator | null;

  constructor(
    private readonly gateway: LLMGateway,
    config?: DebateConfig,
  ) {
    this.parallelReasoning = new ParallelReasoning(gateway);
    this.crossValidator = config?.crossValidate !== false ? new CrossValidator(gateway) : null;
  }

  /**
   * Run a full multi-round debate.
   */
  async debate(topic: string, advisors: Advisor[], config?: DebateConfig): Promise<DebateResult> {
    const maxRounds = config?.maxRounds ?? 2;
    const shareContext = config?.shareContext ?? true;
    const rounds: DebateRound[] = [];
    let totalLlmCalls = 0;

    // Round 1: Independent perspectives
    const round1 = await this.parallelReasoning.reason(advisors, topic);
    totalLlmCalls += advisors.length;

    let round1Validation: CrossValidation | null = null;
    if (this.crossValidator) {
      round1Validation = await this.crossValidator.validate(topic, round1);
      totalLlmCalls++;
    }

    rounds.push({ round: 1, reasonings: round1, validation: round1Validation });

    // Subsequent rounds: context-aware debate
    let prevContext = this.buildRoundSummary(round1);

    for (let roundNum = 2; roundNum <= maxRounds; roundNum++) {
      // Only continue if there are meaningful disagreements to resolve
      const lastValidation = rounds[rounds.length - 1]?.validation;
      if (lastValidation && lastValidation.coherenceScore > 0.8) {
        break; // High coherence — no need for more rounds
      }

      const context = shareContext ? prevContext : undefined;
      const roundReasonings = await this.parallelReasoning.reason(advisors, topic, context);
      totalLlmCalls += advisors.length;

      let roundValidation: CrossValidation | null = null;
      if (this.crossValidator) {
        roundValidation = await this.crossValidator.validate(topic, roundReasonings);
        totalLlmCalls++;
      }

      rounds.push({ round: roundNum, reasonings: roundReasonings, validation: roundValidation });
      prevContext = this.buildRoundSummary(roundReasonings);
    }

    // Final synthesis
    const fullTranscript = rounds
      .flatMap((r) => r.reasonings)
      .map((r) => `[${r.advisor.name}]: ${r.content}`)
      .join('\n');

    const synthesisPrompt = [
      `You are the Chair. Synthesize the full debate on "${topic}".`,
      '',
      'Full debate transcript:',
      fullTranscript,
      '',
      'Provide:',
      '1. Consensus: what do the advisors agree on?',
      '2. Key disagreements: where and why do they differ?',
      '3. Risks identified',
      '4. Recommended next step with reasoning',
      '',
      'Be balanced. Do not just pick the majority view — give weight to well-reasoned minority positions.',
    ].join('\n');

    const chairResponse = await this.gateway.generateText({
      model: 'claude-haiku-4-5',
      messages: [{ role: 'user', content: synthesisPrompt }],
      maxTokens: 500,
    });
    totalLlmCalls++;

    const totalTokens = rounds.reduce((sum, r) => {
      return (
        sum +
        r.reasonings.reduce(
          (s, a) => s + (a.tokensUsed?.prompt ?? 0) + (a.tokensUsed?.completion ?? 0),
          0,
        )
      );
    }, 0);
    const estimatedCost = (totalTokens / 1_000_000) * 1.0;

    return {
      meetingId: `debate_${Date.now()}`,
      topic,
      rounds,
      finalSynthesis: chairResponse.content,
      finalValidation: rounds[rounds.length - 1]?.validation ?? null,
      totalEstimatedCost: Math.round(estimatedCost * 100) / 100,
      totalLlmCalls,
    };
  }

  private buildRoundSummary(reasonings: AdvisorReasoning[]): string {
    return reasonings.map((r) => `[${r.advisor.name}] ${r.content}`).join('\n');
  }
}
