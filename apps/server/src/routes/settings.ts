/* eslint-disable @typescript-eslint/no-explicit-any */
import { Hono } from 'hono';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { encryptApiKey, decryptApiKey } from '../crypto.js';
import { getServerContext, getCurrentTier, setCurrentTier } from '../context.js';
import { config } from '../config.js';
import { DelegationTier } from '@cabinet/types';
import { CABINET_DIR } from '@cabinet/storage';
import { DEFAULT_ADAPTIVE_MONITOR_CONFIG, DEFAULT_PIS_CONFIG } from '@cabinet/types';
import { broadcast } from '../ws/handler.js';
import { AISDKAdapter } from '@cabinet/gateway';
import type { MCPServerConfig } from '../mcp/mcp-manager.js';
import type { MCPTransportConfig } from '../mcp/mcp-transport.js';

const MASTER_PW = config.masterPassword;
const SETTINGS_PATH = join(CABINET_DIR, 'settings.json');

function loadSettings(): Record<string, unknown> {
  try {
    if (existsSync(SETTINGS_PATH)) {
      return JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));
    }
  } catch {
    /* file missing or corrupt */
  }
  return {};
}

function saveSettings(updates: Record<string, unknown>): void {
  const current = loadSettings();
  const merged = { ...current, ...updates };
  writeFileSync(SETTINGS_PATH, JSON.stringify(merged, null, 2), 'utf-8');
}

export const settingsRouter = new Hono();

// ── Budget ──

function loadBudget(): { daily: number; weekly: number; monthly: number } {
  try {
    const { metricRepo } = getServerContext();
    const value = metricRepo.getLatestValue('budget_limits');
    if (value) return JSON.parse(value);
  } catch {
    /* budget not configured yet */
  }
  return { daily: config.dailyBudget, weekly: config.weeklyBudget, monthly: config.monthlyBudget };
}

function saveBudget(limits: { daily: number; weekly: number; monthly: number }) {
  const { metricRepo } = getServerContext();
  metricRepo.insert('budget_limits', JSON.stringify(limits));
}

settingsRouter.get('/budget', (c) => {
  const { budgetGuard, costTracker } = getServerContext();
  const budget = loadBudget();
  const status = budgetGuard.checkAll();
  return c.json({
    ...budget,
    currentSpend: costTracker.getDailyCost(),
    budgetStatus: status,
  });
});

settingsRouter.put('/budget', async (c) => {
  const { budgetGuard, logger } = getServerContext();
  const body = await c.req.json();
  const parseBudget = (v: unknown, fallback: number) => {
    const n = parseFloat(String(v));
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  const limits = {
    daily: parseBudget(body.daily, config.dailyBudget),
    weekly: parseBudget(body.weekly, config.weeklyBudget),
    monthly: parseBudget(body.monthly, config.monthlyBudget),
  };
  saveBudget(limits);
  if (typeof (budgetGuard as any).setLimits === 'function') {
    (budgetGuard as any).setLimits(limits);
  }
  saveSettings({ budgetLimits: limits });
  logger.info('Budget updated', limits);
  return c.json({ status: 'updated', ...limits });
});

// ── API Keys (SQLite-backed) ──

function ensureApiKeyColumns(db: any) {
  try {
    db.prepare("ALTER TABLE api_keys ADD COLUMN base_url TEXT DEFAULT ''").run();
  } catch {
    /* column already exists */
  }
  try {
    db.prepare("ALTER TABLE api_keys ADD COLUMN model TEXT DEFAULT ''").run();
  } catch {
    /* column already exists */
  }
}

settingsRouter.get('/api-keys', (c) => {
  const { apiKeyRepo } = getServerContext();
  try {
    const rows = apiKeyRepo.findAll();
    const keys = rows.map((k) => ({
      id: k.id,
      provider: k.provider,
      keyPreview: (() => {
        try {
          return decryptApiKey(k.encrypted_key, MASTER_PW).slice(0, 8) + '...';
        } catch {
          return '***...';
        }
      })(),
      encrypted: k.encrypted_key.slice(0, 20) + '...',
      keyType: k.key_type,
      createdAt: k.created_at,
      baseUrl: k.base_url ?? '',
      model: k.model ?? '',
    }));
    return c.json({ keys });
  } catch (e) {
    return c.json({ keys: [], error: (e as Error).message });
  }
});

settingsRouter.post('/api-keys', async (c) => {
  const { apiKeyRepo, refreshGateway } = getServerContext();
  const body = await c.req.json();
  const id = `key_${Date.now()}`;
  const encryptedKey = encryptApiKey(body.apiKey, MASTER_PW);

  try {
    apiKeyRepo.insert({
      id,
      provider: body.provider ?? 'unknown',
      encrypted_key: encryptedKey,
      key_type: body.keyType ?? 'api_key',
      created_at: new Date().toISOString(),
      last_used_at: null,
      base_url: body.baseUrl ?? '',
      model: body.model ?? '',
    });
    refreshGateway();
    broadcast('apikeys_changed', {
      action: 'added',
      provider: body.provider,
      timestamp: new Date().toISOString(),
    });
    return c.json({ id, status: 'key_added', provider: body.provider });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

settingsRouter.delete('/api-keys/:id', (c) => {
  const { apiKeyRepo, refreshGateway } = getServerContext();
  const id = c.req.param('id');
  try {
    apiKeyRepo.delete(id);
    refreshGateway();
    broadcast('apikeys_changed', { action: 'deleted', id, timestamp: new Date().toISOString() });
    return c.json({ status: 'deleted' });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

settingsRouter.post('/preferred-key', async (c) => {
  const { apiKeyRepo, refreshGateway } = getServerContext();
  const { setActiveApiKeyId } = await import('../context.js');
  const { keyId } = await c.req.json<{ keyId: string | null }>();
  if (keyId) {
    const row = apiKeyRepo.findById(keyId);
    if (!row) return c.json({ error: 'API key not found' }, 404);
  }
  setActiveApiKeyId(keyId);
  refreshGateway();
  return c.json({ status: 'ok', preferredKeyId: keyId });
});

settingsRouter.post('/api-keys/:id/test', async (c) => {
  const { apiKeyRepo } = getServerContext();
  const id = c.req.param('id');
  const row = apiKeyRepo.findById(id);
  if (!row) {
    return c.json({ status: 'error', message: 'API key not found' }, 404);
  }

  let decryptedKey: string;
  try {
    decryptedKey = decryptApiKey(row.encrypted_key, MASTER_PW);
  } catch {
    return c.json({ status: 'error', message: 'Failed to decrypt API key' }, 500);
  }

  const provider = row.provider;
  const baseUrl = row.base_url ?? undefined;

  // Build a temporary adapter with only this provider
  const providerConfigs: Record<string, { apiKey: string; baseUrl?: string }> = {
    [provider]: { apiKey: decryptedKey, ...(baseUrl ? { baseUrl } : {}) },
  };

  // Provider-specific fast test models — avoids hardcoded Anthropic fallback in ModelRouter
  const FAST_TEST_MODELS: Record<string, string> = {
    anthropic: 'anthropic/claude-haiku-4-5',
    openai: 'openai/gpt-4o-mini',
    google: 'google/gemini-2.5-flash',
    deepseek: 'deepseek/deepseek-v4-flash',
    qwen: 'qwen/qwen-turbo',
    moonshot: 'moonshot/moonshot-v1-8k',
    zhipu: 'zhipu/glm-4-flash',
    baichuan: 'baichuan/baichuan3-turbo',
  };
  const testModel = FAST_TEST_MODELS[provider] ?? `${provider}/default`;

  const tempAdapter = new AISDKAdapter(providerConfigs as any, {});

  const start = Date.now();
  try {
    const result = await tempAdapter.generateText({
      model: testModel,
      messages: [{ role: 'user', content: 'Reply with just "OK".' }],
      maxTokens: 10,
    });
    const latency = Date.now() - start;
    return c.json({ status: 'ok', latency_ms: latency, model: result.model });
  } catch (e) {
    return c.json({ status: 'error', message: (e as Error).message ?? 'Connection failed' }, 503);
  }
});

// ── Delegation Tier ──

const TIER_DESCRIPTIONS: Record<string, string> = {
  [DelegationTier.CaptainReview]:
    'Every write operation and decision requires your confirmation. Recommended for initial setup and audit periods.',
  [DelegationTier.StrategicGuard]:
    'Low-risk operations are automatic. Cost-incurring actions (meetings, workflow runs) and destructive changes require confirmation.',
  [DelegationTier.TrustedMode]:
    'Most operations are automatic. Only destructive changes (deletion, decision rejection) require confirmation.',
  [DelegationTier.FullAutonomy]:
    'Full autonomy. The budget cap is the only gate. A daily summary will keep you informed.',
};

const ALL_TIERS = [
  DelegationTier.CaptainReview,
  DelegationTier.StrategicGuard,
  DelegationTier.TrustedMode,
  DelegationTier.FullAutonomy,
];

settingsRouter.get('/delegation-tier', (c) => {
  const tier = getCurrentTier();
  return c.json({
    tier,
    label: tier
      .replace('T0', 'Captain Review')
      .replace('T1', 'Strategic Guard')
      .replace('T2', 'Trusted Mode')
      .replace('T3', 'Full Autonomy'),
    description: TIER_DESCRIPTIONS[tier] ?? '',
    available: ALL_TIERS.map((t) => ({
      id: t,
      label:
        t === 'T0'
          ? 'Captain Review'
          : t === 'T1'
            ? 'Strategic Guard'
            : t === 'T2'
              ? 'Trusted Mode'
              : 'Full Autonomy',
      description: TIER_DESCRIPTIONS[t] ?? '',
    })),
  });
});

settingsRouter.put('/delegation-tier', async (c) => {
  const body = await c.req.json();
  const tier = body.tier as string;
  if (!ALL_TIERS.includes(tier as DelegationTier)) {
    return c.json({ error: `Invalid tier. Must be one of: ${ALL_TIERS.join(', ')}` }, 400);
  }
  setCurrentTier(tier as DelegationTier);
  saveSettings({ delegationTier: tier });
  const { logger } = getServerContext();
  logger.info('Delegation tier changed', { tier });
  return c.json({ tier, status: 'updated' });
});

// ── MCP Config Normalization ──

function normalizeMCPConfig(cfg: Record<string, unknown>): MCPServerConfig {
  const transport = cfg.transport;

  // New format: transport is an object { type, command?, url?, ... }
  if (transport && typeof transport === 'object' && !Array.isArray(transport)) {
    return {
      name: String(cfg.name ?? ''),
      transport: transport as MCPTransportConfig,
      enabled: cfg.enabled !== false,
    };
  }

  // Old flat format: command/args at top level
  return {
    name: String(cfg.name ?? ''),
    transport: {
      type: 'stdio',
      command: String(cfg.command ?? 'npx'),
      args: Array.isArray(cfg.args) ? (cfg.args as string[]) : [],
      env: cfg.env as Record<string, string> | undefined,
    },
    enabled: cfg.enabled !== false,
  };
}

function validateMCPConfig(cfg: MCPServerConfig): string | null {
  if (!cfg.name) return 'Server name is required';
  const t = cfg.transport;
  if (t.type === 'sse') {
    if (!t.url) return `SSE server "${cfg.name}" requires a URL`;
  } else {
    if (!t.command) return `stdio server "${cfg.name}" requires a command`;
  }
  return null;
}

// ── MCP Servers ──

settingsRouter.get('/mcp-servers', (c) => {
  const { mcpManager } = getServerContext();
  return c.json({ servers: mcpManager.getStatus(), configs: mcpManager.getConfigs() });
});

settingsRouter.put('/mcp-servers', async (c) => {
  const { mcpManager, settingsRepo, logger } = getServerContext();
  const body = await c.req.json();
  const rawConfigs: Array<Record<string, unknown>> = body.configs ?? [];

  // Normalize old flat format to new MCPTransportConfig format
  const configs = rawConfigs.map((cfg) => normalizeMCPConfig(cfg));

  // Validate
  for (const cfg of configs) {
    const err = validateMCPConfig(cfg);
    if (err) return c.json({ error: err }, 400);
  }

  // Persist to DB and settings.json
  settingsRepo.set('mcp_servers', JSON.stringify(configs));
  saveSettings({ mcpServers: configs });
  await mcpManager.updateConfigs(configs);
  logger.info('MCP servers updated', { count: configs.length });
  return c.json({ status: 'updated', servers: mcpManager.getStatus() });
});

settingsRouter.post('/mcp-servers/test', async (c) => {
  const { mcpManager } = getServerContext();
  const body = await c.req.json();
  try {
    await mcpManager.connectServer(body);
    const tools = mcpManager.listTools().filter((t) => t.serverName === body.name);
    return c.json({ status: 'connected', toolCount: tools.length, tools });
  } catch (e) {
    return c.json({ status: 'error', error: (e as Error).message }, 500);
  }
});

// ── Model Configuration ──

settingsRouter.get('/model-config', (c) => {
  const settings = loadSettings();
  // Reflect the actual runtime modelMapping from the gateway if available,
  // otherwise fall back to settings.json, then to a reasonable default.
  const ctx = getServerContext();
  const gateway = ctx.gateway as any;
  const runtimeMapping = gateway?.modelMapping as Record<string, string> | undefined;
  const effectiveMapping = settings.modelMapping ??
    runtimeMapping ?? {
      deep_reasoning: 'anthropic/claude-opus-4-7',
      default: 'anthropic/claude-sonnet-4-6',
      fast_execution: 'anthropic/claude-haiku-4-5',
    };
  return c.json({
    providers: settings.providers ?? {},
    modelMapping: effectiveMapping,
  });
});

settingsRouter.put('/model-config', async (c) => {
  const { refreshGateway, logger } = getServerContext();
  const body = await c.req.json();

  if (body.providers !== undefined && typeof body.providers !== 'object') {
    return c.json({ error: 'providers must be an object' }, 400);
  }
  if (body.modelMapping !== undefined && typeof body.modelMapping !== 'object') {
    return c.json({ error: 'modelMapping must be an object' }, 400);
  }

  const updates: Record<string, unknown> = {};
  if (body.providers !== undefined) updates.providers = body.providers;
  if (body.modelMapping !== undefined) updates.modelMapping = body.modelMapping;
  saveSettings(updates);
  refreshGateway();
  logger.info('Model config updated', {
    providers: Object.keys(body.providers ?? {}),
    tiers: Object.keys(body.modelMapping ?? {}),
  });
  return c.json({ status: 'updated' });
});

// ── Adaptive Monitor ──

settingsRouter.get('/adaptive-monitor', (c) => {
  const settings = loadSettings();
  const cfg =
    (settings.adaptiveMonitor as Record<string, unknown> | undefined) ??
    DEFAULT_ADAPTIVE_MONITOR_CONFIG;
  return c.json(cfg);
});

function parseNum(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

settingsRouter.put('/adaptive-monitor', async (c) => {
  const { logger } = getServerContext();
  const body = await c.req.json();
  const cfg = {
    enabled: body.enabled === true,
    explorationRate: Math.max(
      0,
      Math.min(1, parseNum(body.explorationRate, DEFAULT_ADAPTIVE_MONITOR_CONFIG.explorationRate)),
    ),
    lookbackDays: Math.max(
      1,
      Math.floor(parseNum(body.lookbackDays, DEFAULT_ADAPTIVE_MONITOR_CONFIG.lookbackDays)),
    ),
    minSamplesPerZone: Math.max(
      1,
      Math.floor(
        parseNum(body.minSamplesPerZone, DEFAULT_ADAPTIVE_MONITOR_CONFIG.minSamplesPerZone),
      ),
    ),
    hardLimits: {
      smartZoneMin: Math.max(
        0,
        Math.min(
          1,
          parseNum(
            body.hardLimits?.smartZoneMin,
            DEFAULT_ADAPTIVE_MONITOR_CONFIG.hardLimits.smartZoneMin,
          ),
        ),
      ),
      criticalThresholdMax: Math.max(
        0,
        Math.min(
          1,
          parseNum(
            body.hardLimits?.criticalThresholdMax,
            DEFAULT_ADAPTIVE_MONITOR_CONFIG.hardLimits.criticalThresholdMax,
          ),
        ),
      ),
    },
  };
  saveSettings({ adaptiveMonitor: cfg });
  logger.info('Adaptive monitor config updated', cfg);
  return c.json({ status: 'updated', ...cfg });
});

// ── PIS ──

settingsRouter.get('/pis', (c) => {
  const settings = loadSettings();
  const cfg = (settings.pis as Record<string, unknown> | undefined) ?? DEFAULT_PIS_CONFIG;
  return c.json(cfg);
});

settingsRouter.put('/pis', async (c) => {
  const { logger } = getServerContext();
  const body = await c.req.json();
  const weights = body.weights;
  const cfg = {
    enabled: body.enabled === true,
    mode: body.mode === 'intervene' ? 'intervene' : 'log_only',
    evaluationIntervalSteps: Math.max(
      1,
      Math.floor(
        parseNum(body.evaluationIntervalSteps, DEFAULT_PIS_CONFIG.evaluationIntervalSteps),
      ),
    ),
    weights:
      weights && typeof weights === 'object' && !Array.isArray(weights)
        ? {
            intentAlignment: Math.max(
              0,
              Math.min(
                1,
                parseNum(weights.intentAlignment, DEFAULT_PIS_CONFIG.weights!.intentAlignment),
              ),
            ),
            toolCoherence: Math.max(
              0,
              Math.min(
                1,
                parseNum(weights.toolCoherence, DEFAULT_PIS_CONFIG.weights!.toolCoherence),
              ),
            ),
            goalProgress: Math.max(
              0,
              Math.min(1, parseNum(weights.goalProgress, DEFAULT_PIS_CONFIG.weights!.goalProgress)),
            ),
            contextStability: Math.max(
              0,
              Math.min(
                1,
                parseNum(weights.contextStability, DEFAULT_PIS_CONFIG.weights!.contextStability),
              ),
            ),
          }
        : DEFAULT_PIS_CONFIG.weights,
  };
  saveSettings({ pis: cfg });
  logger.info('PIS config updated', cfg);
  return c.json({ status: 'updated', ...cfg });
});
