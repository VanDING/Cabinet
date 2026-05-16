import type { RulesLoader, RulesContext } from './rules-loader.js';

export interface MemoryProvider {
  getShortTerm(sessionId: string): Promise<{ role: 'user' | 'assistant'; content: string }[]>;
  getProjectContext(projectId: string): Promise<string>;
  getEntityPreferences(captainId: string): Promise<Record<string, unknown>>;
  searchLongTerm(query: string, projectId: string): Promise<string[]>;
}

export interface ContextBuilderOptions {
  sessionId: string;
  projectId: string;
  captainId: string;
  systemPrompt?: string;
  /** Files currently active in the session (for rule glob matching). */
  activeFiles?: string[];
  /** Current task description (for semantic rule matching). */
  taskDescription?: string;
}

export interface ContextBuildResult {
  systemPrompt: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  /** Summary of available rules (for the agent to request on-demand rules). */
  rulesSummary: string;
}

export class ContextBuilder {
  private rulesLoader: RulesLoader | null = null;

  constructor(private readonly memory: MemoryProvider) {}

  /** Attach a rules loader for hierarchical context. */
  withRules(rulesLoader: RulesLoader): this {
    this.rulesLoader = rulesLoader;
    return this;
  }

  async build(options: ContextBuilderOptions): Promise<ContextBuildResult> {
    const [shortTerm, projectContext, preferences] = await Promise.all([
      this.memory.getShortTerm(options.sessionId),
      this.memory.getProjectContext(options.projectId),
      this.memory.getEntityPreferences(options.captainId),
    ]);

    // Load matching rules
    const rulesContext: RulesContext = {
      activeFiles: options.activeFiles ?? [],
      taskDescription: options.taskDescription,
    };
    const rules = this.rulesLoader?.loadMatching(rulesContext) ?? [];
    const rulesSummary = this.rulesLoader?.summarize() ?? '';

    const systemPrompt = options.systemPrompt
      ?? this.buildDefaultSystemPrompt(projectContext, preferences, rules);

    return {
      systemPrompt,
      messages: shortTerm,
      rulesSummary,
    };
  }

  /** Get list of on-demand rules the agent could request. */
  getOnDemandRules(): string {
    return this.rulesLoader?.summarize() ?? 'No rules directory configured.';
  }

  /** Reload rules from disk. */
  reloadRules(): void {
    this.rulesLoader?.reload();
  }

  private buildDefaultSystemPrompt(
    projectContext: string,
    preferences: Record<string, unknown>,
    rules: { path: string; content: string }[],
  ): string {
    const parts: string[] = [
      'You are a Cabinet AI assistant (Secretary).',
      `Current project context: ${projectContext}`,
      `Captain preferences: ${JSON.stringify(preferences)}`,
    ];

    // Inject always-apply rules (only the always-apply ones are passed in)
    if (rules.length > 0) {
      parts.push('\n## Project Rules\n');
      for (const rule of rules) {
        parts.push(`<!-- rule: ${rule.path} -->\n${rule.content}`);
      }
    }

    parts.push('Help the Captain make decisions. Present options clearly with impact analysis.');
    return parts.join('\n');
  }
}
