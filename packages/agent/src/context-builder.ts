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
}

export class ContextBuilder {
  constructor(private readonly memory: MemoryProvider) {}

  async build(options: ContextBuilderOptions): Promise<{
    systemPrompt: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
  }> {
    const [shortTerm, projectContext, preferences] = await Promise.all([
      this.memory.getShortTerm(options.sessionId),
      this.memory.getProjectContext(options.projectId),
      this.memory.getEntityPreferences(options.captainId),
    ]);

    const systemPrompt = options.systemPrompt ?? this.buildDefaultSystemPrompt(projectContext, preferences);

    return {
      systemPrompt,
      messages: shortTerm,
    };
  }

  private buildDefaultSystemPrompt(
    projectContext: string,
    preferences: Record<string, unknown>
  ): string {
    return [
      'You are a Cabinet AI assistant (Secretary).',
      `Current project context: ${projectContext}`,
      `Captain preferences: ${JSON.stringify(preferences)}`,
      'Help the Captain make decisions. Present options clearly with impact analysis.',
    ].join('\n');
  }
}
