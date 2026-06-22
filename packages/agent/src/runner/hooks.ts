export const runnerHooks = {
  onStepFinish: async (event: any) => {
    const usage = event?.usage;
    if (usage?.totalTokens) {
      // track token usage
    }
  },
  onFinish: async (event: any) => {
    const usage = event?.usage;
  },
};
