import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContextBuilder } from '../context-builder.js';
import type { MemoryProvider } from '../context-builder.js';

class SpyMemoryProvider implements MemoryProvider {
  calls: { method: string; args: unknown[] }[] = [];

  async getShortTerm(_sessionId: string) {
    return [];
  }
  async getProjectContext(_projectId: string) {
    return 'Test project';
  }
  async getEntityPreferences(_captainId: string) {
    return {};
  }
  async searchLongTerm(query: string, projectId: string) {
    this.calls.push({ method: 'searchLongTerm', args: [query, projectId] });
    return [`Result for ${query}`];
  }
}

describe('ContextBuilder RAG cache', () => {
  let memory: SpyMemoryProvider;
  let builder: ContextBuilder;

  beforeEach(() => {
    memory = new SpyMemoryProvider();
    builder = new ContextBuilder(memory);
  });

  it('calls searchLongTerm on first build with taskDescription', async () => {
    const result = await builder.build({
      sessionId: 's1',
      projectId: 'p1',
      captainId: 'c1',
      taskDescription: 'write tests',
    });
    expect(memory.calls).toHaveLength(1);
    expect(result.systemPrompt).toContain('Result for write tests');
  });

  it('reuses cached RAG result within 60s for identical query', async () => {
    await builder.build({ sessionId: 's1', projectId: 'p1', captainId: 'c1', taskDescription: 'write tests' });
    await builder.build({ sessionId: 's2', projectId: 'p1', captainId: 'c1', taskDescription: 'write tests' });
    expect(memory.calls).toHaveLength(1);
  });

  it('refreshes cache after TTL expires', async () => {
    vi.useFakeTimers();
    await builder.build({ sessionId: 's1', projectId: 'p1', captainId: 'c1', taskDescription: 'write tests' });
    vi.advanceTimersByTime(61_000);
    await builder.build({ sessionId: 's1', projectId: 'p1', captainId: 'c1', taskDescription: 'write tests' });
    expect(memory.calls).toHaveLength(2);
    vi.useRealTimers();
  });

  it('does not cache when taskDescription is absent', async () => {
    await builder.build({ sessionId: 's1', projectId: 'p1', captainId: 'c1' });
    expect(memory.calls).toHaveLength(0);
  });
});
