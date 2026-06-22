import type { LLMGateway } from '@cabinet/gateway';
import type { DelegationTier } from '@cabinet/types';
import { ToolExecutor } from './tool-executor.js';
import { SdkAgentLoopAdapter } from './sdk-adapter.js';
import { SafetyChecker } from './safety.js';
import { CheckpointManager } from './checkpoint.js';
import type { MemoryProvider } from './context-builder.js';
import {
  type AgentLoopOptions,
  type AgentResult,
  type AgentSessionSummary,
  type SessionCompleteCallback,
} from './execution/agent-loop-options.js';
import type { StreamingCallback } from './execution/types.js';
import { assemblePrompt } from './prompt-assembler.js';
import { createCabinetTools } from './tools/index.js';
import type { ToolDependencies } from './tools/tool-dependencies.js';

export type {
  AgentLoopOptions,
  AgentResult,
  AgentSessionSummary,
  SessionCompleteCallback,
  StreamingCallback,
};

/**
 * AgentLoop — transitional wrapper that delegates to SdkAgentLoopAdapter internally.
 * Maintains backward compatibility while using the SDK v7 ToolLoopAgent under the hood.
 */
export class AgentLoop {
  private adapter: SdkAgentLoopAdapter | null = null;
  private readonly options: AgentLoopOptions;

  onSessionComplete?: SessionCompleteCallback;

  constructor(options: AgentLoopOptions) {
    this.options = options;
  }

  private ensureAdapter(): SdkAgentLoopAdapter {
    if (!this.adapter) {
      this.adapter = this.buildAdapter();
    }
    return this.adapter;
  }

  private buildAdapter(): SdkAgentLoopAdapter {
    const opts = this.options;
    const deps = this.buildDeps();
    const systemPrompt = opts.roleModules?.identity
      ? assemblePrompt({ modules: opts.roleModules, toolExecutor: opts.toolExecutor })
      : (opts.systemPrompt ?? 'You are a helpful assistant.');

    return new SdkAgentLoopAdapter(deps, {
      instructions: systemPrompt,
      model: opts.model,
      temperature: opts.temperature,
      maxResponseTokens: opts.maxResponseTokens,
      maxSteps: opts.maxSteps ?? 50,
    });
  }

  private buildDeps(): ToolDependencies {
    const stub = () => {
      throw new Error('Not available outside server context');
    };
    return {
      decisionStore: null as any,
      eventBus: null as any,
      shortTerm: null as any,
      longTerm: null as any,
      entity: null as any,
      project: null as any,
      memoryFacade: this.options.memoryProvider as any,
      createDecision: async () => ({}) as any,
      approveDecision: async () => ({}) as any,
      rejectDecision: async () => ({}) as any,
      listWorkflows: () => [],
      getWorkflow: () => undefined,
      createWorkflow: () => ({ id: '' }),
      updateWorkflow: () => {},
      deleteWorkflow: () => {},
      runWorkflow: async () => ({ runId: '', status: '' }),
      writeLongTermMemory: async () => '',
      createEmployee: () => {},
      registerAgent: () => ({ type: 'custom' as const, name: '' }),
      updateAgent: () => {},
      deleteAgent: () => {},
      invokeAgent: async () => ({ agentName: '', response: '' }),
      listAgents: () => [],
      setProjectContext: () => ({ id: '', name: '' }),
      createProject: () => ({ id: '', name: '' }),
      listProjects: () => [],
      getProjectContext: () => null,
      getDashboardStats: () => ({
        pendingDecisions: 0,
        activeWorkflows: 0,
        activeProjects: 0,
        todayCost: 0,
        totalLLMCalls: 0,
        totalTokens: 0,
        totalDecisions: 0,
        errors: 0,
        recentEvents: [],
      }),
      delegateTask: () => '',
      getTaskStatus: () => null,
      listActiveTasks: () => [],
      getDecisionAudit: () => [],
      getSystemMetrics: () => ({ totalLLMCalls: 0, totalTokens: 0, totalDecisions: 0, errors: 0 }),
      getWorkflowRun: () => null,
      listWorkflowRuns: () => [],
      readFile: stub as any,
      writeFile: stub as any,
      editFile: stub as any,
      applyPatch: stub as any,
      moveFile: stub as any,
      copyFile: stub as any,
      makeDirectory: stub as any,
      fileInfo: stub as any,
      listDirectory: (async () => []) as any,
      searchFiles: (async () => []) as any,
      searchContent: (async () => []) as any,
      deleteFile: stub as any,
      recentFiles: (async () => []) as any,
      watchFile: (async () => ({ changed: false, size: 0 })) as any,
      indexProject: (async () => ({ indexed: 0, skipped: 0, errors: 1 })) as any,
      webFetch: stub as any,
      httpRequest: stub as any,
      execCommand: stub as any,
      scheduleTask: stub as any,
      listScheduledTasks: (async () => []) as any,
      cancelScheduledTask: stub as any,
      indexDocument: stub as any,
      searchDocuments: (async () => []) as any,
      clearDocumentIndex: stub as any,
      evaluateOutput: (async () => ({
        overallScore: 0,
        dimensions: {},
        feedback: '',
        evaluatorModel: '',
      })) as any,
      workspaceSymbols: (async () => ({ available: false, error: '' })) as any,
      goToDefinition: (async () => ({ available: false, error: '' })) as any,
      findReferences: (async () => ({ available: false, error: '' })) as any,
      diagnostics: (async () => ({ available: false, error: '' })) as any,
      querySystemKnowledge: (async () => []) as any,
      getSystemKnowledge: (async () => null) as any,
      readPdf: stub as any,
      readDocx: stub as any,
      readXlsx: stub as any,
      readPptx: stub as any,
      listZip: stub as any,
      extractZip: stub as any,
      browserNavigate: stub as any,
      browserClick: stub as any,
      browserType: stub as any,
      browserRead: stub as any,
      browserScreenshot: stub as any,
      browserEvaluate: stub as any,
      fetchRss: stub as any,
      sendEmail: stub as any,
      readClipboard: stub as any,
      writeClipboard: stub as any,
      sendNotification: stub as any,
      startProcess: stub as any,
      killProcess: stub as any,
      showOpenDialog: stub as any,
      generateEmbeddings: stub as any,
    } as unknown as ToolDependencies;
  }

  setDelegationTier(_tier: DelegationTier): void {
    // No-op: delegation is handled by toolApproval in SDK
  }

  async run(userMessage: string, _resumeState?: any): Promise<AgentResult> {
    const result = await this.ensureAdapter().run(userMessage);
    return {
      content: result.content,
      steps: result.steps,
      toolCalls: result.toolCalls,
      usage: result.usage,
    };
  }

  async runStreaming(userMessage: string, callback: StreamingCallback): Promise<AgentResult> {
    const result = await this.ensureAdapter().runStreaming(userMessage, {
      onChunk: (content) => callback.onChunk?.(content),
      onThinking: (content) => callback.onThinking?.(content),
      onDone: (content) => callback.onDone?.(content),
      onError: (error) => callback.onError?.(error),
      onToolCall: (name, args) => callback.onToolCall?.(name, args),
      onToolResult: (name, result) => callback.onToolResult?.(name, result),
      onUsage: (usage) => callback.onUsage?.(usage),
    });
    return {
      content: result.content,
      steps: result.steps,
      toolCalls: result.toolCalls,
      usage: result.usage,
    };
  }

  generateHandoff(): string {
    return '';
  }
  resetHandoff(): void {}
  getConversationHistory(): ReadonlyArray<{ role: 'user' | 'assistant'; content: string }> {
    return [];
  }
  clearConversationHistory(): void {}
  setConversationHistory(_history: { role: 'user' | 'assistant'; content: string }[]): void {}
  setSkillContext(_context: string | null): void {}
  getSelfConsistencyEngine(): any {
    return null;
  }
  get monitor(): any {
    return null;
  }

  async resume(userMessage: string): Promise<AgentResult> {
    return this.run(userMessage);
  }

  async continueWithUserInput(input: string, callback: StreamingCallback): Promise<AgentResult> {
    return this.runStreaming(input, callback);
  }
}
