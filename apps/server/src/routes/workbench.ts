import { Hono } from 'hono';
import { getServerContext } from '../context.js';

export const workbenchRouter = new Hono();

workbenchRouter.get('/bindings/:agentType', (c) => {
  const agentType = c.req.param('agentType');
  const ctx = getServerContext();
  const repo = (ctx as any).agentBindingRepo;
  if (!repo) return c.json({ error: 'Binding repo not available' }, 500);

  const mcpBindings = repo.getMcpBindingsForAgent(agentType);
  const skillBindings = repo.getSkillBindingsForAgent(agentType);

  return c.json({
    agentType,
    mcpBindings: mcpBindings.map((b: any) => ({
      id: b.id,
      serverName: b.mcp_server_name,
      enabled: b.enabled === 1,
    })),
    skillBindings: skillBindings.map((b: any) => ({
      id: b.id,
      skillName: b.skill_name,
      enabled: b.enabled === 1,
    })),
  });
});

workbenchRouter.put('/bindings/:agentType/mcp', async (c) => {
  const agentType = c.req.param('agentType');
  const body = await c.req.json();
  const { serverName, enabled } = body as { serverName: string; enabled: boolean };
  const ctx = getServerContext();
  const repo = (ctx as any).agentBindingRepo;
  if (!repo) return c.json({ error: 'Binding repo not available' }, 500);

  repo.upsertMcpBinding(agentType, serverName, enabled);
  return c.json({ status: 'updated', agentType, serverName, enabled });
});

workbenchRouter.delete('/bindings/:agentType/mcp/:serverName', (c) => {
  const agentType = c.req.param('agentType');
  const serverName = c.req.param('serverName');
  const ctx = getServerContext();
  const repo = (ctx as any).agentBindingRepo;
  if (!repo) return c.json({ error: 'Binding repo not available' }, 500);

  repo.deleteMcpBinding(agentType, serverName);
  return c.json({ status: 'deleted' });
});

workbenchRouter.put('/bindings/:agentType/skill', async (c) => {
  const agentType = c.req.param('agentType');
  const body = await c.req.json();
  const { skillName, enabled } = body as { skillName: string; enabled: boolean };
  const ctx = getServerContext();
  const repo = (ctx as any).agentBindingRepo;
  if (!repo) return c.json({ error: 'Binding repo not available' }, 500);

  repo.upsertSkillBinding(agentType, skillName, enabled);
  return c.json({ status: 'updated', agentType, skillName, enabled });
});

workbenchRouter.delete('/bindings/:agentType/skill/:skillName', (c) => {
  const agentType = c.req.param('agentType');
  const skillName = c.req.param('skillName');
  const ctx = getServerContext();
  const repo = (ctx as any).agentBindingRepo;
  if (!repo) return c.json({ error: 'Binding repo not available' }, 500);

  repo.deleteSkillBinding(agentType, skillName);
  return c.json({ status: 'deleted' });
});

workbenchRouter.get('/bindings', (c) => {
  const ctx = getServerContext();
  const repo = (ctx as any).agentBindingRepo;
  if (!repo) return c.json({ error: 'Binding repo not available' }, 500);

  const allMcp = repo.getAllMcpBindings();
  const allSkills = repo.getAllSkillBindings();

  return c.json({
    mcpBindings: allMcp.map((b: any) => ({
      id: b.id,
      agentType: b.agent_type,
      serverName: b.mcp_server_name,
      enabled: b.enabled === 1,
    })),
    skillBindings: allSkills.map((b: any) => ({
      id: b.id,
      agentType: b.agent_type,
      skillName: b.skill_name,
      enabled: b.enabled === 1,
    })),
  });
});
