import type { LLMGateway } from '@cabinet/gateway';
import type { AdvisorReasoning } from './parallel-reasoning.js';

export interface CrossValidation {
  /** Points of agreement across advisors. */
  agreements: string[];
  /** Genuine disagreements — where advisors took opposing positions. */
  disagreements: string[];
  /** Potential logical contradictions or factual inconsistencies. */
  contradictions: string[];
  /** Gaps — important angles that no advisor addressed. */
  gaps: string[];
  /** Overall coherence score 0–1. */
  coherenceScore: number;
}

/**
 * Cross-validates advisor outputs against each other.
 * Detects agreements, disagreements, contradictions, and blind spots.
 */
export class CrossValidator {
  constructor(private readonly gateway: LLMGateway) {}

  async validate(topic: string, reasonings: AdvisorReasoning[]): Promise<CrossValidation> {
    if (reasonings.length < 2) {
      return {
        agreements: [],
        disagreements: [],
        contradictions: [],
        gaps: [],
        coherenceScore: 1.0,
      };
    }

    const perspectives = reasonings
      .map((r) => `[${r.advisor.name} (${r.advisor.role})]: ${r.content}`)
      .join('\n\n');

    const prompt = [
      `Cross-validate these advisor perspectives on "${topic}".`,
      '',
      'Advisor perspectives:',
      perspectives,
      '',
      'Analyze and respond with ONLY a JSON object:',
      '{',
      '  "agreements": ["point where all/most advisors agree"],',
      '  "disagreements": ["point where advisors took different positions"],',
      '  "contradictions": ["logical contradiction or factual inconsistency between advisors"],',
      '  "gaps": ["important angle or consideration that no advisor addressed"],',
      '  "coherenceScore": 0.0 to 1.0',
      '}',
      '',
      'A score of 1.0 means all advisors are consistent and complementary.',
      'A score below 0.5 means there are serious contradictions.',
    ].join('\n');

    try {
      const response = await this.gateway.generateText({
        model: 'claude-haiku-4-5',
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 500,
        temperature: 0.1,
      });

      return this.parseValidation(response.content);
    } catch {
      return {
        agreements: [],
        disagreements: [],
        contradictions: [],
        gaps: [],
        coherenceScore: 0.5,
      };
    }
  }

  private parseValidation(json: string): CrossValidation {
    try {
      const match = json.match(/\{[\s\S]*\}/);
      if (!match) return this.emptyResult();
      const parsed = JSON.parse(match[0]);
      return {
        agreements: parsed.agreements ?? [],
        disagreements: parsed.disagreements ?? [],
        contradictions: parsed.contradictions ?? [],
        gaps: parsed.gaps ?? [],
        coherenceScore:
          typeof parsed.coherenceScore === 'number'
            ? Math.max(0, Math.min(1, parsed.coherenceScore))
            : 0.7,
      };
    } catch {
      return this.emptyResult();
    }
  }

  private emptyResult(): CrossValidation {
    return { agreements: [], disagreements: [], contradictions: [], gaps: [], coherenceScore: 1.0 };
  }
}
