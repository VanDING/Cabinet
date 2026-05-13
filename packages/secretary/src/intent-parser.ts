import type { LLMGateway } from '@cabinet/gateway';

export type ParsedIntent =
  | { kind: 'decision_request'; topic: string; context: string; suggestedDimensions: string[] }
  | { kind: 'meeting_request'; topic: string; requiredPerspectives: string[] }
  | { kind: 'status_query'; target: 'project' | 'decision' | 'workflow'; filters: Record<string, string> }
  | { kind: 'knowledge_query'; question: string; scope: 'short_term' | 'long_term' | 'both' }
  | { kind: 'unknown'; raw: string };

export class IntentParser {
  constructor(private readonly gateway?: LLMGateway) {}

  parse(message: string): ParsedIntent {
    const lower = message.toLowerCase();

    // Check knowledge queries first — question words take priority over content words
    if (lower.includes('什么') || lower.includes('如何') || lower.includes('怎么') || lower.includes('为什么')) {
      return {
        kind: 'knowledge_query',
        question: message,
        scope: 'both',
      };
    }

    if (lower.includes('分析') || lower.includes('是否') || lower.includes('该不该') || lower.includes('决策')) {
      return {
        kind: 'decision_request',
        topic: message.slice(0, 100),
        context: message,
        suggestedDimensions: ['成本', '风险', '时间', '收益'],
      };
    }

    if (lower.includes('组织') || lower.includes('讨论') || lower.includes('会议') || lower.includes('顾问')) {
      return {
        kind: 'meeting_request',
        topic: message,
        requiredPerspectives: ['general'],
      };
    }

    if (lower.includes('状态') || lower.includes('进度') || lower.includes('查询')) {
      return {
        kind: 'status_query',
        target: 'project',
        filters: { query: message },
      };
    }

    return { kind: 'unknown', raw: message };
  }

  async parseWithLLM(message: string): Promise<ParsedIntent> {
    if (!this.gateway) return this.parse(message);

    try {
      const prompt = `Classify this user message into one of these intents:

- decision_request: user wants to analyze/decide something (e.g. "should we enter X market?")
- meeting_request: user wants to organize advisors to discuss something
- status_query: user asks about project/decision/workflow status
- knowledge_query: user asks a general question

Respond with ONLY a JSON object:
{
  "kind": "one of the above",
  "topic": "brief topic",
  "context": "full context",
  "suggestedDimensions": ["dim1", "dim2"],
  "requiredPerspectives": ["finance", "legal"],
  "target": "project|decision|workflow",
  "question": "the question"
}

Message: "${message}"`;

      const response = await this.gateway.generateText({
        model: 'claude-haiku-4-5',
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 300,
        temperature: 0.1,
      });

      return this.parseJSONIntent(response.content);
    } catch {
      // Fallback to keyword parsing on LLM failure
      return this.parse(message);
    }
  }

  private parseJSONIntent(json: string): ParsedIntent {
    try {
      const match = json.match(/\{[\s\S]*\}/);
      if (!match) return { kind: 'unknown', raw: json };
      const parsed = JSON.parse(match[0]);
      return {
        kind: parsed.kind ?? 'unknown',
        topic: parsed.topic ?? '',
        context: parsed.context ?? '',
        suggestedDimensions: parsed.suggestedDimensions ?? [],
        requiredPerspectives: parsed.requiredPerspectives ?? [],
        target: parsed.target,
        question: parsed.question,
        filters: parsed.filters ?? {},
        raw: json,
      } as ParsedIntent;
    } catch {
      return { kind: 'unknown', raw: json };
    }
  }
}
