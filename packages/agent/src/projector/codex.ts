import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import type { Projector, UnifiedConfig, ProjectOptions, ExtractedConfig } from '@cabinet/types';

export class CodexProjector implements Projector {
  readonly agentId = 'codex';

  nativeConfigPaths() {
    return {
      win32: ['%USERPROFILE%\\.codex\\config.toml'],
      darwin: ['~/.codex/config.toml'],
      linux: ['~/.codex/config.toml'],
    };
  }

  async project(config: UnifiedConfig, opts: ProjectOptions = {}): Promise<void> {
    const configPath = join(homedir(), '.codex', 'config.toml');
    if (opts.dryRun) return;
    mkdirSync(dirname(configPath), { recursive: true });
    const lines: string[] = [];
    const openaiKey = config.apiKeys.find((k) => k.provider === 'openai');
    if (openaiKey) lines.push(`api_key = "${openaiKey.key}"`);
    writeFileSync(configPath, lines.join('\n'));
  }

  async extract(): Promise<ExtractedConfig> {
    return { apiKeys: [], mcpServers: [], skills: [] };
  }
}
