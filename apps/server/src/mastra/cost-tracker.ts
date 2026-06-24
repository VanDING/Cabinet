import { getServerContext } from '../context.js';

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'claude-sonnet-4': { input: 3, output: 15 },
  'deepseek-chat': { input: 0.27, output: 1.1 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
  'qwen-plus': { input: 0.8, output: 2 },
  'moonshot-v1-32k': { input: 1, output: 2 },
  'glm-4-flash': { input: 0.1, output: 0.1 },
  baichuan4: { input: 1, output: 2 },
};

function estimateCostUSD(modelId: string, promptTokens: number, completionTokens: number): number {
  const key = Object.keys(MODEL_PRICING).find((k) => modelId.includes(k));
  const p = (key ? MODEL_PRICING[key] : undefined) ?? { input: 1, output: 5 };
  return (
    ((promptTokens ?? 0) / 1_000_000) * p.input + ((completionTokens ?? 0) / 1_000_000) * p.output
  );
}

export function createCostTracker() {
  return {
    onStepFinish(step: {
      usage?: { inputTokens?: number; outputTokens?: number };
      modelId?: string;
    }) {
      const usage = step.usage;
      if (!usage) return;
      const costUsd = estimateCostUSD(
        step.modelId ?? 'unknown',
        usage.inputTokens ?? 0,
        usage.outputTokens ?? 0,
      );
      try {
        const ctx = getServerContext();
        ctx.costHistoryRepo.insert(
          step.modelId ?? 'unknown',
          usage.inputTokens ?? 0,
          usage.outputTokens ?? 0,
          costUsd,
        );
      } catch {
        /* best-effort cost tracking */
      }
    },
  };
}
