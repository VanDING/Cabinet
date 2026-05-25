import type { RulesLoader, RulesContext } from './rules-loader.js';

export interface MemoryProvider {
  getShortTerm(sessionId: string): Promise<{ role: 'user' | 'assistant'; content: string }[]>;
  getProjectContext(projectId: string): Promise<string>;
  getEntityPreferences(captainId: string): Promise<Record<string, unknown>>;
  searchLongTerm(query: string, projectId: string): Promise<string[]>;
}

export interface PrebuiltContext {
  projectContext: string;
  rules: { path: string; content: string }[];
}

export interface ContextBuilderOptions {
  sessionId: string;
  projectId: string;
  captainId: string;
  /**
   * Legacy full-override mode. When provided, bypasses all tiered assembly
   * (Tier 1 + Tier 2 + rules + RAG) and returns this string directly.
   * Prefer `roleSystemPrompt` for normal use to preserve rule injection.
   */
  systemPrompt?: string;
  /**
   * Role-specific instructions that replace the hardcoded Tier 1 text,
   * while still assembling Tier 2 (project context + preferences + rules)
   * and Tier 3 (RAG). Use this for normal agent construction.
   */
  roleSystemPrompt?: string;
  /** Files currently active in the session (for rule glob matching). */
  activeFiles?: string[];
  /** Current task description (for semantic rule matching). */
  taskDescription?: string;
  /** Override sessionId for memory lookups (allows agents to share conversation context). */
  memorySessionId?: string;
  /** Pre-built context for strict consistency (skips self-collection). */
  prebuiltContext?: PrebuiltContext;
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
  /** In-memory TTL cache for RAG search results to avoid repeated embedding API calls. */
  private ragCache = new Map<string, { results: string[]; timestamp: number }>();
  private readonly RAG_CACHE_TTL_MS = 60_000;
  /** Request-level cache for project context + rules across sessions (TTL 5s). */
  private contextCache = new Map<string, {
    projectContext: string;
    rules: { path: string; content: string }[];
    timestamp: number;
  }>();
  private readonly CONTEXT_CACHE_TTL_MS = 5_000;

  constructor(private readonly memory: MemoryProvider) {}

  /** Attach a rules loader for hierarchical context. */
  withRules(rulesLoader: RulesLoader): this {
    this.rulesLoader = rulesLoader;
    return this;
  }

  async build(options: ContextBuilderOptions): Promise<ContextBuildResult> {
    const now = Date.now();
    const cacheKey = `${options.sessionId}:${options.projectId}`;
    const cached = this.sessionCache.get(cacheKey);

    // Always reload short-term memory (it changes each iteration).
    // Use memorySessionId if provided so specialist agents can share the base session context.
    // Project context and preferences are session-stable, so use cache when available.
    const memorySid = options.memorySessionId ?? options.sessionId;
    const [shortTerm, preferences] = await Promise.all([
      this.memory.getShortTerm(memorySid),
      cached ? Promise.resolve(cached.preferences) : this.memory.getEntityPreferences(options.captainId),
    ]);

    if (!cached) {
      this.sessionCache.set(cacheKey, { projectContext: '', preferences: preferences as Record<string, unknown> });
    }

    let projectContext: string;
    let rules: { path: string; content: string }[];

    if (options.prebuiltContext) {
      projectContext = options.prebuiltContext.projectContext;
      rules = options.prebuiltContext.rules;
    } else {
      // Request-level cache for project context + rules (shared across sessions for same project)
      const ctxCacheKey = options.projectId;
      const ctxCached = this.contextCache.get(ctxCacheKey);

      if (ctxCached && now - ctxCached.timestamp < this.CONTEXT_CACHE_TTL_MS) {
        projectContext = ctxCached.projectContext;
        rules = ctxCached.rules;
      } else {
        projectContext = await this.memory.getProjectContext(options.projectId);
        const rulesContext: RulesContext = {
          activeFiles: options.activeFiles ?? [],
          taskDescription: options.taskDescription,
        };
        rules = this.rulesLoader?.loadMatching(rulesContext) ?? [];
        this.contextCache.set(ctxCacheKey, { projectContext, rules, timestamp: now });
      }
    }

    // Update session cache with resolved project context
    this.sessionCache.set(cacheKey, { projectContext, preferences: preferences as Record<string, unknown> });

    // rulesSummary is computed on-demand via getOnDemandRules(); including it here
    // caused a second full disk traversal via summarize()->loadAll().
    const rulesSummary = '';

    let systemPrompt: string;
    if (options.systemPrompt && !options.roleSystemPrompt) {
      // Legacy full-override mode: skip all tiered assembly
      systemPrompt = options.systemPrompt;
    } else {
      systemPrompt = this.buildDefaultSystemPrompt(
        projectContext,
        preferences,
        rules,
        options.roleSystemPrompt,
      );
    }

    // Retrieve and inject RAG results at the end of system prompt (fixed position)
    if (options.taskDescription) {
      const ragCacheKey = `${options.projectId}:${options.taskDescription}`;
      const cachedRag = this.ragCache.get(ragCacheKey);
      let ragResults: string[];

      if (cachedRag && now - cachedRag.timestamp < this.RAG_CACHE_TTL_MS) {
        ragResults = cachedRag.results;
      } else {
        try {
          ragResults = await this.memory.searchLongTerm(options.taskDescription, options.projectId);
          this.ragCache.set(ragCacheKey, { results: ragResults, timestamp: now });
        } catch {
          ragResults = [];
        }
      }

      if (ragResults.length > 0) {
        const trimmed = ragResults.slice(0, 3).map((r) => (r.length > 200 ? `${r.slice(0, 200)}...` : r));
        systemPrompt += `\n\n## Retrieved Context\n${trimmed.join('\n')}`;
      }
    }

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
  clearSessionCache(sessionId: string, projectId?: string): void {
    for (const key of this.sessionCache.keys()) {
      if (key.startsWith(sessionId + ':')) {
        this.sessionCache.delete(key);
      }
    }
    if (projectId) {
      this.contextCache.delete(projectId);
    }
    // Evict RAG cache entries that may reference stale session context
    this.ragCache.clear();
  }

  /** Build Tier 1: static role instructions (stable across all calls). */
  private buildTier1Prompt(roleSystemPrompt?: string): string {
    if (roleSystemPrompt) {
      return roleSystemPrompt;
    }
    return [
      'You are a Cabinet AI assistant (Secretary).',
      'You have access to file system tools (read_file, write_file, edit_file, apply_patch, move_file, copy_file, make_directory, file_info, list_directory, glob, grep, delete_file), web tools (web_fetch), shell tools (execute_command), memory tools (remember, recall, search_memory), and project management tools.',
      'For general questions and conversation, answer directly without file system exploration.',
      'Only explore the codebase when: (1) the user explicitly asks for code analysis, (2) you need to read specific files to fulfill a direct request, or (3) you need to verify facts about the project structure.',
      'When you do explore, use parallel tool calls to read multiple files at once.',
      'Use conversation history to avoid repeating the same tool calls — if you already retrieved context in a previous turn, reuse that knowledge.',
    ].join('\n');
  }

  /** Build Tier 2: session-stable context (project, preferences, rules). */
  private buildTier2Prompt(
    projectContext: string,
    preferences: Record<string, unknown>,
    rules: { path: string; content: string }[],
  ): string {
    const parts: string[] = [
      `Current project context: ${projectContext}`,
      `Captain preferences: ${this.stableStringify(preferences)}`,
    ];

    if (rules.length > 0) {
      parts.push('\n## Project Rules\n');
      for (const rule of rules) {
        parts.push(`<!-- rule: ${rule.path} -->\n${rule.content}`);
      }
    }

    return parts.join('\n');
  }

  /** Deterministic JSON stringify to avoid cache jitter from key ordering. */
  private stableStringify(obj: Record<string, unknown>): string {
    const sortedKeys = Object.keys(obj).sort();
    const sorted: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      const value = obj[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        sorted[key] = JSON.parse(this.stableStringify(value as Record<string, unknown>));
      } else {
        sorted[key] = value;
      }
    }
    return JSON.stringify(sorted);
  }

  /**
   * Build the cached portion of the system prompt (Tier 1 + Tier 2).
   * This is the stable prefix that should be marked with cache_control.
   */
  buildCachedSystemPrompt(
    projectContext: string,
    preferences: Record<string, unknown>,
    rules: { path: string; content: string }[],
    roleSystemPrompt?: string,
  ): string {
    const tier1 = this.buildTier1Prompt(roleSystemPrompt);
    const tier2 = this.buildTier2Prompt(projectContext, preferences, rules);
    return [tier1, tier2].join('\n\n');
  }

  private buildDefaultSystemPrompt(
    projectContext: string,
    preferences: Record<string, unknown>,
    rules: { path: string; content: string }[],
    roleSystemPrompt?: string,
  ): string {
    const cached = this.buildCachedSystemPrompt(projectContext, preferences, rules, roleSystemPrompt);
    return [cached, 'Help the Captain make decisions. Present options clearly with impact analysis.'].join('\n\n');
  }
}
