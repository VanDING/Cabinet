import { Hono } from 'hono';
import { getServerContext } from '../../context.js';
import { Scanner, RECIPES, getProjector } from '@cabinet/agent';
import type { McpServerRow } from '@cabinet/storage';

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
  const { agentRegistry, agentRoleRepo } = getServerContext();
  const scanner = new Scanner(agentRegistry, agentRoleRepo);
  const results = await scanner.scanAll();
  return c.json({ results });
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

workbenchAgentsRouter.post('/:agentId/project', async (c) => {
  const agentId = c.req.param('agentId');
  const { agentRoleRepo, apiKeyRepo, mcpServerRepo, agentBindingRepo, skillRepo } =
    getServerContext();
  const row = agentRoleRepo.findByName(agentId);
  if (!row) return c.json({ error: 'Not found' }, 404);
  const external = row.external_config ? JSON.parse(row.external_config) : null;
  if (!external?.command) return c.json({ error: 'No external config' }, 400);

  const recipe = RECIPES.find(
    (r) => r.id === external.command || `external_cli:${r.command}` === agentId,
  );
  if (!recipe) return c.json({ error: 'No recipe for agent' }, 400);
  const projector = getProjector(recipe.projectorId);
  if (!projector) return c.json({ error: `No projector for ${recipe.projectorId}` }, 400);

  const isDryRun = c.req.query('dryRun') === '1';
  const hasProjectedOnce = (external as Record<string, unknown>).projectedOnce === true;

  if (!isDryRun && !hasProjectedOnce) {
    const forcedDryRun = c.req.query('confirm') !== '1';
    if (forcedDryRun) {
      return c.json({
        status: 'confirm_required',
        message: 'This is the first projection for this agent. A dry-run is recommended.',
      });
    }
  }

  const apiKeys = apiKeyRepo.findAll().map((k) => ({ provider: k.provider, key: k.encrypted_key }));
  const boundMcp = agentBindingRepo.getMcpBindingsForAgent(agentId).filter((b) => b.enabled);
  const mcpServers = mcpServerRepo
    .findAll()
    .filter((s) => s.enabled && boundMcp.some((b) => b.mcp_server_name === s.name));
  const boundSkills = agentBindingRepo.getSkillBindingsForAgent(agentId).filter((b) => b.enabled);
  const skills = skillRepo
    .findAll()
    .filter((s) => boundSkills.some((b) => b.skill_name === s.name));

  await projector.project(
    {
      apiKeys,
      mcpServers: mcpServers.map(rowToMcpEntry),
      skills: skills.map(rowToSkillEntry),
      agentSpecific: {},
    },
    { dryRun: isDryRun },
  );

  if (!isDryRun && !hasProjectedOnce) {
    const updatedExternal = { ...external, projectedOnce: true };
    agentRoleRepo.upsert({ ...row, external_config: JSON.stringify(updatedExternal) });
  }

  return c.json({ status: 'projected', dryRun: isDryRun });
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
