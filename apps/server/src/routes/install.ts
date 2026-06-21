import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
  getInstallMethods,
  startInstall,
  cancelInstall,
  getInstallTask,
  getAvailableAgents,
  RECIPES,
  Scanner,
  type InstallMethod,
} from '@cabinet/agent';

export const installRouter = new Hono();

installRouter.get('/market', (c) => {
  const available = getAvailableAgents();
  return c.json({
    agents: available.map((a) => {
      const recipe = RECIPES.find((r) => r.id === a.id);
      return {
        id: a.id,
        name: a.name,
        description: recipe?.description ?? '',
        command: recipe?.command ?? '',
        methods: a.methods.map((m) => ({
          type: m.type,
          label: m.label,
          command: m.command,
          checkCommand: m.checkCommand,
          elevated: m.elevated ?? false,
          url: m.url,
        })),
      };
    }),
  });
});

installRouter.get('/definitions', (c) => {
  return c.json({
    definitions: RECIPES.map((r) => ({
      id: r.id,
      name: r.name,
      command: r.command,
      description: r.description,
      nativeConfigPaths: r.nativeConfigPaths,
    })),
  });
});

installRouter.post('/install', (c) => {
  return streamSSE(c, async (stream) => {
    const body = await c.req.json();
    const { agentId, methodIndex } = body as { agentId: string; methodIndex: number };

    const methods = getInstallMethods(agentId);
    if (!methods || methodIndex < 0 || methodIndex >= methods.length) {
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ error: 'Invalid agent or method' }),
      });
      return;
    }

    const method = methods[methodIndex];
    if (!method) {
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ error: 'Method not found' }),
      });
      return;
    }

    const taskId = startInstall(agentId, method, async (progress) => {
      await stream.writeSSE({
        event: progress.stage,
        data: JSON.stringify({
          taskId,
          data: progress.data,
          exitCode: progress.exitCode,
        }),
      });
    });

    // Keep stream open until install finishes
    // The startInstall callback sends progress events
    // We need to wait for completion
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        const task = getInstallTask(taskId);
        if (!task || task.status !== 'running') {
          clearInterval(checkInterval);
          resolve();
        }
      }, 500);
    });
  });
});

installRouter.post('/cancel/:taskId', (c) => {
  const taskId = c.req.param('taskId');
  const success = cancelInstall(taskId);
  return c.json({ success });
});

installRouter.post('/deep-scan', async (c) => {
  const results = await new Scanner(
    (await import('../../context.js')).getServerContext().agentRegistry,
    (await import('../../context.js')).getServerContext().agentRoleRepo,
  ).scanAll();
  return c.json({
    agents: results.map((r) => ({
      id: r.recipe.id,
      name: r.recipe.name,
      command: r.recipe.command,
      installed: r.installed,
      version: r.version,
      config: r.extracted
        ? {
            apiKeys: r.extracted.apiKeys,
            mcpServers: r.extracted.mcpServers,
          }
        : null,
    })),
  });
});
