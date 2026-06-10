// Agent dispatch — external/specialist dispatch + streaming + context slots.
// Extracted from agents.ts.

// Agent factory, dispatch functions — extracted from secretary.ts (Phase 1.1 split).

import { AsyncLocalStorage } from 'node:async_hooks';
import type { ServerContext } from '../../../context.js';
import { getServerContext, onTierChange } from '../../../context.js';
import { DEFAULT_CAPTAIN_ID, MessageType, type DelegationTier } from '@cabinet/types';
import {
  AgentLoop,
  SafetyChecker,
  CheckpointManager,
  AgentRoleRegistry,
  RulesLoader,
  OrganizeInteractiveAgent,
  CliAdapter,
  A2AConnector,
} from '@cabinet/agent';
import type { AgentRoleType, InteractiveSubAgent } from '@cabinet/agent';
import {
  SecretaryAgent,
  IntentParser,
  type FeedbackStore,
  type ParsedIntent,
  type AgentRouteResult,
} from '@cabinet/secretary';
import { broadcast } from '../../../ws/handler.js';
import { chunkText, cosineSimilarity } from '../../../utils/text-utils.js';
import {
  createStandardToolExecutor,
  createStandardMemoryProvider,
} from '../../../agent-factory.js';
import { buildEnvironmentSection } from '../../../capabilities.js';
import { EvaluationResultRepository } from '@cabinet/storage';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

// Shared sub-module imports
import { execAsync, ROLES_NEEDING_ENV, loadCabinetMd, buildSystemPrompt } from '../utils.js';
import { buildToolDependencies } from '../tool-dependencies.js';

import {
  resolveModel,
  getAgentLoopForRole,
  persistReviewResult,
  createReviewerLoop,
} from './agent-factory.js';
export async function dispatchToExternalAgent(
  agentId: string,
  message: string,
  sessionId: string,
  projectId: string,
  captainId: string,
): Promise<string> {
  const ctx = getServerContext();
  const registry = ctx.agentRegistry;
  const roleDef = registry.get(agentId);
  if (!roleDef?.external) return `[Error] Agent ${agentId} has no external config.`;

  // ── Create child session ──
  const childSessionId = `ext_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  ctx.sessionManager.create(childSessionId, `External: ${agentId}`, projectId);
  const childSession = ctx.sessionManager.get(childSessionId);
  if (childSession) {
    childSession.parentId = sessionId;
    childSession.agentType = agentId;
    childSession.status = 'active';
  }

  // ── Initialize Context Slot ──
  const slot = await buildContextSlot(projectId, captainId, message, sessionId);
  ctx.sessionManager.setContextSlot(childSessionId, slot);

  // ── Pull-mode (daemon): enqueue task for async execution ──
  if (ctx.daemon?.hasAgent(agentId)) {
    const taskId = await ctx.daemon.enqueueTask({
      agentId,
      sessionId: childSessionId,
      capability: 'default',
      input: message,
      slot,
      maxRetries: roleDef.external.maxRetries ?? 2,
      timeoutMs: roleDef.external.timeoutMs ?? 120_000,
    });

    if (childSession) {
      childSession.status = 'active';
      // Store task reference so EventBus can correlate result later
      (childSession as { _daemonTaskId?: string })._daemonTaskId = taskId;
    }

    ctx.logger.info('External agent task enqueued (pull-mode)', {
      agentId,
      taskId,
      sessionId: childSessionId,
    });

    return `[Queued] Task ${taskId} dispatched to ${agentId}.\nTrack progress: /api/daemon/tasks/${taskId}`;
  }

  // ── Push-mode (fallback): direct adapter dispatch ──

  // ── Build external task ──
  const task = {
    task_id: childSessionId,
    session_id: childSessionId,
    capability: 'default',
    input: message,
    slot,
    configuration: {
      max_retries: roleDef.external.maxRetries ?? 2,
      timeout_ms: roleDef.external.timeoutMs ?? 120_000,
      slot_write_url: `http://localhost:${process.env.PORT ?? 3000}/api/slot/${childSessionId}/write`,
    },
  };

  // ── Dispatch via adapter ──
  try {
    const adapter = getOrCreateAdapter(agentId, roleDef);
    const result = await adapter.dispatchTask(task);

    // Inject result into child session
    if (childSession) {
      childSession.deliverable = result.output;
      childSession.status = result.status === 'completed' ? 'completed' : 'error';
    }

    // Inject deliverable into parent session via AgentEventBus
    ctx.agentEventBus.publish(childSessionId, sessionId, {
      type: 'completed',
      deliverable: { agentId, output: result.output, discoveries: result.discoveries },
      timestamp: Date.now(),
    });

    ctx.logger.info('External agent task completed (push-mode)', {
      agentId,
      taskId: childSessionId,
      status: result.status,
    });

    return typeof result.output === 'string' ? result.output : JSON.stringify(result.output ?? {});
  } catch (err) {
    ctx.logger.error('External agent task failed (push-mode)', { agentId, error: String(err) });
    if (childSession) childSession.status = 'error';
    return `[External Agent Error] ${agentId}: ${String(err)}`;
  }
}

/** Build a Context Slot with project context, memories, and preferences. */
export async function buildContextSlot(
  projectId: string,
  captainId: string,
  taskDescription: string,
  sessionId: string,
): Promise<import('@cabinet/types').ContextSlot> {
  const ctx = getServerContext();
  const projectCtx = ctx.project.get(projectId);
  const prefs = ctx.entity.getPreferences(captainId);
  const recentFiles = ctx.fileTracker.getRecent(sessionId, 5);

  // Fall back to project repo if memory isn't populated yet
  let projectName = projectCtx?.summary;
  let projectGoals = projectCtx?.goals ?? [];
  let projectTech = (projectCtx as any)?.techSummary;
  if (!projectCtx) {
    const dbProject = ctx.projectRepo.findById(projectId);
    if (dbProject) {
      projectName = dbProject.name;
      projectGoals = [];
      projectTech = undefined;
    }
  }

  // Search long-term memory for relevant context
  let memories: string[] = [];
  try {
    const results = await ctx.longTerm.search(taskDescription, 5);
    memories = results.map((r) => r.content);
  } catch {
    /* memory search is best-effort */
  }

  return {
    version: 0,
    project: {
      name: projectName ?? projectId,
      tech_stack: projectTech,
      goals: projectGoals,
    },
    memories,
    preferences: (prefs?.preferences ?? {}) as Record<string, unknown>,
    files: recentFiles.map((f) => f.path),
    discoveries: [],
    previous_outputs: [],
    security: {
      level: 'L1',
      maxRetries: 2,
    },
  };
}

/** Cache of created adapters, keyed by agentId. */
export const adapterCache = new Map<string, any>();

/** Get or create an adapter for an external agent. */
export function getOrCreateAdapter(
  agentId: string,
  roleDef: import('@cabinet/agent').AgentRole,
): any {
  const cached = adapterCache.get(agentId);
  if (cached) return cached;

  const ext = roleDef.external!;
  if (ext.protocol === 'cli') {
    const adapter = new CliAdapter(agentId, {
      command: ext.command ?? agentId,
      args: ext.args ?? ['--print'],
      env: ext.env,
      permissionMode: ext.permissionMode as 'auto' | 'conservative',
      detectCommand: ext.detectCommand,
      installCommand: ext.installCommand,
      timeoutMs: ext.timeoutMs,
      maxRetries: ext.maxRetries,
    });
    adapterCache.set(agentId, adapter);
    return adapter;
  }

  // A2A
  const adapter = new A2AConnector(agentId, {
    baseUrl: ext.baseUrl ?? `http://localhost:${agentId}`,
    healthCheckUrl: ext.healthCheckUrl,
    authConfig: ext.authConfig as { type: 'api_key' | 'oauth'; header?: string; envVar?: string },
    timeoutMs: ext.timeoutMs,
    maxRetries: ext.maxRetries,
  });
  adapterCache.set(agentId, adapter);
  return adapter;
}

/** Dispatch a message to a specialist role's AgentLoop, with optional Reviewer quality gate. */
export async function dispatchToSpecialist(
  roleType: AgentRoleType,
  message: string,
  sessionId: string,
  projectId: string,
  captainId: string,
  thinkingBudget?: number,
  model?: string,
): Promise<string> {
  const ctx = getServerContext();

  // ── External Agent Dispatch ──────────────────────────────────
  if (roleType.startsWith('external_')) {
    return dispatchToExternalAgent(roleType, message, sessionId, projectId, captainId);
  }

  // Dynamic model up/downgrade based on task complexity
  let effectiveModel = model;
  if (!effectiveModel) {
    const registry = ctx.agentRegistry;
    const roleDef = registry.get(roleType);

    // Upgrade: complex tasks need better models
    if (roleDef?.upgradeModelTier) {
      const needsUpgrade =
        message.includes('L3') || message.includes('安全关键') || message.length > 2000;
      if (needsUpgrade) {
        effectiveModel = resolveModel({ modelTier: roleDef.upgradeModelTier });
      }
    }

    // Downgrade: simple modifications don't need reasoning models
    if (!effectiveModel && roleDef?.downgradeModelTier) {
      // No built-in roles currently use downgrade; custom agents may opt in.
      const needsDowngrade = false;
      if (needsDowngrade) {
        effectiveModel = resolveModel({ modelTier: roleDef.downgradeModelTier });
      }
    }
  }

  const loop = getAgentLoopForRole(
    roleType,
    sessionId,
    projectId,
    captainId,
    thinkingBudget,
    effectiveModel,
  );
  if (!loop) return `[No LLM] Cannot dispatch to ${roleType}.`;

  const result = await loop.run(message);
  let output = result.content;

  // Quality gate: external and custom agent outputs get reviewed
  if (roleType !== 'secretary' && roleType !== 'curator') {
    const reviewerLoop = createReviewerLoop(ctx);
    if (reviewerLoop) {
      // Segmented review for long outputs: show first 4000 + last 4000 chars with truncation note
      const reviewContent =
        output.length > 8000
          ? output.slice(0, 4000) +
            '\n\n[...output truncated, total length: ' +
            output.length +
            ' chars...]\n\n' +
            output.slice(-4000)
          : output;

      const toolCallSummary =
        result.toolCalls.length > 0
          ? `\nTool calls made by ${roleType} during execution:\n${result.toolCalls.map((t) => `- ${t.name}(${JSON.stringify(t.args).slice(0, 100)}): ${JSON.stringify(t.result).slice(0, 100)}`).join('\n')}`
          : '';

      const reviewTask = [
        `## Quality Review Task`,
        '',
        `Review the following output produced by the "${roleType}" agent.`,
        `The original user message was: "${message.slice(0, 500)}"`,
        '',
        `Agent output to review:`,
        reviewContent,
        toolCallSummary,
        '',
        `Review for: logical completeness, evidence quality, risk assessment, factual errors.`,
        `Use available tools (search_memory, search_documents, read_file) to verify claims if possible.`,
        '',
        `After review, output ONLY a JSON object:`,
        `{"pass": true/false, "score": 0.0-1.0, "issues": [...], "suggestion": {...}}`,
      ].join('\n');

      try {
        const reviewResult = await reviewerLoop.run(reviewTask);
        const reviewMatch = reviewResult.content.match(/\{[\s\S]*\}/);
        const review = reviewMatch
          ? JSON.parse(reviewMatch[0])
          : { pass: true, score: 1.0, issues: [] };

        // Persist review result
        persistReviewResult(ctx, roleType, sessionId, review);

        if (review.pass !== true && review.issues?.length > 0) {
          // Publish quality alert for Harness
          if (ctx.eventBus) {
            ctx.eventBus
              .publish({
                messageId: `quality_alert_${Date.now()}`,
                correlationId: sessionId,
                causationId: null,
                timestamp: new Date(),
                messageType: MessageType.QualityAlert,
                payload: {
                  type: 'review_quality',
                  message: `Quality review for ${roleType}: score ${review.score}, ${review.issues?.length ?? 0} issues`,
                  severity: review.score < 0.5 ? 'high' : review.score < 0.7 ? 'medium' : 'low',
                },
              })
              .catch((err) => {
                console.warn('Operation failed', err);
              });

            broadcast('quality_alert', {
              source: roleType,
              sessionId,
              score: review.score,
              issueCount: review.issues?.length ?? 0,
              topIssue: review.issues?.[0]?.detail?.slice(0, 200) ?? null,
            });
          }

          // Append reviewer notes to output
          const issueNotes = (review.issues as any[])
            .map((i: any) => `- [${i.severity}] ${i.detail}`)
            .join('\n');
          output = `${output}\n\n---\n### Reviewer Notes\n${issueNotes}\n\n⚠️ Review score: ${review.score ?? 'N/A'}`;
        }
      } catch {
        // Review failure is non-fatal — return original output
      }
    }
  }

  return output;
}

/** Dispatch a message to a specialist role with streaming output. */
export async function dispatchToSpecialistStreaming(
  roleType: AgentRoleType,
  message: string,
  sessionId: string,
  projectId: string,
  captainId: string,
  callback: import('@cabinet/agent').StreamingCallback,
  thinkingBudget?: number,
  model?: string,
  interactive?: boolean,
): Promise<void> {
  const ctx = getServerContext();

  // ── Interactive mode for Organize agent ──
  if (interactive && roleType === 'organize') {
    const childSession = ctx.sessionManager.createChildSession(sessionId, roleType);
    const childSessionId = childSession.id;

    const resolveModel = (tier: string) => {
      try {
        const role = { modelTier: tier };
        const adapter = ctx.gateway as { resolveModelString?: (t: string) => string };
        if (adapter?.resolveModelString) {
          return adapter.resolveModelString(tier);
        }
        return tier;
      } catch {
        return tier;
      }
    };

    const toolExecutor = createStandardToolExecutor(
      ctx,
      buildToolDependencies(ctx, projectId === 'global' ? undefined : projectId, {
        getAgentLoopForRole,
        resolveModel,
      }),
    );
    const interactiveAgent = new OrganizeInteractiveAgent(ctx.gateway!, toolExecutor, resolveModel);

    // Register in active map
    activeSubAgents.set(childSessionId, {
      loop: null as unknown as import('@cabinet/agent').AgentLoop,
      interactive: interactiveAgent,
      parentSessionId: sessionId,
      roleType,
      status: 'running',
    });

    // Forward events from interactive agent to AgentEventBus + SSE callback
    interactiveAgent.onEvent.on('event', (event: import('@cabinet/events').AgentEvent) => {
      ctx.agentEventBus.publish(childSessionId, sessionId, event);
      if (event.type === 'stream_chunk') callback.onChunk?.(event.content);
      else if (event.type === 'thinking') callback.onThinking?.(event.content);
      else if (event.type === 'tool_call')
        callback.onToolCall?.(event.name, event.args as Record<string, unknown>);
      else if (event.type === 'tool_result') callback.onToolResult?.(event.name, event.result);
      else if (event.type === 'output') callback.onDone?.(event.content);
      else if (event.type === 'error') callback.onError?.(event.message);
      else if (event.type === 'status') {
        const mappedStatus = event.status === 'running' ? 'active' : event.status;
        ctx.sessionManager.updateStatus(childSessionId, mappedStatus);
        const entry = activeSubAgents.get(childSessionId);
        if (entry) entry.status = event.status;
      }
    });

    try {
      await interactiveAgent.init({
        sessionId: childSessionId,
        parentSessionId: sessionId,
        projectId,
        captainId,
        message,
        model: model ?? undefined,
      });
      const status = interactiveAgent.getStatus();
      const entry = activeSubAgents.get(childSessionId);
      if (entry) entry.status = status;
      callback.onDone?.('Blueprint ready for review');
    } catch (e) {
      callback.onError?.((e as Error).message ?? 'Unknown error');
      activeSubAgents.delete(childSessionId);
    }
    return;
  }

  const loop = getAgentLoopForRole(
    roleType,
    sessionId,
    projectId,
    captainId,
    thinkingBudget,
    model,
  );
  if (!loop) {
    callback.onError?.(`[No LLM] Cannot dispatch to ${roleType}.`);
    callback.onDone('');
    return;
  }

  // Create a child session for this sub-agent run
  const childSession = ctx.sessionManager.createChildSession(sessionId, roleType);
  const childSessionId = childSession.id;

  // Wrap callback to dual-track events via AgentEventBus
  const wrappedCallback: import('@cabinet/agent').StreamingCallback = {
    ...callback,
    onChunk(content) {
      callback.onChunk?.(content);
      ctx.agentEventBus.publish(childSessionId, sessionId, {
        type: 'stream_chunk',
        content,
        timestamp: Date.now(),
      });
    },
    onThinking(content) {
      callback.onThinking?.(content);
      ctx.agentEventBus.publish(childSessionId, sessionId, {
        type: 'thinking',
        content,
        timestamp: Date.now(),
      });
    },
    onToolCall(name, args) {
      callback.onToolCall?.(name, args);
      ctx.agentEventBus.publish(childSessionId, sessionId, {
        type: 'tool_call',
        name,
        args,
        timestamp: Date.now(),
      });
    },
    onToolResult(name, result) {
      callback.onToolResult?.(name, result);
      ctx.agentEventBus.publish(childSessionId, sessionId, {
        type: 'tool_result',
        name,
        result,
        timestamp: Date.now(),
      });
    },
    onDone(fullContent) {
      callback.onDone?.(fullContent);
      ctx.agentEventBus.publish(childSessionId, sessionId, {
        type: 'output',
        content: fullContent,
        timestamp: Date.now(),
      });
    },
    onError(error) {
      callback.onError?.(error);
      ctx.sessionManager.updateStatus(childSessionId, 'error');
      ctx.agentEventBus.publish(childSessionId, sessionId, {
        type: 'error',
        message: error,
        timestamp: Date.now(),
      });
      activeSubAgents.delete(childSessionId);
    },
  };

  // Publish start event
  ctx.agentEventBus.publish(childSessionId, sessionId, {
    type: 'started',
    timestamp: Date.now(),
  });

  // Register in active map so mid-flight input can reach this loop
  activeSubAgents.set(childSessionId, {
    loop,
    parentSessionId: sessionId,
    roleType,
    status: 'running',
  });

  try {
    const result = await loop.runStreaming(message, wrappedCallback);
    ctx.sessionManager.updateStatus(childSessionId, 'completed');
    ctx.sessionManager.setDeliverable(childSessionId, {
      agentType: roleType,
      content: result.content,
      toolCalls: result.toolCalls,
    });
    ctx.agentEventBus.publish(childSessionId, sessionId, {
      type: 'completed',
      deliverable: result.content,
      timestamp: Date.now(),
    });
    // Keep in active map until explicitly finalized (or auto-finalize after a timeout)
    // For now, leave it so user can still send "regenerate" if desired.
    // Async quality review after streaming completes (does not block the stream)
    if (roleType !== 'secretary') {
      const reviewerLoop = createReviewerLoop(ctx);
      if (reviewerLoop) {
        const reviewContent =
          result.content.length > 8000
            ? result.content.slice(0, 4000) +
              '\n\n[...output truncated, total length: ' +
              result.content.length +
              ' chars...]\n\n' +
              result.content.slice(-4000)
            : result.content;
        const reviewTask = [
          `## Quality Review Task`,
          '',
          `Review the following output produced by the "${roleType}" agent.`,
          `The original user message was: "${message.slice(0, 500)}"`,
          '',
          `Agent output to review:`,
          reviewContent,
          '',
          `Review for: logical completeness, evidence quality, risk assessment, factual errors.`,
          `Use available tools (search_memory, search_documents, read_file) to verify claims if possible.`,
          '',
          `After review, output ONLY a JSON object:`,
          `{"pass": true/false, "score": 0.0-1.0, "issues": [...], "suggestion": {...}}`,
        ].join('\n');
        reviewerLoop
          .run(reviewTask)
          .then((reviewResult) => {
            const reviewMatch = reviewResult.content.match(/\{[\s\S]*\}/);
            const review = reviewMatch
              ? JSON.parse(reviewMatch[0])
              : { pass: true, score: 1.0, issues: [] };
            persistReviewResult(ctx, roleType, sessionId, review);
            wrappedCallback.onQualityReview?.({
              pass: !!review.pass,
              score: typeof review.score === 'number' ? review.score : 1.0,
              issues: Array.isArray(review.issues) ? review.issues : [],
            });
            if (review.pass !== true && review.issues?.length > 0 && ctx.eventBus) {
              ctx.eventBus
                .publish({
                  messageId: `quality_alert_${Date.now()}`,
                  correlationId: sessionId,
                  causationId: null,
                  timestamp: new Date(),
                  messageType: MessageType.QualityAlert,
                  payload: {
                    type: 'review_quality',
                    message: `Quality review for ${roleType}: score ${review.score}, ${review.issues?.length ?? 0} issues`,
                    severity: review.score < 0.5 ? 'high' : review.score < 0.7 ? 'medium' : 'low',
                  },
                })
                .catch((err) => {
                  console.warn('Operation failed', err);
                });
              broadcast('quality_alert', {
                source: roleType,
                sessionId,
                score: review.score,
                issueCount: review.issues?.length ?? 0,
                topIssue: review.issues?.[0]?.detail?.slice(0, 200) ?? null,
              });
            }
          })
          .catch((err) => {
            console.warn('Operation failed', err);
          });
      }
    }
  } catch (e) {
    wrappedCallback.onError?.((e as Error).message ?? 'Unknown error');
    wrappedCallback.onDone('');
  }
}

// ── activeSubAgents (defined here, re-exported by shell) ──
export const activeSubAgents = new Map<
  string,
  {
    loop: import('@cabinet/agent').AgentLoop;
    interactive?: import('@cabinet/agent').InteractiveSubAgent;
    parentSessionId: string;
    roleType: string;
    status: 'running' | 'waiting_for_user' | 'completed' | 'error';
  }
>();
