import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import type { Projector, UnifiedConfig, ProjectOptions, ExtractedConfig } from '@cabinet/types';

export class ClaudeCodeProjector implements Projector {
  readonly agentId = 'claude-code';

  nativeConfigPaths() {
    return {
      win32: ['%USERPROFILE%\\.claude\\settings.json', '%USERPROFILE%\\.claude.json'],
      darwin: ['~/.claude/settings.json', '~/.claude.json'],
      linux: ['~/.claude/settings.json', '~/.claude.json'],
    };
  }

  async project(config: UnifiedConfig, opts: ProjectOptions = {}): Promise<void> {
    const settingsPath = join(homedir(), '.claude', 'settings.json');
    const existing = existsSync(settingsPath)
      ? (JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>)
      : {};

    const anthropicKey = config.apiKeys.find((k) => k.provider === 'anthropic');
    const mcpServers: Record<string, unknown> = {};
    for (const s of config.mcpServers) {
      mcpServers[s.name] =
        s.transport === 'stdio'
          ? { command: s.command, args: s.args ?? [], env: s.env ?? {} }
          : { type: 'sse', url: s.url };
    }

    const projected = {
      ...existing,
      env: {
        ...((existing.env as Record<string, unknown>) ?? {}),
        ...(anthropicKey ? { ANTHROPIC_API_KEY: anthropicKey.key } : {}),
      },
      mcpServers,
    };

    if (opts.dryRun) {
      return;
    }

    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(projected, null, 2));
  }

  async extract(): Promise<ExtractedConfig> {
    return { apiKeys: [], mcpServers: [], skills: [] };
  }
}
