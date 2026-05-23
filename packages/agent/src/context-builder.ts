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
  private sessionCache = new Map<string, { projectContext: string; preferences: Record<string, unknown> }>();

  constructor(private readonly memory: MemoryProvider) {}

  /** Attach a rules loader for hierarchical context. */
  withRules(rulesLoader: RulesLoader): this {
    this.rulesLoader = rulesLoader;
    return this;
  }

  async build(options: ContextBuilderOptions): Promise<ContextBuildResult> {
    const cacheKey = `${options.sessionId}:${options.projectId}`;
    const cached = this.sessionCache.get(cacheKey);

    // Always reload short-term memory (it changes each iteration).
    // Project context and preferences are session-stable, so use cache when available.
    const [shortTerm, projectContext, preferences] = await Promise.all([
      this.memory.getShortTerm(options.sessionId),
      cached ? Promise.resolve(cached.projectContext) : this.memory.getProjectContext(options.projectId),
      cached ? Promise.resolve(cached.preferences) : this.memory.getEntityPreferences(options.captainId),
    ]);

    if (!cached) {
      this.sessionCache.set(cacheKey, { projectContext: projectContext as string, preferences: preferences as Record<string, unknown> });
    }

    // Load matching rules
    const rulesContext: RulesContext = {
      activeFiles: options.activeFiles ?? [],
      taskDescription: options.taskDescription,
    };
    const rules = this.rulesLoader?.loadMatching(rulesContext) ?? [];
    const rulesSummary = this.rulesLoader?.summarize() ?? '';

    const systemPrompt =
      options.systemPrompt ?? this.buildDefaultSystemPrompt(projectContext, preferences, rules);

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

  /** Clear cached project context and preferences for a session. */
  clearSessionCache(sessionId: string): void {
    for (const key of this.sessionCache.keys()) {
      if (key.startsWith(sessionId + ':')) {
        this.sessionCache.delete(key);
      }
    }
  }

  private buildDefaultSystemPrompt(
    projectContext: string,
    preferences: Record<string, unknown>,
    rules: { path: string; content: string }[],
  ): string {
    const parts: string[] = [
      'You are a Cabinet AI assistant (Secretary).',
      'You have access to file system tools (read_file, write_file, edit_file, apply_patch, move_file, copy_file, make_directory, file_info, list_directory, glob, grep, delete_file), web tools (web_fetch), shell tools (execute_command), memory tools (remember, recall, search_memory), and project management tools.',
      'When a project is active, proactively use list_directory and read_file to understand the codebase before answering.',
      'Use conversation history to avoid repeating the same tool calls — if you already retrieved context in a previous turn, reuse that knowledge.',
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
