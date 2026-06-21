import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ScannerRecipe, ExtractedConfig, ConfigExtractor } from '@cabinet/types';

export async function extractConfig(recipe: ScannerRecipe): Promise<ExtractedConfig> {
  const platform =
    process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
  const result: ExtractedConfig = { apiKeys: [], mcpServers: [], skills: [] };

  const allExtractors = [
    ...(recipe.extract.apiKeys ?? []),
    ...(recipe.extract.mcpServers ?? []),
    ...(recipe.extract.skills ?? []),
  ];

  for (const ex of allExtractors) {
    const filePath = resolvePath(ex.file, platform);
    if (!filePath || !existsSync(filePath)) continue;
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = parseByFormat(raw, ex.format);
    if (ex.apiKeys) for (const spec of ex.apiKeys) extractApiKey(parsed, spec, result);
    if (ex.mcpServers) for (const _spec of ex.mcpServers) extractMcpServers(parsed, result);
    if (ex.skills) for (const _spec of ex.skills) extractSkills(parsed, result);
  }
  return result;
}

function resolvePath(p: string, platform: string): string | undefined {
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  if (p.startsWith('%USERPROFILE%\\')) return join(homedir(), p.slice('%USERPROFILE%\\'.length));
  if (p.startsWith('%APPDATA%\\'))
    return join(
      process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'),
      p.slice('%APPDATA%\\'.length),
    );
  return p;
}

function parseByFormat(raw: string, format: 'json' | 'yaml' | 'toml'): unknown {
  if (format === 'json') return JSON.parse(raw);
  if (format === 'yaml' || format === 'toml')
    throw new Error(`Format ${format} not yet supported in config-extractor`);
  return JSON.parse(raw);
}

function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc == null) return undefined;
    const record = acc as Record<string, unknown>;
    return record[key];
  }, obj);
}

function extractApiKey(
  parsed: unknown,
  spec: { provider: string; path: string },
  result: ExtractedConfig,
): void {
  const value = getByPath(parsed, spec.path);
  if (typeof value === 'string') {
    result.apiKeys.push({ provider: spec.provider, keyHint: value.slice(0, 8) + '…' });
  }
}

function extractMcpServers(parsed: unknown, result: ExtractedConfig): void {
  const servers =
    (parsed as Record<string, unknown>)?.['mcpServers'] ??
    (parsed as Record<string, unknown>)?.['mcp_servers'];
  if (typeof servers !== 'object' || servers == null) return;
  for (const [name, config] of Object.entries(servers as Record<string, unknown>)) {
    const c = config as Record<string, unknown> | undefined;
    if (!c) continue;
    const isSse = c.type === 'sse' || c.url;
    result.mcpServers.push({
      name,
      transport: isSse ? 'sse' : 'stdio',
      command: c.command as string | undefined,
      args: c.args as string[] | undefined,
    });
  }
}

function extractSkills(_parsed: unknown, _result: ExtractedConfig): void {}
