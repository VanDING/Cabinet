import { createAnswerRelevancyScorer } from '@mastra/evals/scorers/prebuilt';
import { createFaithfulnessScorer } from '@mastra/evals/scorers/prebuilt';
import { createToxicityScorer } from '@mastra/evals/scorers/prebuilt';
import { createToolCallAccuracyScorerLLM } from '@mastra/evals/scorers/prebuilt';
import { createHallucinationScorer } from '@mastra/evals/scorers/prebuilt';
import { createBiasScorer } from '@mastra/evals/scorers/prebuilt';
import { createPromptAlignmentScorerLLM } from '@mastra/evals/scorers/prebuilt';

const evalModel = { provider: 'deepseek', model: 'deepseek/deepseek-chat' };

type Scorer = {
  score: (input: {
    input: string;
    output: string;
    expectedOutput?: string;
    context?: string[];
  }) => Promise<number | { score: number; reason?: string }>;
};

function makeScorer(fn: (...args: any[]) => any): Scorer | null {
  try {
    const scorer = fn({ model: evalModel as any });
    return { score: scorer.score.bind(scorer) };
  } catch {
    return null;
  }
}

export const scorers: Record<string, Scorer | null> = {
  answerRelevancy: makeScorer(createAnswerRelevancyScorer),
  faithfulness: makeScorer(createFaithfulnessScorer),
  toxicity: makeScorer(createToxicityScorer),
  toolCallAccuracy: makeScorer(createToolCallAccuracyScorerLLM),
  hallucination: makeScorer(createHallucinationScorer),
  bias: makeScorer(createBiasScorer),
  promptAlignment: makeScorer(createPromptAlignmentScorerLLM),
};

export const scorerNames = Object.keys(scorers).filter((k) => scorers[k] !== null);
