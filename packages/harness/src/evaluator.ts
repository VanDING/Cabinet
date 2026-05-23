import type { LLMGateway } from '@cabinet/gateway';

export class Evaluator {
  constructor(private readonly gateway: LLMGateway) {}

  async evaluate(output: string): Promise<{ quality: number; feedback: string }> {
    try {
      const response = await this.gateway.generateText({
        model: 'claude-haiku-4-5',
        messages: [
          {
            role: 'user',
            content: `Rate this output quality on a 0-10 scale. Reply with ONLY "Score: X/10" followed by one line of feedback.\n\n${output}`,
          },
        ],
      });
      const scoreMatch = response.content.match(/Score:\s*(\d+)\s*\/\s*10/i);
      return {
        quality: scoreMatch?.[1] ? Math.min(1, Math.max(0, parseInt(scoreMatch[1]) / 10)) : 0.5,
        feedback: response.content.slice(0, 200),
      };
    } catch {
      return { quality: 0.5, feedback: 'Evaluation unavailable' };
    }
  }
}
