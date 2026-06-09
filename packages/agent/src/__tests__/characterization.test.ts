import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { AgentLoop } from '../agent-loop.js';
import { ToolExecutor } from '../tool-executor.js';
import { SafetyChecker } from '../safety.js';
import { CheckpointManager } from '../checkpoint.js';
import type { MemoryProvider } from '../context-builder.js';
import type {
  LLMGateway,
  LLMResponse,
  LLMCallOptions,
  EmbeddingOptions,
  EmbeddingResult,
} from '@cabinet/gateway';
import type { AgentSessionSummary } from '../agent-loop.js';
import { MemoryEventBus } from '@cabinet/events';

// ── Golden file ───────────────────────────────────────────────

import goldenFile from './__snapshots__/characterization-v2.0.json';

interface GoldenCase {
  input: string;
  expected: {
    minSteps: number;
    maxSteps: number;
    toolCallNames: string[];
    zoneRange: string[];
    requireMinZones?: number;
    outputContainsAny: string[];
    outputMaxTokens: number;
  };
}

interface GoldenFile {
  baseline_version: string;
  created_at: string;
  cases: Record<string, GoldenCase>;
}

const golden = goldenFile as unknown as GoldenFile;

// ── Helpers ───────────────────────────────────────────────────

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

// A deterministic mock gateway that simulates LLM behavior for each scenario.
// It uses keyword matching on the user message to decide which scenario to run.
class ScenarioMockGateway implements LLMGateway {
  private callCount = 0;
  private scenario: string;
  private variant: number;

  constructor(scenarioId: string) {
    // Parse "1_code_review_v1" → scenario="1_code_review", variant=1
    const match = scenarioId.match(/^(.+)_(v\d+)$/);
    this.scenario = match ? match[1]! : scenarioId;
    this.variant = match ? parseInt(match[2]!.replace('v', ''), 10) : 1;
  }

  reset() {
    this.callCount = 0;
  }

  async generateText(options: LLMCallOptions): Promise<LLMResponse> {
    this.callCount++;
    const step = this.callCount;
    const scenario = this.scenario;

    // ── Scenario 1: code_review ──────────────────────────────
    if (scenario === '1_code_review') {
      if (step === 1) {
        return {
          content: 'Let me read the file first.',
          toolCalls: [{ id: 'tc1', name: 'read_file', arguments: { path: 'src/agent-loop.ts' } }],
          usage: { promptTokens: 50, completionTokens: 20 },
          model: 'test-model',
        };
      }
      if (step === 2) {
        return {
          content: 'Now let me search for related patterns.',
          toolCalls: [
            { id: 'tc2', name: 'grep', arguments: { pattern: 'TODO|FIXME|BUG', path: 'src' } },
          ],
          usage: { promptTokens: 200, completionTokens: 25 },
          model: 'test-model',
        };
      }
      return {
        content:
          '## Code Review Summary\n\nI found no critical issues. The agent-loop.ts file has solid error handling and checkpoint recovery. One minor issue: the `_execute` method could benefit from clearer separation between read-only and write tool execution paths. Overall: no issues blocking release.',
        usage: { promptTokens: 400, completionTokens: 150 },
        model: 'test-model',
      };
    }

    // ── Scenario 2: file_read ────────────────────────────────
    if (scenario === '2_file_read') {
      if (step === 1) {
        return {
          content: 'Let me read that file for you.',
          toolCalls: [
            { id: 'tc1', name: 'read_file', arguments: { path: 'packages/types/src/index.ts' } },
          ],
          usage: { promptTokens: 30, completionTokens: 15 },
          model: 'test-model',
        };
      }
      return {
        content:
          "## File Contents\n\n```typescript\nexport type { MessageType } from './events.js';\nexport type { AgentOutput, PipelineStep } from './agent.js';\nexport interface ProjectConfig {\n  name: string;\n  rootPath: string;\n}\n```\n\nThe file exports core type definitions including MessageType, AgentOutput, and PipelineStep.",
        usage: { promptTokens: 100, completionTokens: 80 },
        model: 'test-model',
      };
    }

    // ── Scenario 3: multi_tool ───────────────────────────────
    if (scenario === '3_multi_tool') {
      if (step === 1) {
        return {
          content: 'Let me search for references.',
          toolCalls: [
            { id: 'tc1', name: 'grep', arguments: { pattern: 'MemoryProvider', path: 'packages' } },
          ],
          usage: { promptTokens: 60, completionTokens: 20 },
          model: 'test-model',
        };
      }
      if (step === 2) {
        return {
          content: 'Now let me read the key files.',
          toolCalls: [
            {
              id: 'tc2',
              name: 'read_file',
              arguments: { path: 'packages/agent/src/context-builder.ts' },
            },
            {
              id: 'tc3',
              name: 'read_file',
              arguments: { path: 'packages/agent/src/agent-loop.ts' },
            },
          ],
          usage: { promptTokens: 250, completionTokens: 30 },
          model: 'test-model',
        };
      }
      return {
        content:
          '## Usage Summary\n\nMemoryProvider is imported and used in:\n1. `context-builder.ts` — defines the interface and implements short-term memory retrieval\n2. `agent-loop.ts` — injected into ContextBuilder during AgentLoop construction\n3. `interactive-sub-agent.ts` — used for sub-agent memory lookups\n\nTotal found: 3 primary usage locations.',
        usage: { promptTokens: 500, completionTokens: 120 },
        model: 'test-model',
      };
    }

    // ── Scenario 4: error_handling ───────────────────────────
    if (scenario === '4_error_handling') {
      if (step === 1) {
        return {
          content: 'I will try to call the tool.',
          toolCalls: [{ id: 'tc1', name: 'imaginary_tool', arguments: { foo: 1 } }],
          usage: { promptTokens: 40, completionTokens: 15 },
          model: 'test-model',
        };
      }
      if (step === 2) {
        return {
          content: 'That tool does not exist. Let me try a fallback approach.',
          toolCalls: [{ id: 'tc2', name: 'read_file', arguments: { path: 'README.md' } }],
          usage: { promptTokens: 80, completionTokens: 25 },
          model: 'test-model',
        };
      }
      return {
        content:
          '## Error Handling Report\n\nThe tool `imaginary_tool` is not available in the current tool registry. The AgentLoop correctly handled the error by catching the unknown tool exception and falling back to a safe read operation. No fatal errors occurred.',
        usage: { promptTokens: 150, completionTokens: 70 },
        model: 'test-model',
      };
    }

    // ── Scenario 5: context_bound ────────────────────────────
    if (scenario === '5_context_bound') {
      // With contextBudget=0.005, effectiveMaxTokens = 200,000 * 0.005 = 1000.
      // Zone thresholds: smart<400, warning<600, critical<800, dumb>=800 tokens.
      // Step 1: short text + tool call → smart zone
      // Step 2: medium text + tool call → warning zone
      // Step 3: another medium text + tool call → critical zone
      // Step 4: long text (no tool calls) → dumb zone
      const short = 'AI architecture covers data pipelines and model training. ';
      const medium =
        'Modern systems use distributed inference and monitoring layers for scalability. ';
      if (step === 1) {
        return {
          content: 'Let me gather reference material.',
          toolCalls: [
            { id: 'tc1', name: 'read_file', arguments: { path: 'docs/ai-reference.md' } },
          ],
          usage: { promptTokens: 30, completionTokens: 10 },
          model: 'test-model',
        };
      }
      if (step === 2) {
        return {
          content: medium.repeat(8),
          toolCalls: [
            {
              id: 'tc2',
              name: 'write_file',
              arguments: { path: '/tmp/draft1.md', content: 'draft' },
            },
          ],
          usage: { promptTokens: 50, completionTokens: 200 },
          model: 'test-model',
        };
      }
      if (step === 3) {
        return {
          content: medium.repeat(8),
          toolCalls: [
            {
              id: 'tc3',
              name: 'write_file',
              arguments: { path: '/tmp/draft2.md', content: 'draft' },
            },
          ],
          usage: { promptTokens: 80, completionTokens: 200 },
          model: 'test-model',
        };
      }
      return {
        content: '## Conclusion\n\n' + short.repeat(5) + medium.repeat(20),
        usage: { promptTokens: 120, completionTokens: 500 },
        model: 'test-model',
      };
    }

    // Fallback
    return {
      content: 'Done.',
      usage: { promptTokens: 10, completionTokens: 5 },
      model: 'test-model',
    };
  }

  async *streamText(): AsyncGenerator<never> {
    yield { type: 'done' } as never;
  }

  async listModels(): Promise<string[]> {
    return ['test-model'];
  }

  async generateEmbeddings(_options: EmbeddingOptions): Promise<EmbeddingResult> {
    return { embeddings: [[]], model: 'test-model', usage: { tokens: 0 } };
  }
}

// ── Test harness ──────────────────────────────────────────────

interface CharacterizationResult {
  caseId: string;
  input: string;
  steps: number;
  toolCallNames: string[];
  zones: string[];
  output: string;
  outputTokens: number;
  passed: boolean;
  failures: string[];
}

async function runCharacterizationCase(
  caseId: string,
  goldenCase: GoldenCase,
): Promise<CharacterizationResult> {
  const db = createTestDb();
  const gateway = new ScenarioMockGateway(caseId);
  const eventBus = new MemoryEventBus();
  const toolExecutor = new ToolExecutor();

  // Register real and fake tools
  toolExecutor.register({
    name: 'read_file',
    execute: async (args: Record<string, unknown>) => `Content of ${args.path}: mock file content`,
  });
  toolExecutor.register({
    name: 'grep',
    execute: async (args: Record<string, unknown>) =>
      `Matches for "${args.pattern}": line 10, line 25`,
  });
  toolExecutor.register({
    name: 'searchFiles',
    execute: async (args: Record<string, unknown>) =>
      `Files matching "${args.pattern}": a.ts, b.ts`,
  });
  toolExecutor.register({
    name: 'write_file',
    execute: async (args: Record<string, unknown>) =>
      `Wrote to ${args.path}: ${(args.content as string)?.slice(0, 20)}`,
  });
  // imaginary_tool is NOT registered → will produce error

  let sessionSummary: AgentSessionSummary | undefined;

  const loop = new AgentLoop({
    gateway,
    toolExecutor,
    safetyChecker: new SafetyChecker(),
    checkpointManager: new CheckpointManager(db),
    memoryProvider: new MockMemoryProvider(),
    sessionId: `char-${caseId}`,
    projectId: 'char-proj',
    captainId: 'char-captain',
    maxSteps: 25,
    taskDescription: goldenCase.input,
    eventBus,
    systemPrompt: caseId.startsWith('5_') ? 'Short system prompt.' : undefined,
    contextBudget: caseId.startsWith('5_') ? 0.004 : 1.0,
    onSessionComplete: (summary) => {
      sessionSummary = summary;
    },
  });

  const result = await loop.run(goldenCase.input);
  const failures: string[] = [];

  // Validate step count
  if (result.steps < goldenCase.expected.minSteps) {
    failures.push(`steps ${result.steps} < min ${goldenCase.expected.minSteps}`);
  }
  if (result.steps > goldenCase.expected.maxSteps) {
    failures.push(`steps ${result.steps} > max ${goldenCase.expected.maxSteps}`);
  }

  // Validate tool call names (subset check)
  const actualToolNames = new Set(result.toolCalls.map((tc) => tc.name));
  const expectedToolNames = new Set(goldenCase.expected.toolCallNames);
  if (expectedToolNames.size > 0) {
    const hasAnyExpected = [...expectedToolNames].some((name) => actualToolNames.has(name));
    if (!hasAnyExpected) {
      failures.push(
        `tool calls [${[...actualToolNames].join(', ')}] contain none of expected [${[...expectedToolNames].join(', ')}]`,
      );
    }
  }

  // Validate zone range
  const zones = sessionSummary
    ? Object.entries(sessionSummary.contextZones)
        .filter(([, count]) => count > 0)
        .map(([zone]) => zone)
    : ['smart'];
  const nonSmartZones = zones.filter((z) => z !== 'smart');
  const nonSmartInRange = nonSmartZones.every((z) => goldenCase.expected.zoneRange.includes(z));
  if (!nonSmartInRange) {
    failures.push(
      `non-smart zones [${nonSmartZones.join(', ')}] not in expected range [${goldenCase.expected.zoneRange.join(', ')}]`,
    );
  }
  if (
    goldenCase.expected.requireMinZones &&
    nonSmartZones.length < goldenCase.expected.requireMinZones
  ) {
    failures.push(
      `hit ${nonSmartZones.length} non-smart zone(s), require at least ${goldenCase.expected.requireMinZones}`,
    );
  }

  // Validate output keywords
  const outputLower = result.content.toLowerCase();
  const hasKeyword = goldenCase.expected.outputContainsAny.some((kw) =>
    outputLower.includes(kw.toLowerCase()),
  );
  if (!hasKeyword) {
    failures.push(
      `output does not contain any of [${goldenCase.expected.outputContainsAny.join(', ')}]`,
    );
  }

  // Validate output token bound (approximate via length)
  const approxTokens = result.content.length / 4;
  if (approxTokens > goldenCase.expected.outputMaxTokens) {
    failures.push(
      `output tokens ~${approxTokens.toFixed(0)} > max ${goldenCase.expected.outputMaxTokens}`,
    );
  }

  return {
    caseId,
    input: goldenCase.input,
    steps: result.steps,
    toolCallNames: [...actualToolNames],
    zones,
    output: result.content.slice(0, 200),
    outputTokens: Math.round(approxTokens),
    passed: failures.length === 0,
    failures,
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe('AgentLoop Characterization Tests', () => {
  const results: CharacterizationResult[] = [];

  afterAll(() => {
    // Print summary table
    const passed = results.filter((r) => r.passed).length;
    const total = results.length;
    console.log(`\n=== Characterization Summary: ${passed}/${total} passed ===`);
    for (const r of results) {
      const status = r.passed ? '✅ PASS' : '❌ FAIL';
      console.log(
        `${status}  ${r.caseId}: steps=${r.steps}, tools=[${r.toolCallNames.join(', ')}], zones=[${r.zones.join(', ')}]`,
      );
      if (!r.passed) {
        for (const f of r.failures) console.log(`       ↳ ${f}`);
      }
    }
    console.log('=====================================\n');
  });

  for (const [caseId, goldenCase] of Object.entries(golden.cases)) {
    it(`scenario ${caseId}: "${goldenCase.input.slice(0, 60)}..."`, async () => {
      const result = await runCharacterizationCase(caseId, goldenCase);
      results.push(result);
      expect(result.passed).toBe(true);
    });
  }

  it('acceptance: ≥ 9/10 cases pass', () => {
    const passed = results.filter((r) => r.passed).length;
    expect(passed).toBeGreaterThanOrEqual(9);
  });
});

// ── Streaming Characterization Tests ──────────────────────────

describe('AgentLoop Streaming Characterization Tests', () => {
  const results: CharacterizationResult[] = [];

  afterAll(() => {
    const passed = results.filter((r) => r.passed).length;
    const total = results.length;
    console.log(`\n=== Streaming Characterization Summary: ${passed}/${total} passed ===`);
    for (const r of results) {
      const status = r.passed ? '✅ PASS' : '❌ FAIL';
      console.log(`${status}  ${r.caseId}: steps=${r.steps}, zones=[${r.zones.join(', ')}]`);
      if (!r.passed) {
        for (const f of r.failures) console.log(`       ↳ ${f}`);
      }
    }
    console.log('=====================================\n');
  });

  async function runStreamingCase(
    caseId: string,
    scenarioId: string,
    goldenCase: GoldenCase,
  ): Promise<CharacterizationResult> {
    const db = createTestDb();
    const gateway = new ScenarioMockGateway(scenarioId);
    const eventBus = new MemoryEventBus();
    const toolExecutor = new ToolExecutor();

    toolExecutor.register({
      name: 'read_file',
      execute: async (args: Record<string, unknown>) =>
        `Content of ${args.path}: mock file content`,
    });
    toolExecutor.register({
      name: 'grep',
      execute: async (args: Record<string, unknown>) =>
        `Matches for "${args.pattern}": line 10, line 25`,
    });
    toolExecutor.register({
      name: 'searchFiles',
      execute: async (args: Record<string, unknown>) =>
        `Files matching "${args.pattern}": a.ts, b.ts`,
    });
    toolExecutor.register({
      name: 'write_file',
      execute: async (args: Record<string, unknown>) =>
        `Wrote to ${args.path}: ${(args.content as string)?.slice(0, 20)}`,
    });

    let sessionSummary: AgentSessionSummary | undefined;
    const chunks: string[] = [];

    const loop = new AgentLoop({
      gateway,
      toolExecutor,
      safetyChecker: new SafetyChecker(),
      checkpointManager: new CheckpointManager(db),
      memoryProvider: new MockMemoryProvider(),
      sessionId: `stream-${caseId}`,
      projectId: 'stream-proj',
      captainId: 'stream-captain',
      maxSteps: 25,
      taskDescription: goldenCase.input,
      eventBus,
      systemPrompt: scenarioId.startsWith('5_') ? 'Short system prompt.' : undefined,
      contextBudget: scenarioId.startsWith('5_') ? 0.004 : 1.0,
      onSessionComplete: (summary) => {
        sessionSummary = summary;
      },
    });

    const result = await loop.runStreaming(goldenCase.input, {
      onChunk: (content) => chunks.push(content),
      onDone: () => {},
    });

    const failures: string[] = [];

    if (result.steps < goldenCase.expected.minSteps) {
      failures.push(`steps ${result.steps} < min ${goldenCase.expected.minSteps}`);
    }
    if (result.steps > goldenCase.expected.maxSteps) {
      failures.push(`steps ${result.steps} > max ${goldenCase.expected.maxSteps}`);
    }

    const actualToolNames = new Set(result.toolCalls.map((tc) => tc.name));
    const expectedToolNames = new Set(goldenCase.expected.toolCallNames);
    if (expectedToolNames.size > 0) {
      const hasAnyExpected = [...expectedToolNames].some((name) => actualToolNames.has(name));
      if (!hasAnyExpected) {
        failures.push(
          `tool calls [${[...actualToolNames].join(', ')}] contain none of expected [${[...expectedToolNames].join(', ')}]`,
        );
      }
    }

    const zones = sessionSummary
      ? Object.entries(sessionSummary.contextZones)
          .filter(([, count]) => count > 0)
          .map(([zone]) => zone)
      : ['smart'];
    const nonSmartZones = zones.filter((z) => z !== 'smart');
    const nonSmartInRange = nonSmartZones.every((z) => goldenCase.expected.zoneRange.includes(z));
    if (!nonSmartInRange) {
      failures.push(
        `non-smart zones [${nonSmartZones.join(', ')}] not in expected range [${goldenCase.expected.zoneRange.join(', ')}]`,
      );
    }
    if (
      goldenCase.expected.requireMinZones &&
      nonSmartZones.length < goldenCase.expected.requireMinZones
    ) {
      failures.push(
        `hit ${nonSmartZones.length} non-smart zone(s), require at least ${goldenCase.expected.requireMinZones}`,
      );
    }

    const outputLower = result.content.toLowerCase();
    const hasKeyword = goldenCase.expected.outputContainsAny.some((kw) =>
      outputLower.includes(kw.toLowerCase()),
    );
    if (!hasKeyword) {
      failures.push(
        `output does not contain any of [${goldenCase.expected.outputContainsAny.join(', ')}]`,
      );
    }

    const approxTokens = result.content.length / 4;
    if (approxTokens > goldenCase.expected.outputMaxTokens) {
      failures.push(
        `output tokens ~${approxTokens.toFixed(0)} > max ${goldenCase.expected.outputMaxTokens}`,
      );
    }

    // Streaming-specific: should have received chunks
    if (chunks.length === 0) {
      failures.push('no streaming chunks received');
    }

    return {
      caseId,
      input: goldenCase.input,
      steps: result.steps,
      toolCallNames: [...actualToolNames],
      zones,
      output: result.content.slice(0, 200),
      outputTokens: Math.round(approxTokens),
      passed: failures.length === 0,
      failures,
    };
  }

  it('streaming scenario: code_review matches run() behavior', async () => {
    const caseId = 'stream_code_review';
    const goldenCase = golden.cases['1_code_review_v1']!;
    const result = await runStreamingCase(caseId, '1_code_review_v1', goldenCase);
    results.push(result);
    expect(result.passed).toBe(true);
  });

  it('streaming scenario: file_read matches run() behavior', async () => {
    const caseId = 'stream_file_read';
    const goldenCase = golden.cases['2_file_read_v1']!;
    const result = await runStreamingCase(caseId, '2_file_read_v1', goldenCase);
    results.push(result);
    expect(result.passed).toBe(true);
  });

  it('streaming scenario: context_bound triggers zone crossing', async () => {
    const caseId = 'stream_context_bound';
    const goldenCase = golden.cases['5_context_bound_v1']!;
    const result = await runStreamingCase(caseId, '5_context_bound_v1', goldenCase);
    results.push(result);
    expect(result.passed).toBe(true);
  }, 15000);

  it('acceptance: all streaming cases pass', () => {
    const passed = results.filter((r) => r.passed).length;
    expect(passed).toBe(results.length);
  });
});
