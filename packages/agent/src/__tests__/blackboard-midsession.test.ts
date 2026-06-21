import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { AgentLoop } from '../agent-loop.js';
import { ToolExecutor } from '../tool-executor.js';
import { SafetyChecker } from '../safety.js';
import { CheckpointManager } from '../checkpoint.js';
import type { MemoryProvider } from '../context-builder.js';
import { MemoryEventBus } from '@cabinet/events';
import { AgentBlackboard } from '../blackboard.js';
import type {
  LLMGateway,
  LLMResponse,
  LLMCallOptions,
  LLMStreamOptions,
  StreamChunk,
  EmbeddingOptions,
  EmbeddingResult,
} from '@cabinet/gateway';
import { streamFromGenerate } from './helpers/mock-gateway.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

class MockMemoryProvider implements MemoryProvider {
  async getShortTerm() {
    return [];
  }
  async getProjectContext() {
    return 'Test project';
  }
  async getEntityPreferences() {
    return { name: 'Captain' };
  }
  async searchLongTerm() {
    return [];
  }
}

class MultiStepMockGateway implements LLMGateway {
  private callCount = 0;

  async generateText(_options: LLMCallOptions): Promise<LLMResponse> {
    this.callCount++;
    if (this.callCount === 1) {
      return {
        content: 'Step 1: initial analysis.',
        toolCalls: [{ id: 'tc1', name: 'read_file', arguments: { path: 'a.ts' } }],
        usage: { promptTokens: 50, completionTokens: 20 },
        model: 'test-model',
      };
    }
    if (this.callCount === 2) {
      return {
        content: 'Step 2: I see the blackboard update.',
        usage: { promptTokens: 100, completionTokens: 30 },
        model: 'test-model',
      };
    }
    return {
      content: 'Done.',
      usage: { promptTokens: 10, completionTokens: 5 },
      model: 'test-model',
    };
  }

  async *streamText(options: LLMStreamOptions): AsyncGenerator<StreamChunk> {
    yield* streamFromGenerate(this.generateText.bind(this), options);
  }

  async listModels(): Promise<string[]> {
    return ['test-model'];
  }

  async generateEmbeddings(_options: EmbeddingOptions): Promise<EmbeddingResult> {
    return { embeddings: [[]], model: 'test-model', usage: { tokens: 0 } };
  }
}

describe('Blackboard Mid-Session Sync', () => {
  it('Agent B perceives Agent A discovery within 3 steps', async () => {
    const db = createTestDb();
    const eventBus = new MemoryEventBus();
    const blackboard = new AgentBlackboard(eventBus);
    const toolExecutor = new ToolExecutor();

    toolExecutor.register({
      name: 'read_file',
      execute: async (args: Record<string, unknown>) => `Content of ${args.path}`,
    });

    // Create AgentLoop B with a gateway that stays alive for 2+ steps
    let bCallCount = 0;
    const gatewayBGenerate = async (): Promise<LLMResponse> => {
      bCallCount++;
      if (bCallCount === 1) {
        return {
          content: 'Step 1: reading files.',
          toolCalls: [{ id: 'tc1', name: 'read_file', arguments: { path: 'a.ts' } }],
          usage: { promptTokens: 50, completionTokens: 20 },
          model: 'test-model',
        };
      }
      return {
        content: 'Step 2: done.',
        usage: { promptTokens: 30, completionTokens: 10 },
        model: 'test-model',
      };
    };
    const gatewayB: LLMGateway = {
      generateText: gatewayBGenerate,
      async *streamText(options: LLMStreamOptions): AsyncGenerator<StreamChunk> {
        yield* streamFromGenerate(gatewayBGenerate, options);
      },
      async listModels() {
        return ['test-model'];
      },
      async generateEmbeddings(_options: EmbeddingOptions): Promise<EmbeddingResult> {
        return { embeddings: [[]], model: 'test-model', usage: { tokens: 0 } };
      },
    };

    const loopB = new AgentLoop({
      gateway: gatewayB,
      toolExecutor,
      safetyChecker: new SafetyChecker(),
      checkpointManager: new CheckpointManager(db),
      memoryProvider: new MockMemoryProvider(),
      sessionId: 'sess-b',
      projectId: 'proj-1',
      captainId: 'captain-1',
      maxSteps: 5,
      eventBus,
      blackboard,
    });

    // Simulate: Agent A writes to blackboard before B starts step 2
    // The BlackboardObserver is already subscribed, so this write will be captured
    await blackboard.write(
      'discoveries',
      { finding: 'Race condition in agent-loop.ts' },
      'agent-a',
    );

    const resultB = await loopB.run('Review codebase');

    // Agent B should have received the blackboard update in its messages
    const bMessages = loopB.getConversationHistory();
    const hasBlackboardUpdate = bMessages.some(
      (m) => m.content.includes('[Shared Context Update]') && m.content.includes('discoveries'),
    );

    expect(hasBlackboardUpdate).toBe(true);
    expect(resultB.steps).toBeLessThanOrEqual(3);
  });

  it('injects pending updates before next LLM call', async () => {
    const db = createTestDb();
    const eventBus = new MemoryEventBus();
    const blackboard = new AgentBlackboard(eventBus);
    const toolExecutor = new ToolExecutor();

    toolExecutor.register({
      name: 'read_file',
      execute: async (args: Record<string, unknown>) => `Content of ${args.path}`,
    });

    let step2Messages: { role: string; content: string }[] = [];

    class SpyGateway implements LLMGateway {
      private callCount = 0;

      async generateText(options: LLMCallOptions): Promise<LLMResponse> {
        this.callCount++;
        if (this.callCount === 2) {
          step2Messages = options.messages;
        }
        if (this.callCount === 1) {
          return {
            content: 'Step 1.',
            toolCalls: [{ id: 'tc1', name: 'read_file', arguments: { path: 'x.ts' } }],
            usage: { promptTokens: 30, completionTokens: 10 },
            model: 'test-model',
          };
        }
        return {
          content: 'Done.',
          usage: { promptTokens: 10, completionTokens: 5 },
          model: 'test-model',
        };
      }

      async *streamText(options: LLMStreamOptions): AsyncGenerator<StreamChunk> {
        yield* streamFromGenerate(this.generateText.bind(this), options);
      }

      async listModels(): Promise<string[]> {
        return ['test-model'];
      }

      async generateEmbeddings(_options: EmbeddingOptions): Promise<EmbeddingResult> {
        return { embeddings: [[]], model: 'test-model', usage: { tokens: 0 } };
      }
    }

    const gateway = new SpyGateway();
    const loop = new AgentLoop({
      gateway,
      toolExecutor,
      safetyChecker: new SafetyChecker(),
      checkpointManager: new CheckpointManager(db),
      memoryProvider: new MockMemoryProvider(),
      sessionId: 'sess-sync',
      projectId: 'proj-1',
      captainId: 'captain-1',
      maxSteps: 5,
      eventBus,
      blackboard,
    });

    // Publish a blackboard update directly via eventBus before running
    await blackboard.write('discoveries', { bug: 'null pointer' }, 'external-agent');

    await loop.run('Test sync');

    // Step 2 messages should contain the blackboard update
    expect(step2Messages.some((m) => m.content.includes('[Shared Context Update]'))).toBe(true);
    expect(step2Messages.some((m) => m.content.includes('null pointer'))).toBe(true);
  });

  it('cross-AgentLoop: Agent B picks up Agent A mid-session discovery', async () => {
    const db = createTestDb();
    const eventBus = new MemoryEventBus();
    const blackboard = new AgentBlackboard(eventBus);
    const toolExecutor = new ToolExecutor();

    toolExecutor.register({
      name: 'read_file',
      execute: async (args: Record<string, unknown>) => `Content of ${args.path}`,
    });

    // ResolvableGateway allows precise control over when each LLM call returns.
    // Supports pre-resolving (calling resolve() before generateText()) by
    // buffering responses in a pending queue.
    class ResolvableGateway implements LLMGateway {
      private resolvers: Array<(response: LLMResponse) => void> = [];
      private pendingResponses: LLMResponse[] = [];

      async generateText(): Promise<LLMResponse> {
        if (this.pendingResponses.length > 0) {
          return this.pendingResponses.shift()!;
        }
        return new Promise((resolve) => {
          this.resolvers.push(resolve);
        });
      }

      resolve(response: LLMResponse) {
        const r = this.resolvers.shift();
        if (r) {
          r(response);
        } else {
          this.pendingResponses.push(response);
        }
      }

      async *streamText(options: LLMStreamOptions): AsyncGenerator<StreamChunk> {
        yield* streamFromGenerate(this.generateText.bind(this), options);
      }

      async listModels(): Promise<string[]> {
        return ['test-model'];
      }

      async generateEmbeddings(_options: EmbeddingOptions): Promise<EmbeddingResult> {
        return { embeddings: [[]], model: 'test-model', usage: { tokens: 0 } };
      }
    }

    const gatewayA = new ResolvableGateway();
    const gatewayB = new ResolvableGateway();

    const loopA = new AgentLoop({
      gateway: gatewayA,
      toolExecutor,
      safetyChecker: new SafetyChecker(),
      checkpointManager: new CheckpointManager(db),
      memoryProvider: new MockMemoryProvider(),
      sessionId: 'sess-a',
      projectId: 'proj-1',
      captainId: 'captain-1',
      maxSteps: 5,
      eventBus,
      blackboard,
    });

    const loopB = new AgentLoop({
      gateway: gatewayB,
      toolExecutor,
      safetyChecker: new SafetyChecker(),
      checkpointManager: new CheckpointManager(db),
      memoryProvider: new MockMemoryProvider(),
      sessionId: 'sess-b',
      projectId: 'proj-1',
      captainId: 'captain-1',
      maxSteps: 5,
      eventBus,
      blackboard,
    });

    // Start both agents (they block on generateText)
    const runA = loopA.run('Analyze');
    const runB = loopB.run('Review');

    // Agent A completes step 1 (tool call keeps loop alive)
    gatewayA.resolve({
      content: 'Step 1: analyzing.',
      toolCalls: [{ id: 'tc1', name: 'read_file', arguments: { path: 'a.ts' } }],
      usage: { promptTokens: 30, completionTokens: 10 },
      model: 'test-model',
    });

    // Agent B completes step 1 (tool call keeps loop alive)
    gatewayB.resolve({
      content: 'Step 1: reviewing.',
      toolCalls: [{ id: 'tc1', name: 'read_file', arguments: { path: 'b.ts' } }],
      usage: { promptTokens: 30, completionTokens: 10 },
      model: 'test-model',
    });

    // Mid-session: Agent A writes a discovery to blackboard
    // This happens while both agents are between step 1 and step 2
    await blackboard.write('discoveries', { finding: 'Cross-agent race condition' }, 'agent-a');

    // Agent B completes step 2 (tool call, keeps loop alive for step 3)
    gatewayB.resolve({
      content: 'Step 2: continuing review.',
      toolCalls: [{ id: 'tc2', name: 'read_file', arguments: { path: 'c.ts' } }],
      usage: { promptTokens: 30, completionTokens: 10 },
      model: 'test-model',
    });

    // Agent A completes step 2 (no tool call, finishes)
    gatewayA.resolve({
      content: 'Step 2: done.',
      usage: { promptTokens: 30, completionTokens: 10 },
      model: 'test-model',
    });

    // Agent B completes step 3 (should have blackboard update injected before this LLM call)
    gatewayB.resolve({
      content: 'Step 3: detected shared discovery.',
      usage: { promptTokens: 30, completionTokens: 10 },
      model: 'test-model',
    });

    const [resultA, resultB] = await Promise.all([runA, runB]);

    // Agent B should have the blackboard update in its conversation history
    const bMessages = loopB.getConversationHistory();
    const hasUpdate = bMessages.some(
      (m) =>
        m.content.includes('[Shared Context Update]') &&
        m.content.includes('Cross-agent race condition'),
    );

    expect(hasUpdate).toBe(true);
    expect(resultB.steps).toBeLessThanOrEqual(4);
  }, 15000);
});
