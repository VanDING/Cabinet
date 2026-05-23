export type ModelRole = 'deep_think' | 'fast_execute' | 'default';

export interface RouterConfig {
  roles: Record<ModelRole, string[]>;
}

const DEFAULT_CONFIG: RouterConfig = {
  roles: {
    deep_think: ['anthropic/claude-opus-4-7', 'anthropic/claude-sonnet-4-6'],
    fast_execute: ['anthropic/claude-haiku-4-5', 'openai/gpt-4o-mini'],
    default: ['anthropic/claude-sonnet-4-6', 'openai/gpt-4o'],
  },
};

export class ModelRouter {
  private config: RouterConfig;

  constructor(config?: Partial<RouterConfig>, userFallbacks?: Partial<Record<ModelRole, string[]>>) {
    this.config = { roles: { ...DEFAULT_CONFIG.roles, ...config?.roles } };
    // Merge user-configured fallback chains (user config takes priority for specified tiers)
    if (userFallbacks) {
      for (const [role, models] of Object.entries(userFallbacks)) {
        if (models && models.length > 0) {
          this.config.roles[role as ModelRole] = models;
        }
      }
    }
  }

  /** Get the primary model for a given role */
  getModel(role: ModelRole): string {
    const models = this.config.roles[role];
    if (!models || models.length === 0) {
      return this.config.roles['default'][0]!;
    }
    return models[0]!;
  }

  /** Get all fallback models for a role (excluding primary) */
  getFallbacks(role: ModelRole): string[] {
    const models = this.config.roles[role];
    if (!models || models.length <= 1) return [];
    return models.slice(1);
  }

  /** Get the full model list for a role (primary + fallbacks) */
  getModelChain(role: ModelRole): string[] {
    const models = this.config.roles[role];
    if (!models || models.length === 0) {
      return [...this.config.roles['default']];
    }
    return [...models];
  }

  /** Update the model configuration for a role */
  setRoleModels(role: ModelRole, models: string[]): void {
    this.config.roles[role] = models;
  }

  getConfig(): RouterConfig {
    return structuredClone(this.config);
  }
}
