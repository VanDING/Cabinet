import { Hono } from 'hono';
import { getServerContext } from '../../context.js';
import { Scanner, RECIPES } from '@cabinet/agent';
import type { McpServerRow } from '@cabinet/storage';
import { decryptApiKey } from '../../crypto.js';
import { MASTER_PW } from '../settings/persistence.js';

export const workbenchAgentsRouter = new Hono();

workbenchAgentsRouter.get('/', (c) => {
  const { agentRoleRepo } = getServerContext();
  const rows = agentRoleRepo.findCustom().filter((r) => r.type === 'external_cli');
  const byName = new Map(rows.map((r) => [r.name, r]));
  return c.json({
    agents: RECIPES.map((r) => ({
      id: `external_cli:${r.command}`,
      recipe: r,
      installed: byName.has(`external_cli:${r.command}`),
      version: byName.get(`external_cli:${r.command}`)?.model ?? undefined,
    })),
  });
});

workbenchAgentsRouter.post('/scan', async (c) => {
  try {
    const { agentRegistry, agentRoleRepo } = getServerContext();
    const scanner = new Scanner(agentRegistry, agentRoleRepo);
    const results = await scanner.scanAll();
    return c.json({ results });
  } catch (err) {
    const logger = getServerContext().logger;
    logger?.error('Scan failed', { error: String(err) });
    return c.json({ error: 'Scan failed', detail: String(err) }, 500);
  }
});

workbenchAgentsRouter.post('/scan/:recipeId', async (c) => {
  const recipeId = c.req.param('recipeId');
  const recipe = RECIPES.find((r) => r.id === recipeId);
  if (!recipe) return c.json({ error: 'Unknown recipe' }, 404);
  const { agentRegistry, agentRoleRepo } = getServerContext();
  const scanner = new Scanner(agentRegistry, agentRoleRepo);
  const result = await scanner.scanOne(recipe);
  return c.json({ result });
});

workbenchAgentsRouter.get('/:agentId', (c) => {
  const agentId = c.req.param('agentId');
  const { agentRoleRepo, agentBindingRepo } = getServerContext();
  const row = agentRoleRepo.findByName(agentId);
  if (!row) return c.json({ error: 'Not found' }, 404);
  const external = row.external_config ? JSON.parse(row.external_config) : null;
  const mcpBindings = agentBindingRepo.getMcpBindingsForAgent(agentId);
  const skillBindings = agentBindingRepo.getSkillBindingsForAgent(agentId);
  return c.json({ agent: { ...row, external, mcpBindings, skillBindings } });
});

workbenchAgentsRouter.get('/:agentId/env', (c) => {
  const agentId = c.req.param('agentId');
  const { agentRoleRepo, apiKeyRepo, agentBindingRepo, mcpServerRepo } = getServerContext();
  const row = agentRoleRepo.findByName(agentId);
  if (!row) return c.json({ error: 'Not found' }, 404);
  const external = row.external_config ? JSON.parse(row.external_config) : null;
  const env: Record<string, string> = {};
  const boundMcp = agentBindingRepo.getMcpBindingsForAgent(agentId).filter((b) => b.enabled);
  for (const mcpServer of mcpServerRepo
    .findAll()
    .filter((s) => s.enabled && boundMcp.some((b) => b.mcp_server_name === s.name))) {
    env[`MCP_CONFIG_${mcpServer.name.toUpperCase()}`] = mcpServer.command ?? '';
  }
  for (const key of apiKeyRepo.findAll()) {
    const upper = key.provider.toUpperCase();
    try {
      env[`${upper}_API_KEY`] = decryptApiKey(key.encrypted_key, MASTER_PW);
    } catch {
      env[`${upper}_API_KEY`] = key.encrypted_key;
    }
  }
  return c.json({ env });
});

workbenchAgentsRouter.post('/:agentId/project', async (c) => {
  return c.json({ status: 'skipped', message: 'Projection not available in Mastra mode' });
});

workbenchAgentsRouter.delete('/:agentId', (c) => {
  const agentId = c.req.param('agentId');
  const { agentRoleRepo, agentRegistry } = getServerContext();
  agentRegistry.unregister(agentId);
  agentRoleRepo.deleteByName(agentId);
  return c.json({ status: 'deleted' });
});

function rowToMcpEntry(row: McpServerRow): {
  name: string;
  transport: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  url?: string;
} {
  return {
    name: row.name,
    transport: (row.transport_type as 'stdio' | 'sse' | 'http') ?? 'stdio',
    command: row.command ?? undefined,
    args: row.args ? JSON.parse(row.args) : undefined,
    url: row.url ?? undefined,
  };
}

function rowToSkillEntry(row: { name: string }): { name: string; path: string } {
  return { name: row.name, path: '' };
}
