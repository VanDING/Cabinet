export {
  AgentRoleRegistry,
  SECRETARY_ROLE,
  CURATOR_ROLE,
  ORGANIZE_ROLE,
  ORGANIZE_DEPLOY_TOOLS,
  getOrganizePlanningTools,
  type AgentRole,
  type AgentRoleType,
  type ModelTier,
} from './agent-roles.js';

export {
  SkillRegistry,
  getSkillRegistry,
  setSkillRegistry,
  type SkillMetadata,
  type SkillEntry,
} from './skill-registry.js';

export {
  parseSkillMarkdown,
  importSkillFromMarkdown,
  exportSkillToMarkdown,
} from './skill-loader.js';

export type { ParsedSkill } from '@cabinet/types';

export { Scanner, type DiscoveryResult } from './discovery/scanner.js';
export { RECIPES } from './discovery/scanner-recipe.js';

export { getProjector, registerProjector } from './projector/index.js';
export { ClaudeCodeProjector } from './projector/claude-code.js';

export {
  getInstallMethods,
  startInstall,
  cancelInstall,
  getInstallTask,
  getAvailableAgents,
  type InstallProgress,
  type InstallTask,
} from './install/installer.js';
