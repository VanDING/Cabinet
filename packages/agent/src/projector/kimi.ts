import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import type { Projector, UnifiedConfig, ProjectOptions, ExtractedConfig } from '@cabinet/types';

export class KimiProjector implements Projector {
  readonly agentId = 'kimi';

  nativeConfigPaths() {
    return {
      win32: ['%USERPROFILE%\\.kimi\\config.json'],
      darwin: ['~/.kimi/config.json'],
      linux: ['~/.kimi/config.json'],
    };
  }

  async project(config: UnifiedConfig, opts: ProjectOptions = {}): Promise<void> {
    const configPath = join(homedir(), '.kimi', 'config.json');
    if (opts.dryRun) return;
    mkdirSync(dirname(configPath), { recursive: true });
    const existing = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf-8')) : {};
    const moonshotKey = config.apiKeys.find((k) => k.provider === 'moonshot');
    writeFileSync(
      configPath,
      JSON.stringify({ ...existing, apiKey: moonshotKey?.key ?? existing.apiKey }, null, 2),
    );
  }

  async extract(): Promise<ExtractedConfig> {
    return { apiKeys: [], mcpServers: [], skills: [] };
  }
}
