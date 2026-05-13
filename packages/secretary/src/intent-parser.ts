export type ParsedIntent =
  | { kind: 'decision_request'; topic: string; context: string; suggestedDimensions: string[] }
  | { kind: 'meeting_request'; topic: string; requiredPerspectives: string[] }
  | { kind: 'status_query'; target: 'project' | 'decision' | 'workflow'; filters: Record<string, string> }
  | { kind: 'knowledge_query'; question: string; scope: 'short_term' | 'long_term' | 'both' }
  | { kind: 'unknown'; raw: string };

export class IntentParser {
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
}
