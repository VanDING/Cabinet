import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { AgentLoop } from '../agent-loop.js';
import { ToolExecutor } from '../tool-executor.js';
import { SafetyChecker } from '../safety.js';
import { CheckpointManager } from '../checkpoint.js';
import type { MemoryProvider } from '../context-builder.js';
import type { LLMGateway, LLMResponse, LLMCallOptions, EmbeddingOptions, EmbeddingResult } from '@cabinet/gateway';

// In-memory SQLite for tests
function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

class MockMemoryProvider implements MemoryProvider {
  async getShortTerm(_sessionId: string) { return []; }
  async getProjectContext(_projectId: string) { return 'Test project'; }
  async getEntityPreferences(_captainId: string) { return { name: 'Captain' }; }
  async searchLongTerm(_query: string, _projectId: string) { return []; }
}

describe('AgentLoop', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('completes simple task without tool calls', async () => {
    const mockGateway: LLMGateway = {
      async generateText(_options: LLMCallOptions): Promise<LLMResponse> {
        return {
          content: 'Hello Captain! How can I help?',
          usage: { promptTokens: 10, completionTokens: 5 },
          model: 'test-model',
        };
      },
      async *streamText() { yield { type: 'done' }; },
      async listModels() { return ['test-model']; },
      async generateEmbeddings(_options: EmbeddingOptions): Promise<EmbeddingResult> {
        return { embeddings: [], model: 'test-model', usage: { tokens: 0 } };
      },
    };

    const loop = new AgentLoop({
      gateway: mockGateway,
      toolExecutor: new ToolExecutor(),
      safetyChecker: new SafetyChecker(),
      checkpointManager: new CheckpointManager(db),
      memoryProvider: new MockMemoryProvider(),
      sessionId: 'sess-1',
      projectId: 'proj-1',
      captainId: 'captain-1',
      maxSteps: 5,
    });

    const result = await loop.run('Hello!');
    expect(result.content).toContain('Hello Captain');
    expect(result.steps).toBe(1);
    expect(result.toolCalls).toHaveLength(0);
  });

  it('executes tool calls and returns final response', async () => {
    let callCount = 0;
    const mockGateway: LLMGateway = {
      async generateText(_options: LLMCallOptions): Promise<LLMResponse> {
        callCount++;
        if (callCount === 1) {
          return {
            content: '',
            toolCalls: [{ id: 'tc1', name: 'echo', arguments: { message: 'test' } }],
            usage: { promptTokens: 10, completionTokens: 5 },
            model: 'test-model',
          };
        }
        return {
          content: 'Tool executed successfully.',
          usage: { promptTokens: 10, completionTokens: 5 },
          model: 'test-model',
        };
      },
      async *streamText() { yield { type: 'done' }; },
      async listModels() { return ['test-model']; },
      async generateEmbeddings(_options: EmbeddingOptions): Promise<EmbeddingResult> {
        return { embeddings: [], model: 'test-model', usage: { tokens: 0 } };
      },
    };

    const toolExecutor = new ToolExecutor();
    toolExecutor.register({
      name: 'echo',
      execute: async (args) => args.message,
    });

    const loop = new AgentLoop({
      gateway: mockGateway,
      toolExecutor,
      safetyChecker: new SafetyChecker(),
      checkpointManager: new CheckpointManager(db),
      memoryProvider: new MockMemoryProvider(),
      sessionId: 'sess-2',
      projectId: 'proj-2',
      captainId: 'captain-1',
      maxSteps: 5,
    });

    const result = await loop.run('Echo test');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.name).toBe('echo');
    expect(callCount).toBe(2);
  });

  it('blocks dangerous tools', async () => {
    const mockGateway: LLMGateway = {
      async generateText(_options: LLMCallOptions): Promise<LLMResponse> {
        return {
          content: '',
          toolCalls: [{ id: 'tc1', name: 'delete_file', arguments: { path: '/etc/hosts' } }],
          usage: { promptTokens: 10, completionTokens: 5 },
          model: 'test-model',
        };
      },
      async *streamText() { yield { type: 'done' }; },
      async listModels() { return ['test-model']; },
      async generateEmbeddings(_options: EmbeddingOptions): Promise<EmbeddingResult> {
        return { embeddings: [], model: 'test-model', usage: { tokens: 0 } };
      },
    };

    const loop = new AgentLoop({
      gateway: mockGateway,
      toolExecutor: new ToolExecutor(),
      safetyChecker: new SafetyChecker(),
      checkpointManager: new CheckpointManager(db),
      memoryProvider: new MockMemoryProvider(),
      sessionId: 'sess-3',
      projectId: 'proj-1',
      captainId: 'captain-1',
      maxSteps: 1,
    });

    const result = await loop.run('Delete something');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.result).toContain('BLOCKED');
  });

  it('saves and restores from checkpoint', () => {
    const cp = new CheckpointManager(db);
    cp.save({
      sessionId: 'sess-cp',
      step: 3,
      messages: [{ role: 'user', content: 'test' }],
      toolCallHistory: [],
      metadata: {},
    });
    const loaded = cp.load('sess-cp');
    expect(loaded).not.toBeNull();
    expect(loaded!.step).toBe(3);
  });
});
