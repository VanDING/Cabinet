import type { ServerContext } from '../../../context.js';
import { EvaluationResultRepository } from '@cabinet/storage';

export function buildEvalTools(ctx: ServerContext) {
  return {
    evaluateOutput: async (content: string, sourceType: string, sourceId?: string) => {
      if (!ctx.gateway) throw new Error('No LLM gateway available for evaluation');

      const evaluatorModel = 'claude-haiku-4-5';
      const prompt = [
        'Evaluate the following AI-generated output across 4 dimensions. Score each 1-10.',
        '',
        'Dimensions:',
        '1. accuracy — factual correctness and absence of errors',
        '2. completeness — covers all necessary aspects, nothing important missing',
        '3. actionability — provides concrete, usable next steps or recommendations',
        '4. clarity — well-structured, easy to understand, appropriate tone',
        '',
        'Output to evaluate:',
        content.slice(0, 4000),
        '',
        'Respond with ONLY a JSON object:',
        '{',
        '  "overallScore": <number 1-10>,',
        '  "dimensions": {',
        '    "accuracy": {"score": <1-10>, "feedback": "<1 sentence>"},',
        '    "completeness": {"score": <1-10>, "feedback": "<1 sentence>"},',
        '    "actionability": {"score": <1-10>, "feedback": "<1 sentence>"},',
        '    "clarity": {"score": <1-10>, "feedback": "<1 sentence>"}',
        '  },',
        '  "feedback": "<2-3 sentence overall assessment>"',
        '}',
      ].join('\n');

      try {
        const result = await ctx.gateway.generateText({
          model: evaluatorModel,
          systemPrompt: 'You are an expert quality evaluator. Be precise and constructive.',
          messages: [{ role: 'user', content: prompt }],
        });
        const parsed = JSON.parse(result.content);
        const overallScore = typeof parsed.overallScore === 'number' ? parsed.overallScore : 5;
        const dimensions = parsed.dimensions ?? {};

        // Persist evaluation result
        new EvaluationResultRepository(ctx.db).insert({
          project_id: 'default',
          session_id: null,
          source_type: sourceType,
          source_id: sourceId ?? null,
          overall_score: overallScore,
          dimensions: JSON.stringify(dimensions),
          feedback: parsed.feedback ?? '',
          evaluator_model: evaluatorModel,
        });

        return { overallScore, dimensions, feedback: parsed.feedback ?? '', evaluatorModel };
      } catch {
        return {
          overallScore: 5,
          dimensions: {},
          feedback: 'Evaluation failed — model output unparseable',
          evaluatorModel,
        };
      }
    },
  };
}
