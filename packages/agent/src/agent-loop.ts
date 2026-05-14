import type { LLMGateway, LLMResponse } from '@cabinet/gateway';
import { ToolExecutor } from './tool-executor.js';
import { SafetyChecker } from './safety.js';
import { withRetry } from './retry.js';
import { CheckpointManager, type CheckpointState } from './checkpoint.js';
import { ContextBuilder, type MemoryProvider } from './context-builder.js';

export interface AgentLoopOptions {
  gateway: LLMGateway;
  toolExecutor: ToolExecutor;
  safetyChecker: SafetyChecker;
  checkpointManager: CheckpointManager;
  memoryProvider: MemoryProvider;
  sessionId: string;
  projectId: string;
  captainId: string;
  systemPrompt?: string;
  maxSteps?: number;
}

export interface AgentResult {
  content: string;
  steps: number;
  toolCalls: { name: string; args: Record<string, unknown>; result: unknown }[];
}

export class AgentLoop {
  private readonly gateway: LLMGateway;
  private readonly toolExecutor: ToolExecutor;
  private readonly safetyChecker: SafetyChecker;
  private readonly checkpointManager: CheckpointManager;
  private readonly contextBuilder: ContextBuilder;
  private readonly options: AgentLoopOptions;

  constructor(options: AgentLoopOptions) {
    this.gateway = options.gateway;
    this.toolExecutor = options.toolExecutor;
    this.safetyChecker = options.safetyChecker;
    this.checkpointManager = options.checkpointManager;
    this.contextBuilder = new ContextBuilder(options.memoryProvider);
    this.options = options;
  }

  async run(userMessage: string): Promise<AgentResult> {
    const maxSteps = this.options.maxSteps ?? 10;
    let steps = 0;
    const toolCalls: { name: string; args: Record<string, unknown>; result: unknown }[] = [];

    // Try to restore from checkpoint
    const state = this.checkpointManager.load(this.options.sessionId);
    const messages: { role: 'user' | 'assistant'; content: string }[] =
      state?.messages ?? [];

    // Add user message
    messages.push({ role: 'user', content: userMessage });

    while (steps < maxSteps) {
      // Build context (reload short-term memory each iteration)
      const ctx = await this.contextBuilder.build({
        sessionId: this.options.sessionId,
        projectId: this.options.projectId,
        captainId: this.options.captainId,
        systemPrompt: this.options.systemPrompt,
      });

      // Combine system context messages with conversation messages
      const allMessages = [
        ...ctx.messages,
        ...messages.slice(ctx.messages.length), // only new messages
      ];

      // Call LLM via gateway with retry on transient errors
      let response: LLMResponse;
      try {
        response = await withRetry(
          () =>
            this.gateway.generateText({
              model: 'claude-sonnet-4-6',
              systemPrompt: ctx.systemPrompt,
              messages: allMessages,
            }),
          new Error('LLM call')
        );
      } catch (error) {
        return {
          content: `Agent loop failed at step ${steps}: ${(error as Error).message}`,
          steps,
          toolCalls,
        };
      }

      // No tool calls — agent is done
      if (!response.toolCalls || response.toolCalls.length === 0) {
        messages.push({ role: 'assistant', content: response.content });
        return { content: response.content, steps: steps + 1, toolCalls };
      }

      // Execute tool calls
      for (const tc of response.toolCalls) {
        // Safety check
        const safety = this.safetyChecker.check(tc.name, tc.arguments);
        if (!safety.allowed) {
          toolCalls.push({ name: tc.name, args: tc.arguments, result: `BLOCKED: ${safety.reason}` });
          continue;
        }

        // Execute
        const result = await this.toolExecutor.execute(tc.name, tc.id, tc.arguments);
        toolCalls.push({ name: tc.name, args: tc.arguments, result: result.error ?? result.output });

        // Add tool result as user message for feedback
        messages.push({
          role: 'user',
          content: `Tool result for ${tc.name}: ${JSON.stringify(result.error ?? result.output)}`,
        });
      }

      steps++;

      // Save checkpoint
      this.checkpointManager.save({
        sessionId: this.options.sessionId,
        step: steps,
        messages,
        toolCallHistory: toolCalls,
        metadata: { projectId: this.options.projectId },
      });
    }

    return {
      content: `Agent reached max steps (${maxSteps}) without final response.`,
      steps,
      toolCalls,
    };
  }

  /** Resume from a saved checkpoint */
  async resume(userMessage: string): Promise<AgentResult> {
    const state = this.checkpointManager.load(this.options.sessionId);
    if (!state) {
      return this.run(userMessage);
    }
    // Continue from checkpoint — just add the new message
    return this.run(userMessage);
  }
}
