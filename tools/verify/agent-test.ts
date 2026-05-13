/**
 * Agent Verification Script
 *
 * Tests the TAOR loop with real tools (no LLM required for basic test).
 *
 * Usage:
 *   cd tools/verify && npx tsx agent-test.ts
 */
import { AgentLoop, ToolExecutor, SafetyChecker, CheckpointManager } from '@cabinet/agent';
import type { MemoryProvider } from '@cabinet/agent';
import type { LLMGateway, LLMCallOptions, LLMResponse, StreamChunk, EmbeddingOptions, EmbeddingResult } from '@cabinet/gateway';
import Database from 'better-sqlite3';

// ── Mock LLM Gateway ──────────────────────────────────────────────────────

class TestGateway implements LLMGateway {
  private callCount = 0;

  callCount_(): number {
    return this.callCount;
  }

  async generateText(options: LLMCallOptions): Promise<LLMResponse> {
    this.callCount++;
    if (this.callCount === 1) {
      // First call: return a tool call
      return {
        content: '',
        toolCalls: [{ id: 'tc1', name: 'get_status', arguments: {} }],
        usage: { promptTokens: 10, completionTokens: 5 },
        model: 'test',
      };
    }
    // Second call: final response after tool execution
    return {
      content: `Agent completed after ${this.callCount} LLM calls. Status: operational.`,
      usage: { promptTokens: 20, completionTokens: 10 },
      model: 'test',
    };
  }

  async *streamText(_options: LLMCallOptions): AsyncIterable<StreamChunk> {
    yield { type: 'text', content: 'Test stream' };
    yield { type: 'done' };
  }

  async listModels(): Promise<string[]> {
    return ['test'];
  }

  async generateEmbeddings(options: EmbeddingOptions): Promise<EmbeddingResult> {
    return {
      embeddings: options.texts.map(() => [0.1, 0.2]),
      model: 'test',
      usage: { tokens: 0 },
    };
  }
}

// ── Mock Memory Provider ──────────────────────────────────────────────────

class TestMemory implements MemoryProvider {
  async getShortTerm(_sessionId: string): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
    return [];
  }
  async getProjectContext(_projectId: string): Promise<string> {
    return 'Test project';
  }
  async getEntityPreferences(_captainId: string): Promise<Record<string, unknown>> {
    return { name: 'Captain' };
  }
  async searchLongTerm(_q: string, _p: string): Promise<string[]> {
    return [];
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== Cabinet Agent Verification ===\n');

  // 1. Tool Executor
  console.log('1. ToolExecutor...');
  const executor = new ToolExecutor();
  executor.register({ name: 'get_status', execute: async () => ({ status: 'ok' }) });
  executor.register({ name: 'echo', execute: async (args) => args.message });

  const result1 = await executor.execute('get_status', 'c1', {});
  console.log(`   get_status: ${result1.error ? 'FAIL' : 'PASS'} — ${JSON.stringify(result1.output)}`);

  const result2 = await executor.execute('echo', 'c2', { message: 'hello' });
  console.log(`   echo: ${result2.error ? 'FAIL' : 'PASS'} — output=${result2.output}`);

  const result3 = await executor.execute('unknown', 'c3', {});
  console.log(`   unknown tool: ${result3.error ? 'PASS' : 'FAIL'} — error handled`);

  // 2. Safety Checker
  console.log('\n2. SafetyChecker...');
  const safety = new SafetyChecker();

  const safeResult = safety.check('read_file', {});
  console.log(`   read_file: ${safeResult.allowed && safeResult.tier === 'cache' ? 'PASS' : 'FAIL'}`);

  const dangerResult = safety.check('delete_file', { path: '/tmp/test' });
  console.log(`   delete_file: ${!dangerResult.allowed && dangerResult.tier === 'ai_classifier' ? 'PASS' : 'FAIL'}`);

  // 3. Agent Loop (mock gateway)
  console.log('\n3. AgentLoop with tool calls...');
  const ckptDb = new Database(':memory:');
  const ckpt = new CheckpointManager(ckptDb);

  const gateway = new TestGateway();

  const loop = new AgentLoop({
    gateway: gateway as unknown as LLMGateway,
    toolExecutor: executor,
    safetyChecker: safety,
    checkpointManager: ckpt,
    memoryProvider: new TestMemory(),
    sessionId: 'verify',
    projectId: 'test',
    captainId: 'captain',
    maxSteps: 3,
  });

  const agentResult = await loop.run('Test the agent');
  console.log(`   result: ${agentResult.content}`);
  console.log(`   steps: ${agentResult.steps}`);
  console.log(`   toolCalls: ${agentResult.toolCalls.length}`);
  const agentPass = agentResult.toolCalls.length > 0 && agentResult.content.includes('completed');
  console.log(`   AgentLoop: ${agentPass ? 'PASS' : 'FAIL'}`);

  ckptDb.close();

  // 4. Summary
  const allPass =
    result1.error === undefined &&
    result3.error !== undefined &&
    safeResult.allowed &&
    !dangerResult.allowed &&
    agentPass;

  console.log(`\n=== ${allPass ? 'ALL VERIFICATIONS PASSED' : 'SOME TESTS FAILED'} ===`);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
