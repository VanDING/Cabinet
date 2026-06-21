import { Hono } from 'hono';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { getServerContext } from '../context.js';
import { broadcast } from '../ws/handler.js';
import { CABINET_DIR } from '@cabinet/storage';

const AGENTS_DIR = join(CABINET_DIR, 'agents');

export const agentsRouter = new Hono();

// Parse wshobson-format .md agent metadata
function parseAgentMarkdown(content: string): Record<string, unknown> | null {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;
  const frontmatter: Record<string, unknown> = {};
  for (const line of fmMatch[1]!.split('\n')) {
    const kv = line.match(/^(\w[\w\s]*?):\s*(.+)$/);
    if (!kv) continue;
    const key = kv[1]!.trim().toLowerCase().replace(/\s+/g, '');
    const val = kv[2]!.trim().replace(/^['"]|['"]$/g, '');
    frontmatter[key] = val;
  }
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '');
  frontmatter.systemPrompt = frontmatter.systemprompt ?? body.trim();
  return frontmatter;
}

function buildAgentJson(md: Record<string, unknown>, name: string): Record<string, unknown> {
  return {
    name: md.name ?? name,
    description: md.description ?? '',
    systemPrompt: md.systemPrompt ?? md.systemprompt ?? md.instructions ?? '',
    modelTier: (md.modelTier as string) || 'default',
    temperature: parseFloat(String(md.temperature ?? '0.7')),
    maxResponseTokens: parseInt(String(md.maxresponsetokens ?? md.maxtokens ?? '4096'), 10),
    allowedTools: Array.isArray(md.allowedtools) ? md.allowedtools : [],
    contextBudget: parseInt(String(md.contextbudget ?? md.contextwindow ?? '100000'), 10),
    capabilities: md.capabilities ?? {},
  };
}

// GET /.well-known/agent-card.json — A2A Agent Discovery
agentsRouter.get('/agent-card.json', (c) => {
  const { agentRegistry, skillRegistry } = getServerContext();
  const agents = agentRegistry.list();

  const skills: { id: string; name: string; description: string; tags: string[] }[] = agents.map(
    (a) => ({
      id: a.type,
      name: a.name,
      description: a.description,
      tags: [a.type, a.modelTier],
    }),
  );

  const registeredSkills = skillRegistry.discover();
  for (const s of registeredSkills) {
    skills.push({
      id: s.name,
      name: s.name,
      description: s.description,
      tags: [s.kind, `v${s.version}`],
    });
  }

  return c.json({
    name: 'Cabinet',
    description:
      'AI collaboration framework with multi-agent deliberation, decision management, and workflow execution',
    version: '2.0.0',
    capabilities: { streaming: true },
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['text/plain', 'application/json'],
    skills,
  });
});

// GET /api/agents — list all registered agents (built-in + custom)
agentsRouter.get('/', (c) => {
  const { agentRegistry } = getServerContext();
  const agents = agentRegistry.list().map((a) => ({
    type: a.type,
    name: a.name,
    description: a.description,
    modelTier: a.modelTier,
    tools: a.allowedTools,
    builtIn: a.type !== 'custom',
  }));
  return c.json({ agents, directory: AGENTS_DIR });
});

// ── POST /api/agents/import — import agent from .md or .json ──
agentsRouter.post('/import', async (c) => {
  const { agentRegistry, agentRoleRepo, logger } = getServerContext();
  const body = await c.req.json();
  const content = body.content as string;
  const format = (body.format as string) ?? 'md';

  if (!content) return c.json({ error: 'content is required' }, 400);

  if (format === 'json') {
    // A2A JSON format — write agent.json directly
    let agentCard: Record<string, unknown>;
    try {
      agentCard = JSON.parse(content);
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400);
    }
    const name = String(agentCard.name ?? `agent_${Date.now()}`);
    const dir = join(AGENTS_DIR, name);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'agent.json'), JSON.stringify(agentCard, null, 2), 'utf-8');

    // Register
    agentRegistry.register({
      type: 'custom' as const,
      name,
      description: String(agentCard.description ?? ''),
      modules: { identity: String(agentCard.systemPrompt ?? agentCard.instructions ?? '') },
      modelTier: ((agentCard.modelTier as string) || 'default') as any,
      temperature: parseFloat(String(agentCard.temperature ?? 0.7)),
      maxResponseTokens: parseInt(
        String(agentCard.maxResponseTokens ?? agentCard.maxTokens ?? 4096),
        10,
      ),
      allowedTools: (Array.isArray(agentCard.allowedTools)
        ? agentCard.allowedTools
        : []) as string[],
      contextBudget: parseInt(
        String(agentCard.contextBudget ?? agentCard.contextWindow ?? 100000),
        10,
      ),
    });
    agentRoleRepo.upsert({
      type: name,
      name,
      description: String(agentCard.description ?? ''),
      system_prompt: String(agentCard.systemPrompt ?? agentCard.instructions ?? ''),
      temperature: parseFloat(String(agentCard.temperature ?? 0.7)),
      max_response_tokens: parseInt(
        String(agentCard.maxResponseTokens ?? agentCard.maxTokens ?? 4096),
        10,
      ),
      allowed_tools: JSON.stringify(agentCard.allowedTools ?? []),
      context_budget: parseInt(
        String(agentCard.contextBudget ?? agentCard.contextWindow ?? 100000),
        10,
      ),
      is_builtin: 0,
      created_at: new Date().toISOString(),
    });

    broadcast('agent_created', { name });
    logger.info('Agent imported from JSON', { name });
    return c.json({ name, status: 'imported', path: join(dir, 'agent.json') }, 201);
  }

  // .md format — parse frontmatter, generate agent.json, keep agent.md
  const parsed = parseAgentMarkdown(content);
  if (!parsed) return c.json({ error: 'Invalid .md format — expected YAML frontmatter' }, 400);

  const name = String(parsed.name ?? `agent_${Date.now()}`);
  const dir = join(AGENTS_DIR, name);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // Write agent.md (original file preserved for user reference)
  writeFileSync(join(dir, 'agent.md'), content, 'utf-8');

  // Generate and write agent.json
  const agentJson = buildAgentJson(parsed, name);
  writeFileSync(join(dir, 'agent.json'), JSON.stringify(agentJson, null, 2), 'utf-8');

  // Register
  agentRegistry.register({
    type: 'custom' as const,
    name,
    description: String(agentJson.description),
    modules: { identity: String(agentJson.systemPrompt) },
    modelTier: ((agentJson.modelTier as string) || 'default') as any,
    temperature: agentJson.temperature as number,
    maxResponseTokens: agentJson.maxResponseTokens as number,
    allowedTools: agentJson.allowedTools as string[],
    contextBudget: agentJson.contextBudget as number,
  });
  agentRoleRepo.upsert({
    type: name,
    name,
    description: String(agentJson.description),
    system_prompt: String(agentJson.systemPrompt),
    temperature: agentJson.temperature as number,
    max_response_tokens: agentJson.maxResponseTokens as number,
    allowed_tools: JSON.stringify(agentJson.allowedTools),
    context_budget: agentJson.contextBudget as number,
    is_builtin: 0,
    created_at: new Date().toISOString(),
  });

  broadcast('agent_created', { name });
  logger.info('Agent imported from .md', { name });
  return c.json(
    { name, status: 'imported', path: join(dir, 'agent.json'), mdPath: join(dir, 'agent.md') },
    201,
  );
});

// ── DELETE /api/agents/:type — unregister custom agent + remove directory ──
agentsRouter.delete('/:type', (c) => {
  const { agentRegistry, agentRoleRepo, logger } = getServerContext();
  const type = c.req.param('type');

  const agent = agentRegistry.get(type);
  if (!agent || agent.type !== 'custom') {
    return c.json({ error: 'Custom agent not found' }, 404);
  }

  agentRegistry.unregister(type);
  agentRoleRepo.deleteByType(type);

  // Remove agent directory
  const agentDir = join(AGENTS_DIR, agent.name);
  try {
    rmSync(agentDir, { recursive: true, force: true });
  } catch {
    /* ok */
  }

  broadcast('agent_deleted', { name: agent.name });
  logger.info('Custom agent deleted', { type, name: agent.name });
  return c.json({ status: 'deleted', type });
});

// ── A2A Protocol Endpoints ──

agentsRouter.post('/discover', async (c) => {
  const body = await c.req.json();
  const url = body.url as string;
  if (!url) return c.json({ error: 'url is required' }, 400);
  const { a2aClient } = getServerContext();
  const card = await a2aClient.discoverAgent(url);
  if (!card) return c.json({ error: 'Agent discovery failed' }, 502);
  return c.json({ discovered: true, agentCard: card });
});

// ── A2A Inbound Task Routing ──
const a2aTasks = new Map<
  string,
  {
    status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
    output?: unknown;
    message?: string;
    tokens_used?: number;
    model?: string;
    timestamp: string;
  }
>();

agentsRouter.post('/message', async (c) => {
  const { logger, agentRegistry } = getServerContext();
  const body = await c.req.json().catch(() => ({}));
  const task = body as {
    task_id?: string;
    session_id?: string;
    capability?: string;
    input?: unknown;
  };

  if (!task.task_id || !task.input) {
    return c.json({ error: 'task_id and input are required' }, 400);
  }

  const taskId = task.task_id;
  const capability = task.capability ?? 'default';

  const agents = agentRegistry.list();
  const target =
    agents.find((a) => a.type === 'custom') ??
    agents.find((a) => a.type === 'secretary' || a.type === 'curator' || a.type === 'organize');

  if (!target) {
    a2aTasks.set(taskId, {
      status: 'failed',
      message: 'No available agent',
      timestamp: new Date().toISOString(),
    });
    return c.json({ task_id: taskId, status: 'rejected', error: 'No available agent' }, 503);
  }

  logger.info('A2A inbound task', { taskId, capability, targetAgent: target.name });
  a2aTasks.set(taskId, { status: 'in_progress', timestamp: new Date().toISOString() });

  try {
    const { dispatchToSpecialist } = await import('./secretary/agents.js');
    const output = await dispatchToSpecialist(
      target.type,
      typeof task.input === 'string' ? task.input : JSON.stringify(task.input),
      task.session_id ?? `a2a_${taskId}`,
      'default',
      'system',
    );
    a2aTasks.set(taskId, { status: 'completed', output, timestamp: new Date().toISOString() });
    return c.json({ task_id: taskId, status: 'accepted' });
  } catch (err) {
    a2aTasks.set(taskId, {
      status: 'failed',
      message: String(err),
      timestamp: new Date().toISOString(),
    });
    return c.json({ task_id: taskId, status: 'rejected', error: String(err) }, 500);
  }
});

agentsRouter.post('/message/stream', async (c) => {
  const { logger, agentRegistry } = getServerContext();
  const body = await c.req.json().catch(() => ({}));
  const task = body as { task_id?: string; input?: unknown; session_id?: string };

  if (!task.task_id) {
    return c.json({ error: 'task_id is required' }, 400);
  }

  const taskId = task.task_id;
  const input = typeof task.input === 'string' ? task.input : JSON.stringify(task.input ?? '');

  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      try {
        const agents = agentRegistry.list();
        const target =
          agents.find((a) => a.type === 'custom') ??
          agents.find(
            (a) => a.type === 'secretary' || a.type === 'curator' || a.type === 'organize',
          );

        if (!target) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: 'No available agent' })}\n\n`),
          );
          controller.close();
          return;
        }

        const { dispatchToSpecialistStreaming } = await import('./secretary/agents.js');

        await dispatchToSpecialistStreaming(
          target.type,
          input,
          task.session_id ?? `a2a_${taskId}`,
          'default',
          'system',
          {
            onChunk: (content: string) => {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'chunk', content })}\n\n`),
              );
            },
            onThinking: (content: string) => {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'thinking', content })}\n\n`),
              );
            },
            onDone: (content: string) => {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'done', content })}\n\n`),
              );
              controller.close();
            },
            onError: (error: string) => {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'error', error })}\n\n`),
              );
              controller.close();
            },
            onToolCall: (_name: string, _args: Record<string, unknown>) => {},
            onToolResult: (_name: string, _result: unknown) => {},
          },
        );
      } catch (err) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'error', error: String(err) })}\n\n`),
        );
        controller.close();
      }
    },
  });

  return c.newResponse(stream);
});

agentsRouter.get('/tasks/:taskId', (c) => {
  const taskId = c.req.param('taskId');
  const task = a2aTasks.get(taskId);
  if (!task) return c.json({ error: 'Task not found' }, 404);
  return c.json({ task_id: taskId, ...task });
});

// ── POST /api/agents/scan ──────────────────────────────────────

agentsRouter.post('/scan', async (c) => {
  const { Scanner, RECIPES } = await import('@cabinet/agent');
  const { agentRegistry, agentRoleRepo } = getServerContext();
  const scanner = new Scanner(agentRegistry, agentRoleRepo);
  return c.json({ results: await scanner.scanAll() });
});
