import type { Projector, UnifiedConfig, ProjectOptions, ExtractedConfig } from '@cabinet/types';
import { ClaudeCodeProjector } from './claude-code.js';
import { CodexProjector } from './codex.js';
import { OpenCodeProjector } from './opencode.js';
import { GeminiCliProjector } from './gemini-cli.js';
import { KimiProjector } from './kimi.js';
import { QwenCodeProjector } from './qwen-code.js';
import { GlmProjector } from './glm.js';
import { AiderProjector } from './aider.js';
import { ClineProjector } from './cline.js';

const registry = new Map<string, Projector>();

function register(id: string, p: Projector): void {
  registry.set(id, p);
}

register('claude-code', new ClaudeCodeProjector());
register('codex', new CodexProjector());
register('opencode', new OpenCodeProjector());
register('gemini-cli', new GeminiCliProjector());
register('kimi', new KimiProjector());
register('qwen-code', new QwenCodeProjector());
register('glm', new GlmProjector());
register('aider', new AiderProjector());
register('cline', new ClineProjector());

export function getProjector(projectorId: string): Projector | undefined {
  return registry.get(projectorId);
}

export function registerProjector(projectorId: string, projector: Projector): void {
  registry.set(projectorId, projector);
}
