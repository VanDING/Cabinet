import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { AgentDispatcher } from '../dispatcher.js';
import { ToolExecutor } from '../tool-executor.js';
import { AgentRoleRegistry, SECRETARY_ROLE, CURATOR_ROLE, ORGANIZE_ROLE } from '../agent-roles.js';
import type {
  LLMGateway,
  LLMResponse,
  LLMCallOptions,
  EmbeddingOptions,
  EmbeddingResult,
} from '@cabinet/gateway';

// ── Golden file ───────────────────────────────────────────────

import goldenFile from './__snapshots__/dispatch-characterization-v2.0.json';

interface GoldenCase {
  mode: string;
  roles: string[];
  request: string;
  expected: {
    minSteps: number;
    maxSteps: number;
    stepCount: number;
    allCompleted: boolean;
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

// Simple deterministic mock gateway for dispatcher tests.
// It always returns a completion with content derived from the last user message.
class DeterministicGateway implements LLMGateway {
  private callCount = 0;

  async generateText(options: LLMCallOptions): Promise<LLMResponse> {
    this.callCount++;
    const lastMessage = options.messages[options.messages.length - 1];
    const userInput = lastMessage?.content ?? '';

    // Simulate a tool call on first step for certain inputs
    if (
      this.callCount === 1 &&
      (userInput.includes('search') || userInput.includes('find') || userInput.includes('audit'))
    ) {
      return {
        content: 'Let me search for that.',
        toolCalls: [{ id: 'tc1', name: 'grep', arguments: { pattern: 'TODO', path: '.' } }],
        usage: { promptTokens: 50, completionTokens: 20 },
        model: 'test-model',
      };
    }

    // Default: direct answer via keyword matching (robust to prompt prefix changes)
    let content: string;
    if (userInput.includes('what can you do')) {
      content =
        'I am the Secretary of Cabinet. I can help you with general questions, routing tasks to specialists, and managing your project.';
    } else if (userInput.includes('project status')) {
      content =
        'Project status summary: Memory index is healthy. 3 decisions pending. 2 workflows active. No critical alerts.';
    } else if (userInput.includes('decisions')) {
      content =
        'Analysis complete. Recent decisions cover architecture changes (L2), tool additions (L1), and documentation updates (L0). Summary: 5 decisions, 2 approved, 3 pending.';
    } else if (userInput.includes('workflow') && userInput.includes('code review')) {
      content =
        'Workflow design: 1) Developer submits PR → 2) Auto-lint → 3) Unit tests → 4) Code review agent → 5) Approval gate → 6) Merge.';
    } else if (userInput.includes('health') && userInput.includes('multiple angles')) {
      content =
        'Project health evaluation: Code quality 85%, Test coverage 72%, Documentation 90%, Decision backlog 3 items. Overall: healthy with minor gaps.';
    } else if (userInput.includes('audit')) {
      content =
        'System audit findings: 2 deprecated agents, 1 orphaned workflow, memory fragmentation at 12%. Recommendations: clean up agents, archive old workflows.';
    } else {
      content = `Processed: ${userInput.slice(0, 80)}`;
    }

    return {
      content,
      usage: { promptTokens: 30, completionTokens: content.length / 4 },
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

interface DispatchCharacterizationResult {
  caseId: string;
  passed: boolean;
  failures: string[];
  mode: string;
  totalSteps: number;
  stepCount: number;
  allCompleted: boolean;
  output: string;
  outputTokens: number;
}

async function runDispatchCase(
  caseId: string,
  goldenCase: GoldenCase,
): Promise<DispatchCharacterizationResult> {
  const db = createTestDb();
  const gateway = new DeterministicGateway();
  const toolExecutor = new ToolExecutor();

  toolExecutor.register({
    name: 'grep',
    execute: async (args: Record<string, unknown>) => `Matches for "${args.pattern}": mock result`,
  });

  const registry = new AgentRoleRegistry();
  registry.register(SECRETARY_ROLE);
  registry.register(CURATOR_ROLE);
  registry.register(ORGANIZE_ROLE);
  registry.register({
    type: 'custom',
    name: 'custom',
    description: 'Custom agent for testing.',
    modules: { identity: 'You are a custom agent.' },
    modelTier: 'default',
    temperature: 0.5,
    allowedTools: [],
    contextBudget: 0.3,
  });

  const dispatcher = new AgentDispatcher(
    gateway,
    toolExecutor,
    db,
    {
      async getShortTerm() {
        return [];
      },
      async getProjectContext() {
        return 'Test project';
      },
      async getEntityPreferences() {
        return { name: 'Captain' };
      },
      async searchLongTerm() {
        return [];
      },
    },
    undefined,
    registry,
  );

  const result = await dispatcher.dispatch({
    mode: goldenCase.mode as 'single' | 'pipeline' | 'parallel',
    request: goldenCase.request,
    sessionId: `dispatch-${caseId}`,
    projectId: 'dispatch-proj',
    captainId: 'dispatch-captain',
    roles: goldenCase.roles as any,
    maxStepsPerAgent: 5,
  });

  const failures: string[] = [];

  // Validate mode
  if (result.mode !== goldenCase.mode) {
    failures.push(`mode ${result.mode} !== expected ${goldenCase.mode}`);
  }

  // Validate total steps range
  if (result.totalSteps < goldenCase.expected.minSteps) {
    failures.push(`totalSteps ${result.totalSteps} < min ${goldenCase.expected.minSteps}`);
  }
  if (result.totalSteps > goldenCase.expected.maxSteps) {
    failures.push(`totalSteps ${result.totalSteps} > max ${goldenCase.expected.maxSteps}`);
  }

  // Validate step count
  if (result.steps.length !== goldenCase.expected.stepCount) {
    failures.push(
      `step count ${result.steps.length} !== expected ${goldenCase.expected.stepCount}`,
    );
  }

  // Validate all completed
  const allCompleted = result.steps.every((s) => s.status === 'completed');
  if (allCompleted !== goldenCase.expected.allCompleted) {
    failures.push(`allCompleted=${allCompleted} !== expected ${goldenCase.expected.allCompleted}`);
  }

  // Validate output keywords
  const outputLower = result.finalOutput.toLowerCase();
  const hasKeyword = goldenCase.expected.outputContainsAny.some((kw) =>
    outputLower.includes(kw.toLowerCase()),
  );
  if (!hasKeyword) {
    failures.push(
      `output does not contain any of [${goldenCase.expected.outputContainsAny.join(', ')}]`,
    );
  }

  // Validate output token bound
  const approxTokens = result.finalOutput.length / 4;
  if (approxTokens > goldenCase.expected.outputMaxTokens) {
    failures.push(
      `output tokens ~${approxTokens.toFixed(0)} > max ${goldenCase.expected.outputMaxTokens}`,
    );
  }

  return {
    caseId,
    passed: failures.length === 0,
    failures,
    mode: result.mode,
    totalSteps: result.totalSteps,
    stepCount: result.steps.length,
    allCompleted,
    output: result.finalOutput.slice(0, 200),
    outputTokens: Math.round(approxTokens),
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe('Dispatcher Characterization Tests', () => {
  const results: DispatchCharacterizationResult[] = [];

  afterAll(() => {
    const passed = results.filter((r) => r.passed).length;
    const total = results.length;
    console.log(`\n=== Dispatch Characterization Summary: ${passed}/${total} passed ===`);
    for (const r of results) {
      const status = r.passed ? '✅ PASS' : '❌ FAIL';
      console.log(
        `${status}  ${r.caseId}: mode=${r.mode}, steps=${r.totalSteps}, stepCount=${r.stepCount}, allCompleted=${r.allCompleted}`,
      );
      if (!r.passed) {
        for (const f of r.failures) console.log(`       ↳ ${f}`);
      }
    }
    console.log('=====================================\n');
  });

  for (const [caseId, goldenCase] of Object.entries(golden.cases)) {
    it(`mode ${caseId}: "${goldenCase.request.slice(0, 50)}..."`, async () => {
      const result = await runDispatchCase(caseId, goldenCase);
      results.push(result);
      expect(result.passed).toBe(true);
    });
  }

  it('acceptance: all dispatch cases pass', () => {
    const passed = results.filter((r) => r.passed).length;
    expect(passed).toBe(results.length);
  });
});
