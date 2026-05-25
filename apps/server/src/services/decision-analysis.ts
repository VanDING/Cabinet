import type { ServerContext } from '../context.js';
import type { Decision } from '@cabinet/types';

function buildDecisionAnalysisPrompt(decision: Decision): string {
  return [
    `Please analyze the following decision:`,
    `Title: ${decision.title}`,
    `Description: ${decision.description}`,
    `Options:`,
    ...(decision.options.map((o) => `- ${o.label}: ${o.impact}`)),
    ``,
    `Provide a structured analysis covering: risks, trade-offs, recommendation rationale, and next steps.`,
  ].join('\n');
}

export class DecisionAnalysisService {
  constructor(private readonly ctx: ServerContext) {}

  async analyze(decision: Decision, _callerSessionId?: string): Promise<string> {
    const prompt = buildDecisionAnalysisPrompt(decision);
    if (!this.ctx.gateway) throw new Error('No LLM gateway available');
    const result = await this.ctx.gateway.generateText({
      model: 'claude-sonnet-4-6',
      systemPrompt: 'You are the Decision Analyst. Provide structured, thorough analysis of decisions covering risks, trade-offs, rationale, and next steps.',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 4000,
      temperature: 0.3,
    });
    return result.content;
  }

  async ensureAnalysis(decisionId: string, callerSessionId?: string): Promise<void> {
    const decision = this.ctx.decisionRepo.get(decisionId);
    if (!decision) return;
    if (decision.analysis && decision.analysis.length > 100) return;
    try {
      const analysis = await this.analyze(decision, callerSessionId);
      this.ctx.decisionRepo.save({ ...decision, analysis });
    } catch {
      // Analysis failure is non-fatal
    }
  }
}
