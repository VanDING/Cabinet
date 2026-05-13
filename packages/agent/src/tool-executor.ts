export interface ToolResult {
  toolCallId: string;
  output: unknown;
  error?: string;
}

export interface ToolDefinition {
  name: string;
  execute(args: Record<string, unknown>): Promise<unknown>;
}

export class ToolExecutor {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  async execute(name: string, toolCallId: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { toolCallId, output: null, error: `Unknown tool: ${name}` };
    }
    try {
      const output = await tool.execute(args);
      return { toolCallId, output };
    } catch (error) {
      return { toolCallId, output: null, error: (error as Error).message };
    }
  }

  listTools(): string[] {
    return [...this.tools.keys()];
  }
}
