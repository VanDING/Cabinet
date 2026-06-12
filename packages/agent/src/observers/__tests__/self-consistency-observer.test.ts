import { describe, it, expect, vi } from 'vitest';
import { SelfConsistencyObserver } from '../self-consistency.js';
import type { LLMGateway } from '@cabinet/gateway';

function makeGateway(responses: string[]): LLMGateway {
  let i = 0;
  return {
    generateText: vi.fn().mockImplementation(async () => {
      const content = responses[i++] ?? 'default';
      return { content, model: 'test', usage: { promptTokens: 1, completionTokens: 1 } };
    }),
  } as unknown as LLMGateway;
}

describe('SelfConsistencyObserver', () => {
  it('exposes a working self-consistency engine', async () => {
    const observer = new SelfConsistencyObserver(
      { enabled: true, samples: 3, triggerTasks: ['code'] },
      makeGateway(['A', 'A', 'B']),
    );
    const engine = observer.getEngine();
    expect(engine.shouldTrigger('code')).toBe(true);
    expect(engine.shouldTrigger('chat')).toBe(false);

    const result = await engine.run([{ role: 'user', content: 'hi' }]);
    expect(result.content).toBe('A');
    expect(result.confidence).toBe(2 / 3);
  });

  it('is stateless across lifecycle hooks', async () => {
    const observer = new SelfConsistencyObserver(
      { enabled: true, samples: 1, triggerTasks: [] },
      makeGateway(['x']),
    );
    const ctx = {
      sessionId: 's1',
      messages: [],
      systemPrompt: '',
      stepCount: 0,
      finalContent: '',
    } as any;
    await observer.onStreamStart(ctx);
    await observer.onStepEnd(ctx);
    await observer.onStreamEnd(ctx);
    const result = await observer.getEngine().run([{ role: 'user', content: 'hi' }]);
    expect(result.content).toBe('x');
  });
});
