/**
 * Pre-meeting cost estimation.
 * Gives the Captain a cost estimate before committing to a meeting.
 */
export interface CostEstimate {
  advisorCount: number;
  rounds: number;
  estimatedTokens: {
    perAdvisor: number;
    perChair: number;
    total: number;
  };
  estimatedCostUsd: number;
  /** Whether the cost exceeds the confirmation threshold ($0.50). */
  requiresConfirmation: boolean;
}

const COST_PER_1K_TOKENS: Record<string, number> = {
  'claude-haiku-4-5': 0.001,   // $0.001/1K tokens
  'claude-sonnet-4-6': 0.003,  // $0.003/1K tokens
};

const DEFAULT_TOKEN_ESTIMATE = {
  advisorPrompt: 150,   // system prompt + topic per advisor
  advisorResponse: 200, // average response length
  chairPrompt: 600,     // includes all perspectives
  chairResponse: 300,   // synthesis output
};

/** Cost threshold above which Captain confirmation is recommended. */
const CONFIRMATION_THRESHOLD_USD = 0.50;

export function estimateMeetingCost(
  advisorCount: number,
  rounds: number = 1,
  model: string = 'claude-haiku-4-5',
): CostEstimate {
  const rate = COST_PER_1K_TOKENS[model] ?? 0.001;

  const perAdvisorPrompt = DEFAULT_TOKEN_ESTIMATE.advisorPrompt;
  const perAdvisorResponse = DEFAULT_TOKEN_ESTIMATE.advisorResponse;
  const perAdvisor = perAdvisorPrompt + perAdvisorResponse;

  // Each round: N advisors speak + 1 chair synthesizes
  const advisorTokens = advisorCount * rounds * perAdvisor;
  const chairTokens = rounds * (DEFAULT_TOKEN_ESTIMATE.chairPrompt + DEFAULT_TOKEN_ESTIMATE.chairResponse);
  const totalTokens = advisorTokens + chairTokens;

  const estimatedCostUsd = (totalTokens / 1000) * rate;

  return {
    advisorCount,
    rounds,
    estimatedTokens: {
      perAdvisor,
      perChair: DEFAULT_TOKEN_ESTIMATE.chairPrompt + DEFAULT_TOKEN_ESTIMATE.chairResponse,
      total: totalTokens,
    },
    estimatedCostUsd: Math.round(estimatedCostUsd * 10000) / 10000,
    requiresConfirmation: estimatedCostUsd > CONFIRMATION_THRESHOLD_USD,
  };
}
