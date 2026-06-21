import { Hono } from 'hono';
import { getServerContext } from '../context.js';
import { config } from '../config.js';
import { totalmem, freemem, cpus, uptime as osUptime, networkInterfaces } from 'node:os';
import https from 'node:https';

export const healthRouter = new Hono();

// CPU sampling state for utilization calculation
let prevCpuSnapshot: { idle: number; total: number; usage: number; timestamp: number } | null =
  null;

function getCpuUsage(): number | null {
  const now = Date.now();
  // Return cached value if queried within 3 seconds to avoid wild fluctuations
  // when multiple rapid polls occur (workflow events + scheduled interval)
  if (prevCpuSnapshot && now - prevCpuSnapshot.timestamp < 3000) {
    return prevCpuSnapshot.usage;
  }

  const cpuList = cpus();
  let total = 0;
  let idle = 0;
  for (const cpu of cpuList) {
    for (const [type, ticks] of Object.entries(cpu.times)) {
      total += ticks;
      if (type === 'idle') idle += ticks;
    }
  }
  if (prevCpuSnapshot) {
    const totalDelta = total - prevCpuSnapshot.total;
    const idleDelta = idle - prevCpuSnapshot.idle;
    if (totalDelta > 0) {
      const usage = Math.round(((totalDelta - idleDelta) / totalDelta) * 100);
      prevCpuSnapshot = { idle, total, usage, timestamp: now };
      return usage;
    }
  }
  prevCpuSnapshot = { idle, total, usage: 0, timestamp: now };
  return null;
}

function getNetworkStatus(): 'connected' | 'disconnected' {
  const interfaces = networkInterfaces();
  for (const [, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      // A non-internal IPv4 address means we're connected to a network
      if (!addr.internal && addr.family === 'IPv4') {
        return 'connected';
      }
    }
  }
  return 'disconnected';
}

let cachedLlmStatus: { status: 'connected' | 'disconnected' | 'unconfigured'; checkedAt: number } =
  {
    status: 'unconfigured',
    checkedAt: 0,
  };

async function checkLlmConnectivity(
  hasKey: boolean,
): Promise<'connected' | 'disconnected' | 'unconfigured'> {
  if (!hasKey) return 'unconfigured';

  const now = Date.now();
  if (now - cachedLlmStatus.checkedAt < 60000) {
    return cachedLlmStatus.status;
  }

  return new Promise((resolve) => {
    const req = https.request(
      'https://api.anthropic.com',
      { method: 'HEAD', timeout: 5000 },
      () => {
        cachedLlmStatus = { status: 'connected', checkedAt: Date.now() };
        resolve('connected');
      },
    );
    req.on('error', () => {
      cachedLlmStatus = { status: 'disconnected', checkedAt: Date.now() };
      resolve('disconnected');
    });
    req.on('timeout', () => {
      req.destroy();
      cachedLlmStatus = { status: 'disconnected', checkedAt: Date.now() };
      resolve('disconnected');
    });
    req.end();
  });
}

healthRouter.get('/', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

healthRouter.get('/system', async (c) => {
  const { db, metrics } = getServerContext();

  const memUsage = process.memoryUsage();
  const totalMem = totalmem();
  const freeMem = freemem();
  const cpuUsage = getCpuUsage();
  const network = getNetworkStatus();
  const hasLlmKey = !!(config.anthropicApiKey || config.openaiApiKey || config.deepseekApiKey);
  const llmStatus = await checkLlmConnectivity(hasLlmKey);

  let dbSize = 0;
  try {
    const row = db
      .prepare('SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()')
      .get() as any;
    dbSize = row?.size ?? 0;
  } catch {
    /* db size query failed */
  }

  const summary = metrics.getSummary();
  const uptime = process.uptime();
  const usedMem = totalMem - freeMem;

  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    system: {
      platform: process.platform,
      nodeVersion: process.version,
      uptime: { process: uptime, os: osUptime() },
      cpu: {
        cores: cpus().length,
        model: cpus()[0]?.model ?? 'unknown',
        usage: cpuUsage,
      },
      memory: {
        processMB: (memUsage.heapUsed / 1024 / 1024).toFixed(1) + ' MB',
        usedGB: (usedMem / 1024 / 1024 / 1024).toFixed(1),
        totalGB: (totalMem / 1024 / 1024 / 1024).toFixed(1),
      },
      database: { sizeMB: (dbSize / 1024 / 1024).toFixed(1) + ' MB' },
      network,
      llm: llmStatus,
    },
    metrics: summary,
  });
});
