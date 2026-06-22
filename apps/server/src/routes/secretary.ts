import { Hono } from 'hono';
import { z } from 'zod';
import { AsyncLocalStorage } from 'node:async_hooks';
import { getServerContext, onTierChange, type ServerContext } from '../context.js';
import { DEFAULT_CAPTAIN_ID, MessageType, type DelegationTier } from '@cabinet/types';
import {
  AgentLoop,
  AgentDispatcher,
  SafetyChecker,
  CheckpointManager,
  AgentRoleRegistry,
  RulesLoader,
  OrganizeInteractiveAgent,
  CliAdapter,
  A2AConnector,
} from '@cabinet/agent';
import type { ToolDependencies, AgentRoleType, InteractiveSubAgent } from '@cabinet/agent';
import {
  SecretaryAgent,
  IntentParser,
  GreetingService,
  type FeedbackStore,
  type ParsedIntent,
  type AgentRouteResult,
} from '@cabinet/secretary';
import { broadcast } from '../ws/handler.js';
import { detectDangerousCommand } from '../utils/security.js';
import {
  chunkText,
  cosineSimilarity,
  extractTitle,
  type ChunkResult,
} from '../utils/text-utils.js';
import { globToRegex, safeRegex } from '../utils/regex-utils.js';
import { isInternalIP } from '../utils/net-utils.js';
import { createStandardToolExecutor, createStandardMemoryProvider } from '../agent-factory.js';
import { runWorkflowById } from './workflows.js';
import type { DispatchMode } from '@cabinet/agent';
import type { Decision } from '@cabinet/types';
import {
  buildEnvironmentSection,
  createSystemKnowledgeCapabilities,
  createDocumentCapabilities,
  createArchiveCapabilities,
  createBrowserCapabilities,
  createCommunicationCapabilities,
  createSystemCapabilities,
} from '../capabilities.js';
import {
  getWorkspaceSymbols,
  getDefinition,
  getReferences,
  getDiagnostics,
} from '../lsp/ts-service.js';
import { indexProject } from '../lsp/indexer.js';
import { CABINET_DIR, DocumentChunkRepository, EvaluationResultRepository } from '@cabinet/storage';
import {
  readFile,
  writeFile,
  readdir,
  mkdir,
  stat,
  unlink,
  rmdir,
  rename,
  copyFile as fsCopyFile,
  realpath,
} from 'node:fs/promises';
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  watchFile,
  unwatchFile,
  readFileSync,
  statSync,
} from 'node:fs';
import { join, relative, dirname, basename, extname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import {
  execAsync,
  ROLES_NEEDING_ENV,
  buildSystemPrompt,
  readTextFile,
  MIME_MAP,
  TEXT_EXTENSIONS,
  isTextFile,
  resolveSafePath,
  buildSafeEnv,
} from './secretary/utils.js';
import { buildToolDependencies } from './secretary/tool-dependencies.js';
import {
  activeSubAgents,
  sessionTrustLevel,
  detectTrustLevelOverride,
  resolveModel,
  getAgentLoopForRole,
  createReviewerLoop,
  dispatchToExternalAgent,
  dispatchToSpecialist,
  dispatchToSpecialistStreaming,
  persistReviewResult,
  getOrCreateAgent,
  feedbackStore,
} from './secretary/agents.js';
import { registerChatRoute } from './secretary/chat.js';

export const secretaryRouter = new Hono();
registerChatRoute(secretaryRouter);

secretaryRouter.get('/verify', async (c) => {
  const { gateway, costTracker, metrics } = getServerContext();
  if (!gateway) {
    return c.json({
      status: 'no_api_key',
      message: 'Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env to enable LLM.',
    });
  }
  try {
    const start = Date.now();
    const testModel = resolveModel({ modelTier: 'default' });
    const response = await gateway.generateText({
      model: testModel,
      messages: [{ role: 'user', content: 'Reply with just "OK".' }],
      maxTokens: 10,
    });
    costTracker.record(
      response.model ?? testModel,
      response.usage?.promptTokens ?? 0,
      response.usage?.completionTokens ?? 0,
    );
    metrics.increment('llm_call', { model: response.model ?? testModel, purpose: 'verify' });
    const latency = Date.now() - start;
    return c.json({
      status: 'ok',
      latency_ms: latency,
      model: response.model,
      tokens: response.usage,
    });
  } catch (error) {
    return c.json(
      {
        status: 'error',
        message: (error as Error).message,
        hint: 'Check your API key and network connection.',
      },
      503,
    );
  }
});

// ── GET /sessions ──
secretaryRouter.get('/sessions', (c) => {
  const { sessionManager } = getServerContext();
  const sessions = sessionManager.list();
  return c.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      title: s.title,
      projectId: s.projectId,
      messageCount: s.messages.length,
      updatedAt: s.updatedAt,
    })),
  });
});

// ── POST /sessions/:id/close ──
secretaryRouter.post('/sessions/:id/close', (c) => {
  const sessionId = c.req.param('id');
  const ctx = getServerContext();
  const session = ctx.sessionManager.get(sessionId);
  if (!session) return c.json({ closed: false, reason: 'Session not found' }, 404);
  ctx.sessionManager.close(sessionId);
  return c.json({ closed: true, id: sessionId });
});

// ── GET /context ──
secretaryRouter.get('/context', (c) => {
  const { sessionManager, metrics } = getServerContext();
  const sessionId = c.req.query('sessionId') ?? 'default';
  const session = sessionManager.get(sessionId);

  const messageCount = session?.messages.length ?? 0;
  // Rough estimate: ~4 chars per token
  const totalChars = session?.messages.reduce((sum, m) => sum + m.content.length, 0) ?? 0;
  const estimatedTokens = Math.ceil(totalChars / 4);

  // Use actual model context window (claude-sonnet-4-6 = 200k, but report accurately)
  const maxContextTokens = 200000;

  return c.json({
    sessionId,
    messageCount,
    estimatedTokens,
    maxContextTokens,
    summary: metrics.getSummary(),
  });
});

// ── POST /compact ──
secretaryRouter.post('/compact', async (c) => {
  const ctx = getServerContext();
  const body = await c.req.json().catch(() => ({}));
  const sessionId = body.sessionId ?? 'default';

  const session = ctx.sessionManager.get(sessionId);
  if (!session) return c.json({ compacted: false, reason: 'Session not found' }, 404);

  const messages = session.messages;
  if (messages.length <= 4) return c.json({ compacted: true, messageCount: messages.length });

  // Keep last 4 messages intact, summarize older ones
  const keepCount = 4;
  const toSummarize = messages.slice(0, messages.length - keepCount);
  const recent = messages.slice(messages.length - keepCount);

  // Build a summary from old messages
  const summaryParts: string[] = [];
  let lastRole = '';
  for (const m of toSummarize) {
    if (m.role !== lastRole) {
      summaryParts.push(
        `${m.role === 'user' ? 'User asked' : 'Assistant responded'} about: ${m.content.slice(0, 200)}`,
      );
      lastRole = m.role;
    }
  }

  const summary = `[Context summary: ${toSummarize.length} earlier messages compressed. Key topics: ${summaryParts.slice(0, 5).join('; ')}]`;

  // Replace old messages with summary + recent
  session.messages.length = 0;
  session.messages.push({ role: 'user', content: summary, timestamp: new Date() });
  for (const m of recent) {
    session.messages.push(m);
  }

  return c.json({
    compacted: true,
    previousCount: messages.length,
    newCount: session.messages.length,
    estimatedTokens: Math.ceil(session.messages.reduce((sum, m) => sum + m.content.length, 0) / 4),
  });
});

// ── GET /greeting ──
secretaryRouter.get('/greeting', (c) => {
  const { decisionRepo, workflowRepo, costTracker } = getServerContext();
  const greeter = new GreetingService();

  const pendingDecisions = decisionRepo.countByStatus('pending');
  const activeWorkflows = workflowRepo.countByStatus(['running', 'awaiting_approval']);
  const todayCost = costTracker.getDailyCost();

  const result = greeter.generate({
    captainName: 'Captain',
    pendingDecisions,
    activeWorkflows,
    todayCost,
  });

  return c.json(result);
});

// ── Sub-agent interaction endpoints ──

/** POST /subagent/input — send mid-flight user input to a running sub-agent */
secretaryRouter.post('/subagent/input', async (c) => {
  const ctx = getServerContext();
  const body = await c.req.json().catch(() => ({}));
  const { subAgentSessionId, input } = body;

  if (!subAgentSessionId || typeof input !== 'string') {
    return c.json({ error: 'Missing subAgentSessionId or input' }, 400);
  }

  const entry = activeSubAgents.get(subAgentSessionId);
  if (!entry) {
    return c.json({ error: 'Sub-agent session not found or already finalized' }, 404);
  }

  // Publish user input received event
  ctx.agentEventBus.publish(subAgentSessionId, entry.parentSessionId, {
    type: 'user_input_received',
    content: input,
    timestamp: Date.now(),
  });

  // Interactive sub-agent path
  if (entry.interactive) {
    const forwardHandler = (event: import('@cabinet/events').AgentEvent) => {
      ctx.agentEventBus.publish(subAgentSessionId, entry.parentSessionId, event);
    };
    entry.interactive.onEvent.on('event', forwardHandler);

    try {
      await entry.interactive.onUserInput(input);
    } catch (e: any) {
      entry.interactive.onEvent.off('event', forwardHandler);
      ctx.agentEventBus.publish(subAgentSessionId, entry.parentSessionId, {
        type: 'error',
        message: e.message ?? 'Unknown error',
        timestamp: Date.now(),
      });
      return c.json({ error: e.message ?? 'Unknown error' }, 500);
    }

    entry.interactive.onEvent.off('event', forwardHandler);
    entry.status = entry.interactive.getStatus();
    return c.json({ success: true, status: entry.status });
  }

  try {
    // Build a minimal streaming callback that forwards events to the event bus
    const wrappedCallback: import('@cabinet/agent').StreamingCallback = {
      onChunk(content) {
        ctx.agentEventBus.publish(subAgentSessionId, entry.parentSessionId, {
          type: 'stream_chunk',
          content,
          timestamp: Date.now(),
        });
      },
      onThinking(content) {
        ctx.agentEventBus.publish(subAgentSessionId, entry.parentSessionId, {
          type: 'thinking',
          content,
          timestamp: Date.now(),
        });
      },
      onToolCall(name, args) {
        ctx.agentEventBus.publish(subAgentSessionId, entry.parentSessionId, {
          type: 'tool_call',
          name,
          args,
          timestamp: Date.now(),
        });
      },
      onToolResult(name, result) {
        ctx.agentEventBus.publish(subAgentSessionId, entry.parentSessionId, {
          type: 'tool_result',
          name,
          result,
          timestamp: Date.now(),
        });
      },
      onDone(fullContent) {
        ctx.agentEventBus.publish(subAgentSessionId, entry.parentSessionId, {
          type: 'output',
          content: fullContent,
          timestamp: Date.now(),
        });
      },
      onError(error) {
        ctx.agentEventBus.publish(subAgentSessionId, entry.parentSessionId, {
          type: 'error',
          message: error,
          timestamp: Date.now(),
        });
      },
    };

    const result = await entry.loop.continueWithUserInput(input, wrappedCallback);
    ctx.sessionManager.setDeliverable(subAgentSessionId, {
      agentType: entry.roleType,
      content: result.content,
      toolCalls: result.toolCalls,
    });

    return c.json({ success: true, content: result.content });
  } catch (e: any) {
    ctx.agentEventBus.publish(subAgentSessionId, entry.parentSessionId, {
      type: 'error',
      message: e.message ?? 'Unknown error',
      timestamp: Date.now(),
    });
    return c.json({ error: e.message ?? 'Unknown error' }, 500);
  }
});

/** POST /subagent/finalize — confirm sub-agent completion and return deliverable */
secretaryRouter.post('/subagent/finalize', async (c) => {
  const ctx = getServerContext();
  const body = await c.req.json().catch(() => ({}));
  const { subAgentSessionId } = body;

  if (!subAgentSessionId) {
    return c.json({ error: 'Missing subAgentSessionId' }, 400);
  }

  const entry = activeSubAgents.get(subAgentSessionId);
  const session = ctx.sessionManager.get(subAgentSessionId);

  if (!session) {
    return c.json({ error: 'Sub-agent session not found' }, 404);
  }

  // Interactive sub-agent path
  if (entry?.interactive) {
    const deliverable = await entry.interactive.finalize();
    ctx.sessionManager.setDeliverable(subAgentSessionId, deliverable);
    ctx.sessionManager.updateStatus(subAgentSessionId, 'completed');
    activeSubAgents.delete(subAgentSessionId);
    ctx.agentEventBus.publish(subAgentSessionId, session.parentId ?? undefined, {
      type: 'completed',
      deliverable,
      timestamp: Date.now(),
    });
    return c.json({ success: true, deliverable });
  }

  ctx.sessionManager.updateStatus(subAgentSessionId, 'completed');

  // Publish completion event
  ctx.agentEventBus.publish(subAgentSessionId, session.parentId ?? undefined, {
    type: 'completed',
    deliverable: session.deliverable,
    timestamp: Date.now(),
  });

  // Clean up active map
  if (entry) {
    activeSubAgents.delete(subAgentSessionId);
  }

  return c.json({ success: true, deliverable: session.deliverable });
});

/** GET /sessions/:id/children — list child sub-agent sessions */
secretaryRouter.get('/sessions/:id/children', (c) => {
  const ctx = getServerContext();
  const parentId = c.req.param('id');
  const children = ctx.sessionManager.getChildSessions(parentId);
  return c.json({
    sessions: children.map((s) => ({
      id: s.id,
      agentType: s.agentType,
      status: s.status,
      title: s.title,
      createdAt: s.createdAt,
      deliverable: s.deliverable,
      messages: [],
      attachedFiles: [],
    })),
  });
});

/** GET /subagent/:id/status — get current status of a running sub-agent */
secretaryRouter.get('/subagent/:id/status', (c) => {
  const id = c.req.param('id');
  const entry = activeSubAgents.get(id);
  if (!entry) return c.json({ error: 'Not found' }, 404);
  const status = entry.interactive ? entry.interactive.getStatus() : entry.status;
  return c.json({ status });
});
