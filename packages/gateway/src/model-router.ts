/** @deprecated Model tier routing is no longer needed — Cabinet uses a single default model per provider. */
export type ModelRole = 'deep_think' | 'fast_execute' | 'default' | 'reasoning';

export interface RouterConfig {
  roles: Record<ModelRole, string[]>;
}

export interface RateLimitState {
  remaining: number;
  limit: number;
  resetAt: number;
}

export class RateLimitTracker {
  private state = new Map<string, RateLimitState>();

  update(provider: string, remaining: number, limit: number, resetAt: number): void {
    this.state.set(provider, { remaining, limit, resetAt });
  }

  getRemaining(provider: string): number {
    const s = this.state.get(provider);
    if (!s) return Infinity;
    if (Date.now() > s.resetAt) return s.limit;
    return s.remaining;
  }
}

const DEFAULT_CONFIG: RouterConfig = {
  roles: {
    deep_think: ['deepseek/deepseek-r1', 'anthropic/claude-opus-4-7'],
    fast_execute: ['deepseek/deepseek-chat', 'anthropic/claude-haiku-4-5'],
    default: ['deepseek/deepseek-chat', 'anthropic/claude-sonnet-4-6'],
    reasoning: ['deepseek/deepseek-r1', 'anthropic/claude-sonnet-4-6'],
  },
};

export class ModelRouter {
  private config: RouterConfig;
  private rateLimitTracker: RateLimitTracker;

  constructor(
    config?: Partial<RouterConfig>,
    userFallbacks?: Partial<Record<ModelRole, string[]>>,
  ) {
    this.config = { roles: { ...DEFAULT_CONFIG.roles, ...config?.roles } };
    // Merge user-configured fallback chains (user config takes priority for specified tiers)
    if (userFallbacks) {
      for (const [role, models] of Object.entries(userFallbacks)) {
        if (models && models.length > 0) {
          this.config.roles[role as ModelRole] = models;
        }
      }
    }
    this.rateLimitTracker = new RateLimitTracker();
  }

  getRateLimitTracker(): RateLimitTracker {
    return this.rateLimitTracker;
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
