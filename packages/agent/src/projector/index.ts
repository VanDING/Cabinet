import type { Projector, UnifiedConfig, ProjectOptions, ExtractedConfig } from '@cabinet/types';
import { ClaudeCodeProjector } from './claude-code.js';

const registry = new Map<string, Projector>();
registry.set('claude-code', new ClaudeCodeProjector());

export function getProjector(projectorId: string): Projector | undefined {
  return registry.get(projectorId);
}

export function registerProjector(projectorId: string, projector: Projector): void {
  registry.set(projectorId, projector);
}
