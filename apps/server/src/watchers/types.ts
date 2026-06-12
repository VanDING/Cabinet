import type { SkillRegistry } from '@cabinet/agent';
import type { AgentRoleRegistry } from '@cabinet/agent';
import type { SkillRepository, AgentRoleRepository } from '@cabinet/storage';

export interface WatcherDeps {
  skillRegistry: SkillRegistry;
  skillRepo: SkillRepository;
  agentRegistry: AgentRoleRegistry;
  agentRoleRepo: AgentRoleRepository;
  logger: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
  };
}

export interface ProjectWatcherDeps {
  logger: { info(msg: string, meta?: Record<string, unknown>): void };
}

export interface BlueprintWatcherDeps {
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
  };
  /** Call validate + re-compile on the WorkflowEngine. Returns error string if invalid. */
  onBlueprintChange: (blueprintPath: string, content: string) => Promise<string | null>;
}

export interface RulesWatcherDeps {
  reloadRules: () => void;
  logger: { info(msg: string, meta?: Record<string, unknown>): void };
}
