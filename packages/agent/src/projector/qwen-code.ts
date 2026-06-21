import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import type { Projector, UnifiedConfig, ProjectOptions, ExtractedConfig } from '@cabinet/types';

export class QwenCodeProjector implements Projector {
  readonly agentId = 'qwen-code';

  nativeConfigPaths() {
    return {
      win32: ['%USERPROFILE%\\.qwen\\config.json'],
      darwin: ['~/.qwen/config.json'],
      linux: ['~/.qwen/config.json'],
    };
  }

  async project(config: UnifiedConfig, opts: ProjectOptions = {}): Promise<void> {
    const configPath = join(homedir(), '.qwen', 'config.json');
    if (opts.dryRun) return;
    mkdirSync(dirname(configPath), { recursive: true });
    const existing = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf-8')) : {};
    const key = config.apiKeys.find((k) => k.provider === 'qwen');
    writeFileSync(
      configPath,
      JSON.stringify({ ...existing, apiKey: key?.key ?? existing.apiKey }, null, 2),
    );
  }

  async extract(): Promise<ExtractedConfig> {
    return { apiKeys: [], mcpServers: [], skills: [] };
  }
}
