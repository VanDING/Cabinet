import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { AgentDefinition } from './agent-definitions.js';
import { getCurrentPlatform } from './agent-definitions.js';

export interface ScannedConfig {
  apiKeys: Array<{ provider: string; key: string; source: string }>;
  mcpServers: Array<{ name: string; config: Record<string, unknown>; source: string }>;
  skills: Array<{ name: string; source: string }>;
  rawConfigs: Array<{ path: string; data: unknown }>;
}

function resolvePath(p: string): string {
  if (p.startsWith('~')) {
    return path.join(homedir(), p.slice(1));
  }
  if (p.startsWith('%USERPROFILE%')) {
    return path.join(homedir(), p.replace('%USERPROFILE%', ''));
  }
  if (p.startsWith('%APPDATA%')) {
    const appdata = process.env.APPDATA ?? path.join(homedir(), 'AppData', 'Roaming');
    return path.join(appdata, p.replace('%APPDATA%', ''));
  }
  if (p.startsWith('%LOCALAPPDATA%')) {
    const localappdata = process.env.LOCALAPPDATA ?? path.join(homedir(), 'AppData', 'Local');
    return path.join(localappdata, p.replace('%LOCALAPPDATA%', ''));
  }
  return p;
}

function getByPath(obj: unknown, jsonPath: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  let current: unknown = obj;
  for (const key of jsonPath.split('.')) {
    if (current && typeof current === 'object' && key in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return current;
}

export async function scanAgentConfig(def: AgentDefinition): Promise<ScannedConfig> {
  const result: ScannedConfig = {
    apiKeys: [],
    mcpServers: [],
    skills: [],
    rawConfigs: [],
  };

  const platform = getCurrentPlatform();
  const configPaths = def.configPaths[platform] ?? [];

  for (const configPath of configPaths) {
    const resolved = resolvePath(configPath);
    if (!existsSync(resolved)) continue;

    try {
      const content = await readFile(resolved, 'utf-8');
      const data = def.configFormat === 'json' ? JSON.parse(content) : null;
      if (!data) continue;

      result.rawConfigs.push({ path: resolved, data });

      if (def.extract.apiKeys) {
        for (const apiKeySpec of def.extract.apiKeys) {
          const key = getByPath(data, apiKeySpec.jsonPath);
          if (typeof key === 'string' && key.length > 0) {
            result.apiKeys.push({
              provider: apiKeySpec.provider,
              key,
              source: resolved,
            });
          }
        }
      }

      if (def.extract.mcpServers) {
        for (const mcpSpec of def.extract.mcpServers) {
          const servers = getByPath(data, mcpSpec.jsonPath);
          if (servers && typeof servers === 'object') {
            for (const [name, config] of Object.entries(servers as Record<string, unknown>)) {
              result.mcpServers.push({
                name,
                config: config as Record<string, unknown>,
                source: resolved,
              });
            }
          }
        }
      }

      if (def.extract.skills) {
        for (const skillSpec of def.extract.skills) {
          const skills = getByPath(data, skillSpec.jsonPath);
          if (Array.isArray(skills)) {
            for (const skill of skills) {
              if (typeof skill === 'string') {
                result.skills.push({ name: skill, source: resolved });
              } else if (skill && typeof skill === 'object' && 'name' in skill) {
                result.skills.push({
                  name: (skill as { name: string }).name,
                  source: resolved,
                });
              }
            }
          }
        }
      }
    } catch {
      // Config file exists but can't be parsed — skip
    }
  }

  return result;
}

export async function scanAllAgentConfigs(
  definitions: AgentDefinition[],
): Promise<Array<{ def: AgentDefinition; config: ScannedConfig }>> {
  const results: Array<{ def: AgentDefinition; config: ScannedConfig }> = [];
  for (const def of definitions) {
    const config = await scanAgentConfig(def);
    if (config.rawConfigs.length > 0 || config.apiKeys.length > 0 || config.mcpServers.length > 0) {
      results.push({ def, config });
    }
  }
  return results;
}
