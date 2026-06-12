import { CheckpointManager, type CheckpointState } from '../checkpoint.js';
import { ContextBuilder, type ContextBuildResult } from '../context-builder.js';
import { ContextHandoff } from '../context-handoff.js';
import { ProjectSnapshot } from '../project-snapshot.js';
import { getSkillRegistry } from '../skill-registry.js';
import { injectBlackboardSnapshot } from '../blackboard-compress.js';
import { AgentBlackboard } from '../blackboard.js';
import { truncateAtBoundary } from './text-utils.js';
import type { AgentLoopOptions } from './agent-loop-options.js';
import type { AgentExecutionContext } from '../observer-pipeline.js';

export interface ContextAssemblyInput {
  options: AgentLoopOptions;
  checkpointManager: CheckpointManager;
  contextBuilder: ContextBuilder;
  conversationHistory: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
  sessionHandoff: ContextHandoff | null;
  skillContext: string | null;
}

export interface ContextAssemblyResult {
  context: AgentExecutionContext;
  sessionHandoff: ContextHandoff;
  skillContext: string | null;
}

export async function assembleExecutionContext(
  userMessage: string,
  input: ContextAssemblyInput,
  resumeState?: CheckpointState | null,
): Promise<ContextAssemblyResult> {
  const { options, checkpointManager, contextBuilder, conversationHistory } = input;
  // Try to restore from checkpoint
  const state = resumeState ?? checkpointManager.load(options.sessionId);
  const steps = state?.step ?? 0;
  const executedToolCalls: {
    name: string;
    args: Record<string, unknown>;
    result: unknown;
  }[] =
    (state?.toolCallHistory as {
      name: string;
      args: Record<string, unknown>;
      result: unknown;
    }[]) ?? [];

  const messages: { role: 'user' | 'assistant'; content: string }[] = state?.messages ?? [];
  const wasCrashed = (state?.metadata as Record<string, unknown>)?.crashed === true;
  if (wasCrashed) {
    messages.push({
      role: 'assistant',
      content:
        '[System: Previous session crashed. Resuming from checkpoint — some progress may have been lost. Review the last tool result for idempotency.]',
    });
  }

  // Merge conversation history
  if (conversationHistory.length > 0) {
    const existingContents = new Set(messages.map((m) => m.content));
    const newHistory = conversationHistory.filter((m) => !existingContents.has(m.content));
    messages.unshift(...newHistory);
  }

  // Deduplicate user message
  if (messages.length > 0 && messages[messages.length - 1]!.content === userMessage) {
    // already present
  } else {
    messages.push({ role: 'user', content: userMessage });
  }

  // Initialize or reuse handoff tracker
  let sessionHandoff = input.sessionHandoff;
  if (!sessionHandoff) {
    sessionHandoff = new ContextHandoff(userMessage);
  }

  // Build context
  const ctxBuild = await contextBuilder.build({
    sessionId: options.sessionId,
    projectId: options.projectId,
    captainId: options.captainId,
    roleSystemPrompt: options.systemPrompt,
    activeFiles: options.activeFiles,
    taskDescription: steps === 0 ? options.taskDescription : undefined,
    memorySessionId: options.memorySessionId,
    prebuiltContext: options.prebuiltContext,
    roleModules: options.roleModules,
  });

  let sysPrompt = ctxBuild.systemPrompt;
  const projectRoot = options.projectRoot ?? process.cwd();
  const snapshot =
    ProjectSnapshot.getCached(projectRoot) ??
    (() => {
      const c = ProjectSnapshot.capture(projectRoot);
      ProjectSnapshot.store(projectRoot, c);
      return c;
    })();
  if (snapshot && !options.systemPrompt && !options.roleModules) {
    sysPrompt = `${sysPrompt}\n\n## Project Structure\n${snapshot.summary}\n\nKey directories:\n${snapshot.tree.slice(0, 20).join('\n')}`;
  }
  let skillContext = input.skillContext;
  if (skillContext) {
    sysPrompt = `${sysPrompt}\n\n## Active Skill Context\n${skillContext}`;
    skillContext = null;
  }

  // Inject prompt-exposed skills into system prompt (built-in skills are loaded on demand as tools)
  const promptSkills = getSkillRegistry()
    .getPromptSkills()
    .filter((s) => !s.builtIn);
  if (promptSkills.length > 0) {
    const skillSections = promptSkills
      .map((s) => `### ${s.name}\n${s.description}\n${truncateAtBoundary(s.promptTemplate, 2000)}`)
      .join('\n\n');
    sysPrompt = `${sysPrompt}\n\n## Available Skills\n${skillSections}`;
  }

  // Inject Blackboard snapshot
  if (options.blackboard) {
    const bbSnapshot = options.blackboard.snapshot();
    if (bbSnapshot) {
      sysPrompt = injectBlackboardSnapshot(sysPrompt, bbSnapshot, 2000);
    }
  }

  // Inject MCP resources/prompts metadata
  if (options.mcpResources && options.mcpResources.length > 0) {
    const resLines = options.mcpResources
      .map((r) => `- ${r.name}: ${r.uri}${r.description ? ` — ${r.description}` : ''}`)
      .join('\n');
    sysPrompt += `\n\n## Available MCP Resources\n${resLines}\n\nTo read a resource, include "read resource://<uri>" in your response.`;
  }
  if (options.mcpPrompts && options.mcpPrompts.length > 0) {
    const promptLines = options.mcpPrompts
      .map((p) => `- ${p.name}${p.description ? ` — ${p.description}` : ''}`)
      .join('\n');
    sysPrompt += `\n\n## Available MCP Prompts\n${promptLines}\n\nTo use a prompt, include "use prompt:<name>" in your response.`;
  }

  // Deduplicate context messages against internal history
  const internalContents = new Set(messages.map((m) => m.content));
  const uniqueCtxMessages = ctxBuild.messages.filter((m) => !internalContents.has(m.content));
  const allMsgs = [...uniqueCtxMessages, ...messages];

  return {
    sessionHandoff,
    skillContext,
    context: {
      sessionId: options.sessionId,
      projectId: options.projectId,
      captainId: options.captainId,
      model: options.model ?? 'claude-sonnet-4-6',
      messages: allMsgs,
      systemPrompt: sysPrompt,
      stepCount: steps,
      consecutiveErrors: 0,
      zoneCounts: { smart: 0, warning: 0, critical: 0, dumb: 0 },
      handoffCount: 0,
      errorCounts: { transient: 0, recoverable: 0, fatal: 0 },
      toolCounts: { total: 0, succeeded: 0, failed: 0, blocked: 0 },
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      zone: 'smart',
      toolCallHistory: executedToolCalls,
      zoneCrossings: [],
      currentStepText: '',
      currentStepToolCalls: [],
      handoff: sessionHandoff,
      finalContent: '',
      startTime: Date.now(),
    },
  };
}
