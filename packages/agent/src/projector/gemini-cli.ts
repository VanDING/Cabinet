import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import type { Projector, UnifiedConfig, ProjectOptions, ExtractedConfig } from '@cabinet/types';

export class GeminiCliProjector implements Projector {
  readonly agentId = 'gemini-cli';

  nativeConfigPaths() {
    return {
      win32: ['%USERPROFILE%\\.config\\google-gemini\\config.json'],
      darwin: ['~/.config/google-gemini/config.json'],
      linux: ['~/.config/google-gemini/config.json'],
    };
  }

  async project(config: UnifiedConfig, opts: ProjectOptions = {}): Promise<void> {
    const configPath = join(homedir(), '.config', 'google-gemini', 'config.json');
    if (opts.dryRun) return;
    mkdirSync(dirname(configPath), { recursive: true });
    const existing = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf-8')) : {};
    const geminiKey = config.apiKeys.find((k) => k.provider === 'google');
    writeFileSync(
      configPath,
      JSON.stringify({ ...existing, apiKey: geminiKey?.key ?? existing.apiKey }, null, 2),
    );
  }

  async extract(): Promise<ExtractedConfig> {
    return { apiKeys: [], mcpServers: [], skills: [] };
  }
}
