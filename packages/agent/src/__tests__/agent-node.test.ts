import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createAgentNodeFactory, type AgentNodeDeps } from '../agent-node.js';
import { ToolExecutor } from '../tool-executor.js';
import { SafetyChecker } from '../safety.js';
import { SECRETARY_ROLE, REVIEWER_ROLE } from '../agent-roles.js';
import type { MemoryProvider } from '../context-builder.js';
import type { LLMGateway, LLMResponse, LLMCallOptions, EmbeddingOptions, EmbeddingResult } from '@cabinet/gateway';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  return db;
}

class MockMemory implements MemoryProvider {
  async getShortTerm() { return []; }
  async getProjectContext() { return 'test'; }
  async getEntityPreferences() { return {}; }
  async searchLongTerm() { return []; }
}

interface TestState {
  topic: string;
  agentHandoffs: Record<string, unknown>;
  agentId: string;
}

describe('createAgentNodeFactory', () => {
  let deps: AgentNodeDeps;
  let toolExecutor: ToolExecutor;

  beforeEach(() => {
    const db = createDb();
    toolExecutor = new ToolExecutor();
    toolExecutor.register({
      name: 'echo',
      execute: async (args) => args.message ?? 'echo',
    });

    const mockGateway: LLMGateway = {
      async generateText(_opts: LLMCallOptions): Promise<LLMResponse> {
        return {
          content: '{"summary":"test result","confidence":0.8}',
          usage: { promptTokens: 10, completionTokens: 5 },
          model: 'test-model',
        };
      },
      async *streamText() { yield { type: 'done' }; },
      async listModels() { return ['test-model']; },
      async generateEmbeddings(_opts: EmbeddingOptions): Promise<EmbeddingResult> {
        return { embeddings: [], model: 'test', usage: { tokens: 0 } };
      },
    };

    deps = {
      gateway: mockGateway,
      toolExecutor,
      safetyChecker: new SafetyChecker(),
      db,
      memoryProvider: new MockMemory(),
    };
  });

  it('produces a function compatible with StateGraph.addNode', () => {
    const factory = createAgentNodeFactory<TestState>(deps);
    const nodeFn = factory({
      role: SECRETARY_ROLE,
      agentId: 'secretary',
      input: (s) => ({ message: s.topic }),
    });
    expect(typeof nodeFn).toBe('function');
  });

  it('runs an AgentLoop and writes handoff by default', async () => {
    const factory = createAgentNodeFactory<TestState>(deps);
    const nodeFn = factory({
      role: SECRETARY_ROLE,
      agentId: 'secretary',
      input: (s) => ({ message: s.topic }),
    });

    const state: TestState = { topic: 'test topic', agentHandoffs: {}, agentId: '' };
    const update = await nodeFn(state);

    expect(update.agentHandoffs).toBeDefined();
    const handoff = (update.agentHandoffs as Record<string, unknown>)['secretary'];
    expect(handoff).toBeDefined();
    expect((handoff as any).from).toBe('secretary');
    expect((handoff as any).confidence).toBe(0.8);
  });

  it('uses custom output when provided', async () => {
    const factory = createAgentNodeFactory<TestState>(deps);
    const nodeFn = factory({
      role: SECRETARY_ROLE,
      agentId: 'secretary',
      input: (s) => ({ message: s.topic }),
      output: (_s, r) => ({ agentId: r.content }),
    });

    const state: TestState = { topic: 'x', agentHandoffs: {}, agentId: '' };
    const update = await nodeFn(state);
    expect(update.agentId).toBe('{"summary":"test result","confidence":0.8}');
    expect(update.agentHandoffs).toBeUndefined();
  });

  it('appends systemPrompt override to role.systemPrompt', async () => {
    let capturedSystemPrompt = '';
    const gateway: LLMGateway = {
      async generateText(opts: LLMCallOptions): Promise<LLMResponse> {
        capturedSystemPrompt = opts.systemPrompt ?? '';
        return { content: 'ok', usage: { promptTokens: 1, completionTokens: 1 }, model: 'test' };
      },
      async *streamText() { yield { type: 'done' }; },
      async listModels() { return ['test']; },
      async generateEmbeddings(): Promise<EmbeddingResult> {
        return { embeddings: [], model: 'test', usage: { tokens: 0 } };
      },
    };

    const testDeps = { ...deps, gateway };
    const factory = createAgentNodeFactory<TestState>(testDeps);
    const nodeFn = factory({
      role: REVIEWER_ROLE,
      agentId: 'reviewer',
      input: () => ({ message: 'review this', systemPrompt: 'Focus on risks.' }),
    });

    await nodeFn({ topic: 'x', agentHandoffs: {}, agentId: '' });
    expect(capturedSystemPrompt).toContain(REVIEWER_ROLE.systemPrompt);
    expect(capturedSystemPrompt).toContain('Focus on risks.');
  });

  it('filters tools by role.allowedTools', async () => {
    const factory = createAgentNodeFactory<TestState>(deps);
    const nodeFn = factory({
      role: REVIEWER_ROLE,
      agentId: 'reviewer',
      input: () => ({ message: 'test' }),
    });

    await nodeFn({ topic: 'x', agentHandoffs: {}, agentId: '' });
  });
});

// ── createSelector tests ──

import { createSelector } from '../agent-node.js';
import { END } from '@cabinet/graph';

describe('createSelector', () => {
  it('routes based on decide function reading real state', async () => {
    const selectorFn = createSelector<TestState>({
      targets: ['chair', 'advisor'],
      decide: (s) => {
        if (!(s.agentHandoffs as any)['chair']) return 'chair';
        return END;
      },
      maxRounds: 5,
    });

    const state1: TestState = { topic: 'x', agentHandoffs: {}, agentId: '' };
    const update1 = await selectorFn(state1);
    expect((update1 as any).nextSpeaker).toBe('chair');

    const state2: TestState = {
      topic: 'x',
      agentHandoffs: { chair: { from: 'chair', confidence: 0.8 } },
      agentId: '',
    };
    const update2 = await selectorFn(state2);
    expect((update2 as any).nextSpeaker).toBe('__END__');
  });

  it('terminates after maxRounds', async () => {
    const selectorFn = createSelector<TestState>({
      targets: ['chair'],
      decide: () => 'chair',
      maxRounds: 2,
    });

    const u1 = await selectorFn({ topic: 'x', agentHandoffs: {}, agentId: '' });
    expect((u1 as any).nextSpeaker).toBe('chair');

    const u2 = await selectorFn({ topic: 'x', agentHandoffs: {}, agentId: '' });
    expect((u2 as any).nextSpeaker).toBe('chair');

    const u3 = await selectorFn({ topic: 'x', agentHandoffs: {}, agentId: '' });
    expect((u3 as any).nextSpeaker).toBe('__END__');
  });
});
