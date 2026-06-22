export const runnerHooks = {
  onToolExecutionStart: async ({ toolCall }: { toolCall: { toolName: string } }) => {},
  onStepEnd: async ({
    stepNumber,
    usage,
    toolCalls,
    finishReason,
  }: {
    stepNumber: number;
    usage?: { totalTokens?: number };
    toolCalls?: Array<{ toolName: string }>;
    finishReason?: string;
  }) => {},
  onEnd: async ({
    steps,
    usage,
  }: {
    steps: Array<unknown>;
    usage?: { totalTokens?: number; inputTokens?: number; outputTokens?: number };
  }) => {},
};
