import type { LLMGateway } from '@cabinet/gateway';

export class Evaluator {
  constructor(private readonly gateway: LLMGateway) {}

  async evaluate(output: string): Promise<{ quality: number; feedback: string }> {
    try {
      const response = await this.gateway.generateText({
        model: 'claude-haiku-4-5',
        messages: [{
          role: 'user',
          content: `Rate this output quality (0-10) and give brief feedback:\n\n${output}`,
        }],
      });
      const qualityMatch = response.content.match(/(\d+)/);
      return {
        quality: qualityMatch?.[1] ? parseInt(qualityMatch[1]) / 10 : 0.5,
        feedback: response.content.slice(0, 200),
      };
    } catch {
      return { quality: 0.5, feedback: 'Evaluation unavailable' };
    }
  }
}
