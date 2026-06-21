import { writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import type { Projector, UnifiedConfig, ProjectOptions, ExtractedConfig } from '@cabinet/types';

export class AiderProjector implements Projector {
  readonly agentId = 'aider';

  nativeConfigPaths() {
    return {
      win32: ['%USERPROFILE%\\.aider.conf.yml'],
      darwin: ['~/.aider.conf.yml'],
      linux: ['~/.aider.conf.yml'],
    };
  }

  async project(config: UnifiedConfig, opts: ProjectOptions = {}): Promise<void> {
    const configPath = join(homedir(), '.aider.conf.yml');
    if (opts.dryRun) return;
    mkdirSync(dirname(configPath), { recursive: true });
    const lines: string[] = [];
    const openaiKey = config.apiKeys.find((k) => k.provider === 'openai');
    const anthropicKey = config.apiKeys.find((k) => k.provider === 'anthropic');
    if (openaiKey) lines.push(`openai-api-key: ${openaiKey.key}`);
    if (anthropicKey) lines.push(`anthropic-api-key: ${anthropicKey.key}`);
    writeFileSync(configPath, lines.join('\n'));
  }

  async extract(): Promise<ExtractedConfig> {
    return { apiKeys: [], mcpServers: [], skills: [] };
  }
}
