import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
  getInstallMethods,
  startInstall,
  cancelInstall,
  getInstallTask,
  getAvailableAgents,
  AGENT_DEFINITIONS,
  scanAllAgents,
  type InstallMethod,
} from '@cabinet/agent';

export const installRouter = new Hono();

installRouter.get('/market', (c) => {
  const available = getAvailableAgents();
  return c.json({
    agents: available.map(({ definition, methods }) => ({
      id: definition.id,
      name: definition.name,
      description: definition.description,
      command: definition.command,
      methods: methods.map((m) => ({
        type: m.type,
        label: m.label,
        command: m.command,
        checkCommand: m.checkCommand,
        elevated: m.elevated ?? false,
        url: m.url,
      })),
    })),
  });
});

installRouter.get('/definitions', (c) => {
  return c.json({
    definitions: AGENT_DEFINITIONS.map((d) => ({
      id: d.id,
      name: d.name,
      command: d.command,
      description: d.description,
      configPaths: d.configPaths,
    })),
  });
});

installRouter.post('/install', (c) => {
  return streamSSE(c, async (stream) => {
    const body = await c.req.json();
    const { agentId, methodIndex } = body as { agentId: string; methodIndex: number };

    const methods = getInstallMethods(agentId);
    if (!methods || methodIndex < 0 || methodIndex >= methods.length) {
      await stream.writeSSE({ event: 'error', data: JSON.stringify({ error: 'Invalid agent or method' }) });
      return;
    }

    const method = methods[methodIndex];
    if (!method) {
      await stream.writeSSE({ event: 'error', data: JSON.stringify({ error: 'Method not found' }) });
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
  const results = await scanAllAgents();
  return c.json({
    agents: results.map((r) => ({
      id: r.definition.id,
      name: r.definition.name,
      command: r.definition.command,
      installed: r.installed,
      version: r.version,
      config: r.config
        ? {
            apiKeys: r.config.apiKeys.map((k) => ({ provider: k.provider, source: k.source })),
            mcpServers: r.config.mcpServers.map((s) => ({ name: s.name, source: s.source })),
            skills: r.config.skills.map((s) => ({ name: s.name, source: s.source })),
            configFiles: r.config.rawConfigs.map((rc) => rc.path),
          }
        : null,
    })),
  });
});
