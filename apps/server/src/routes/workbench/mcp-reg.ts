import { Hono } from 'hono';
import { getServerContext } from '../../context.js';

export const mcpRegistryRouter = new Hono();

mcpRegistryRouter.get('/', async (c) => {
  try {
    const res = await fetch('https://api.github.com/repos/mcp/registry/contents/servers.json');
    if (!res.ok) return c.json({ error: 'Registry unavailable' }, 502);
    const data = (await res.json()) as { download_url?: string };
    if (!data.download_url) return c.json({ error: 'Registry format unexpected' }, 502);
    const serversRes = await fetch(data.download_url);
    const servers = await serversRes.json();
    return c.json({ servers });
  } catch {
    return c.json({ error: 'Failed to fetch MCP registry' }, 502);
  }
});

mcpRegistryRouter.post('/install', async (c) => {
  const { mcpServerRepo } = getServerContext();
  const body = (await c.req.json()) as {
    name: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
  };
  mcpServerRepo.upsert({
    name: body.name,
    transport_type: 'stdio',
    command: body.command,
    args: body.args ? JSON.stringify(body.args) : undefined,
    env: body.env ? JSON.stringify(body.env) : undefined,
    source: 'registry',
  });
  return c.json({ status: 'installed' });
});
