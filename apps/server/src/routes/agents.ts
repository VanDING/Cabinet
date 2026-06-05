import { Hono } from 'hono';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { getServerContext } from '../context.js';
import { broadcast } from '../ws/handler.js';
import { A2AClient } from '../a2a/a2a-client.js';
import { CABINET_DIR } from '@cabinet/storage';

const AGENTS_DIR = join(CABINET_DIR, 'agents');

export const agentsRouter = new Hono();

// Shared A2A client instance
let a2aClient: A2AClient | null = null;
function getA2AClient(): A2AClient {
  if (!a2aClient) {
    const { logger } = getServerContext();
    a2aClient = new A2AClient(logger);
  }
  return a2aClient;
}

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
  const client = getA2AClient();
  const card = await client.discoverAgent(url);
  if (!card) return c.json({ error: 'Agent discovery failed' }, 502);
  return c.json({ discovered: true, agentCard: card });
});

agentsRouter.post('/message', async (c) => {
  const { agentRegistry } = getServerContext();
  const body = await c.req.json();
  const message = body.message as { role: string; content: string };
  if (!message?.content) return c.json({ error: 'message.content is required' }, 400);

  return c.json({
    response: `Cabinet received: ${message.content.slice(0, 200)}`,
    agentCount: agentRegistry.list().length,
  });
});

agentsRouter.post('/message/stream', async (c) => {
  const body = await c.req.json();
  const message = body.message as { role: string; content: string };
  if (!message?.content) return c.json({ error: 'message.content is required' }, 400);

  const sseStream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: 'chunk', content: `Processing: ${message.content.slice(0, 100)}...` })}\n\n`,
        ),
      );
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
      controller.close();
    },
  });

  return new Response(sseStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
});

// ── POST /api/agents/scan ──────────────────────────────────────

const CLI_DETECT_LIST = [
  { name: 'Claude Code',   command: 'claude',   detectCmd: 'which claude',   installCmd: 'npm install -g @anthropic-ai/claude-code' },
  { name: 'Codex',         command: 'codex',    detectCmd: 'which codex',    installCmd: 'npm install -g @openai/codex' },
  { name: 'OpenCode',      command: 'opencode', detectCmd: 'which opencode', installCmd: 'npm install -g opencode' },
  { name: 'Qwen Code',     command: 'qwen-code', detectCmd: 'which qwen-code', installCmd: 'npm install -g @qwen-code/qwen-code' },
  { name: 'DeepSeek TUI',  command: 'deepseek-tui', detectCmd: 'which deepseek-tui', installCmd: 'npm install -g deepseek-tui' },
  { name: 'Cursor',        command: 'cursor',   detectCmd: 'which cursor',   installCmd: null },
];

agentsRouter.post('/scan', async (c) => {
  const { spawn } = await import('node:child_process');
  const { agentRegistry, logger } = getServerContext();
  const registered = new Set(agentRegistry.list().map((r) => r.name));
  const discovered: Array<{ name: string; command: string; installed: boolean; version?: string; registered: boolean }> = [];

  const isWindows = process.platform === 'win32';
  logger.info('[scan] platform', { platform: process.platform, shell: isWindows ? 'cmd' : 'sh', path: process.env.PATH?.slice(0, 500) });

  for (const entry of CLI_DETECT_LIST) {
    let installed = false;
    let version: string | undefined;

    // Phase 1: try --version directly (most reliable cross-platform check)
    try {
      const vProc = spawn(entry.command, ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000,
        shell: isWindows,
      });
      let stdout = '';
      let stderr = '';
      vProc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      vProc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      const vOut = await new Promise<string>((resolve, reject) => {
        vProc.on('close', (code) => {
          logger.info('[scan] version attempt', { command: entry.command, code, stdout: stdout.trim().slice(0, 200), stderr: stderr.trim().slice(0, 200) });
          if (code === 0 && stdout.trim().length > 0) resolve(stdout.trim());
          else reject(new Error(`exit ${code} or empty output`));
        });
        vProc.on('error', (err) => {
          logger.info('[scan] version error', { command: entry.command, error: err.message });
          reject(err);
        });
      });
      installed = true;
      version = vOut;
    } catch {
      // Phase 2: fall back to which/where for commands that may not support --version
      try {
        const shellCmd = isWindows ? `where ${entry.command}` : `which ${entry.command}`;
        const proc = spawn(shellCmd, [], {
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 3000,
          shell: isWindows,
        });
        let stdout2 = '';
        let stderr2 = '';
        proc.stdout?.on('data', (chunk: Buffer) => { stdout2 += chunk.toString(); });
        proc.stderr?.on('data', (chunk: Buffer) => { stderr2 += chunk.toString(); });
        await new Promise<string>((resolve, reject) => {
          proc.on('close', (code) => {
            logger.info('[scan] locate attempt', { command: entry.command, code, stdout: stdout2.trim().slice(0, 200), stderr: stderr2.trim().slice(0, 200) });
            if (code === 0) resolve(stdout2.trim()); else reject(new Error(`exit ${code}`));
          });
          proc.on('error', (err) => {
            logger.info('[scan] locate error', { command: entry.command, error: err.message });
            reject(err);
          });
        });
        installed = true;
      } catch {
        installed = false;
      }
    }

    discovered.push({
      name: entry.name,
      command: entry.command,
      installed,
      version,
      registered: registered.has(entry.name) || registered.has(entry.command),
    });
  }

  return c.json({ discovered });
});
