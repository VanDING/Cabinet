import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import type { Projector, UnifiedConfig, ProjectOptions, ExtractedConfig } from '@cabinet/types';

export class ClineProjector implements Projector {
  readonly agentId = 'cline';

  nativeConfigPaths() {
    return {
      win32: ['%USERPROFILE%\\.cline\\config.json'],
      darwin: ['~/.cline/config.json'],
      linux: ['~/.cline/config.json'],
    };
  }

  async project(config: UnifiedConfig, opts: ProjectOptions = {}): Promise<void> {
    const configPath = join(homedir(), '.cline', 'config.json');
    if (opts.dryRun) return;
    mkdirSync(dirname(configPath), { recursive: true });
    const existing = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf-8')) : {};
    const openaiKey = config.apiKeys.find((k) => k.provider === 'openai');
    const anthropicKey = config.apiKeys.find((k) => k.provider === 'anthropic');
    const mcpServers: Record<string, unknown> = {};
    for (const s of config.mcpServers) {
      mcpServers[s.name] = { command: s.command, args: s.args ?? [] };
    }
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          ...existing,
          apiKey: openaiKey?.key ?? anthropicKey?.key ?? existing.apiKey,
          mcpServers,
        },
        null,
        2,
      ),
    );
  }

  async extract(): Promise<ExtractedConfig> {
    return { apiKeys: [], mcpServers: [], skills: [] };
  }
}
