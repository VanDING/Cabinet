import type { ToolDefinition } from '../tool-executor.js';

export interface EvaluationResult {
  overallScore: number;
  dimensions: Record<string, { score: number; feedback: string }>;
  feedback: string;
  evaluatorModel: string;
}

export interface EvaluationToolDeps {
  evaluateOutput: (
    content: string,
    sourceType: string,
    sourceId?: string,
  ) => Promise<EvaluationResult>;
}

export function createEvaluationTools(deps: EvaluationToolDeps): ToolDefinition[] {
  return [
    {
      name: 'evaluate',
      timeoutMs: 60000,
      parameters: { type: 'object', properties: {} },
      execute: async (args: Record<string, unknown>) => {
        const content = args.content as string;
        const sourceType = (args.sourceType as string) ?? 'agent_output';
        const sourceId = args.sourceId as string | undefined;

        if (!content) return { error: 'content is required' };
        if (content.length < 20) return { error: 'Content too short for meaningful evaluation' };

        try {
          const result = await deps.evaluateOutput(content, sourceType, sourceId);
          const dimSummary: Record<string, { score: number; feedback: string }> = {};
          for (const [k, v] of Object.entries(result.dimensions)) {
            dimSummary[k] = { score: v.score, feedback: v.feedback };
          }
          return {
            overallScore: result.overallScore,
            dimensions: dimSummary,
            feedback: result.feedback,
            evaluatorModel: result.evaluatorModel,
          };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
  ];
}
