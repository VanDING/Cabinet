import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import type { Projector, UnifiedConfig, ProjectOptions, ExtractedConfig } from '@cabinet/types';

export class OpenCodeProjector implements Projector {
  readonly agentId = 'opencode';

  nativeConfigPaths() {
    return {
      win32: ['%APPDATA%\\opencode\\opencode.json'],
      darwin: ['~/.config/opencode/opencode.json'],
      linux: ['~/.config/opencode/opencode.json'],
    };
  }

  async project(config: UnifiedConfig, opts: ProjectOptions = {}): Promise<void> {
    const configPath = join(homedir(), '.config', 'opencode', 'opencode.json');
    if (opts.dryRun) return;
    mkdirSync(dirname(configPath), { recursive: true });
    const existing = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf-8')) : {};
    const mcpServers: Record<string, unknown> = {};
    for (const s of config.mcpServers) {
      mcpServers[s.name] =
        s.transport === 'stdio'
          ? { command: s.command, args: s.args ?? [] }
          : { type: 'remote', url: s.url };
    }
    writeFileSync(configPath, JSON.stringify({ ...existing, mcpServers }, null, 2));
  }

  async extract(): Promise<ExtractedConfig> {
    return { apiKeys: [], mcpServers: [], skills: [] };
  }
}
