import type { LLMGateway } from '@cabinet/gateway';

/**
 * An advisor participating in a meeting.
 */
export interface Advisor {
  id: string;
  name: string;
  role: string;
  /** Model to use for this advisor. */
  model: string;
  /** Perspective instruction — what angle this advisor analyzes from. */
  perspective: string;
}

export interface AdvisorReasoning {
  advisor: Advisor;
  content: string;
  tokensUsed?: { prompt: number; completion: number };
}

/**
 * Runs multiple advisors in parallel on the same topic.
 * Each advisor gets an independent LLM call with their own perspective.
 */
export class ParallelReasoning {
  constructor(private readonly gateway: LLMGateway) {}

  /**
   * Run a single round of parallel reasoning.
   * @param advisors The advisors to consult.
   * @param topic The topic/question to analyze.
   * @param context Optional context from previous rounds (for debate).
   */
  async reason(
    advisors: Advisor[],
    topic: string,
    context?: string,
  ): Promise<AdvisorReasoning[]> {
    const results = await Promise.allSettled(
      advisors.map(async advisor => {
        let prompt = `You are the ${advisor.name} (${advisor.role}).\n`;
        prompt += `${advisor.perspective}\n\n`;
        prompt += `Topic: "${topic}"\n\n`;

        if (context) {
          prompt += `Previous round context:\n${context}\n\n`;
          prompt += `Consider the points above and provide your analysis.`;
        } else {
          prompt += `Provide your analysis in 2-3 sentences with concrete points.`;
        }

        const response = await this.gateway.generateText({
          model: advisor.model,
          messages: [{ role: 'user', content: prompt }],
          maxTokens: 250,
        });

        return {
          advisor,
          content: response.content,
          tokensUsed: response.usage ? {
            prompt: response.usage.promptTokens,
            completion: response.usage.completionTokens,
          } : undefined,
        };
      }),
    );

    const reasonings: AdvisorReasoning[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') {
        reasonings.push(r.value);
      } else {
        reasonings.push({
          advisor: { id: 'error', name: 'Error', role: 'Error', model: 'none', perspective: '' },
          content: 'Failed to generate perspective.',
        });
      }
    }

    return reasonings;
  }
}
