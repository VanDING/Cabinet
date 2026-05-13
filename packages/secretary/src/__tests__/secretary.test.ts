import { describe, it, expect, beforeEach } from 'vitest';
import { IntentParser } from '../intent-parser.js';
import { SessionManager } from '../session-manager.js';
import { GreetingService } from '../greeting.js';

describe('IntentParser', () => {
  let parser: IntentParser;
  beforeEach(() => { parser = new IntentParser(); });

  it('detects decision requests', () => {
    const result = parser.parse('帮我分析是否该进入母婴市场');
    expect(result.kind).toBe('decision_request');
  });

  it('detects meeting requests', () => {
    const result = parser.parse('帮我组织财务和市场顾问讨论预算');
    expect(result.kind).toBe('meeting_request');
  });

  it('detects knowledge queries', () => {
    const result = parser.parse('什么是SWOT分析？');
    expect(result.kind).toBe('knowledge_query');
  });

  it('returns unknown for unclear input', () => {
    const result = parser.parse('...');
    expect(result.kind).toBe('unknown');
  });

  describe('LLM-powered parsing', () => {
    const mockGateway = {
      async generateText() {
        return {
          content: JSON.stringify({
            kind: 'decision_request',
            topic: '进入母婴市场',
            context: '帮我分析是否该进入母婴市场',
            suggestedDimensions: ['成本', '风险', '时间', '收益'],
          }),
          usage: { promptTokens: 50, completionTokens: 30 },
          model: 'claude-haiku-4-5',
        };
      },
      async *streamText() { yield { type: 'done' as const }; },
      async listModels() { return []; },
      async generateEmbeddings() { return { embeddings: [], model: '', usage: { tokens: 0 } }; },
    };

    it('uses LLM gateway when provided', async () => {
      const llmParser = new IntentParser(mockGateway as any);
      const result = await llmParser.parseWithLLM('帮我分析是否该进入母婴市场');
      expect(result.kind).toBe('decision_request');
      expect((result as any).topic).toBe('进入母婴市场');
    });

    it('falls back to keyword parser without gateway', async () => {
      const keywordParser = new IntentParser();
      const result = await keywordParser.parseWithLLM('帮我分析是否该进入母婴市场');
      expect(result.kind).toBe('decision_request');
    });

    it('falls back to keyword parser on LLM error', async () => {
      const failingGateway = {
        ...mockGateway,
        async generateText() { throw new Error('API error'); },
      };
      const llmParser = new IntentParser(failingGateway as any);
      const result = await llmParser.parseWithLLM('帮我分析是否该进入母婴市场');
      expect(result.kind).toBe('decision_request');
    });

    it('returns unknown for unparseable LLM output', async () => {
      const badGateway = {
        ...mockGateway,
        async generateText() {
          return {
            content: 'not json at all',
            usage: { promptTokens: 10, completionTokens: 5 },
            model: 'test',
          };
        },
      };
      const llmParser = new IntentParser(badGateway as any);
      const result = await llmParser.parseWithLLM('blah blah');
      expect(result.kind).toBe('unknown');
    });
  });
});

describe('SessionManager', () => {
  it('manages session lifecycle', () => {
    const sm = new SessionManager();
    sm.create('s1', 'Test');
    sm.addMessage('s1', 'user', 'Hello');
    sm.addMessage('s1', 'assistant', 'Hi!');
    const session = sm.get('s1');
    expect(session!.messages).toHaveLength(2);
  });
});

describe('GreetingService', () => {
  it('generates greeting with stats', () => {
    const svc = new GreetingService();
    const greeting = svc.generateGreeting('Captain', 3, 1.50);
    expect(greeting).toContain('Captain');
    expect(greeting).toContain('3 pending');
    expect(greeting).toContain('$1.50');
  });
});
