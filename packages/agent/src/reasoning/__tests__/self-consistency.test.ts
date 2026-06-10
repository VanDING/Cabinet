import { describe, it, expect, vi } from 'vitest';
import { SelfConsistencyEngine } from '../self-consistency.js';
import type { LLMGateway } from '@cabinet/gateway';

function makeGateway(responses: string[]): LLMGateway {
  let i = 0;
  return {
    generateText: vi.fn().mockImplementation(() => {
      const content = responses[i++] ?? 'default';
      return Promise.resolve({
        content,
        usage: { promptTokens: 10, completionTokens: 10, cachedPromptTokens: 0 },
        model: 'test',
      });
    }),
    streamText: vi.fn(),
    listModels: vi.fn().mockResolvedValue([]),
    generateEmbeddings: vi
      .fn()
      .mockResolvedValue({ embeddings: [], model: 'test', usage: { tokens: 0 } }),
  } as any;
}

describe('SelfConsistencyEngine', () => {
  it('returns the most common answer', async () => {
    const engine = new SelfConsistencyEngine(
      { enabled: true, samples: 3, triggerTasks: ['code'] },
      makeGateway(['answer A', 'answer A', 'answer B']),
    );

    const result = await engine.run([{ role: 'user', content: 'test' }], 'system');
    expect(result.content).toBe('answer A');
    expect(result.confidence).toBeCloseTo(2 / 3);
  });

  it('respects triggerTasks', () => {
    const engine = new SelfConsistencyEngine(
      { enabled: true, samples: 3, triggerTasks: ['code'] },
      makeGateway([]),
    );
    expect(engine.shouldTrigger('code')).toBe(true);
    expect(engine.shouldTrigger('chat')).toBe(false);
  });

  it('does not trigger when disabled', () => {
    const engine = new SelfConsistencyEngine(
      { enabled: false, samples: 3, triggerTasks: [] },
      makeGateway([]),
    );
    expect(engine.shouldTrigger('code')).toBe(false);
  });

  it('handles all failed samples', async () => {
    const engine = new SelfConsistencyEngine({ enabled: true, samples: 2, triggerTasks: [] }, {
      generateText: vi.fn().mockRejectedValue(new Error('fail')),
      streamText: vi.fn(),
      listModels: vi.fn(),
      generateEmbeddings: vi.fn(),
    } as any);
    await expect(engine.run([{ role: 'user', content: 'test' }])).rejects.toThrow(
      'All self-consistency samples failed',
    );
  });
});
