export interface ToolResult {
  toolCallId: string;
  output: unknown;
  error?: string;
}

export interface ToolDefinition {
  name: string;
  execute(args: Record<string, unknown>): Promise<unknown>;
}

/** Called after each tool execution with timing and result info. */
export type ToolCallCallback = (
  toolName: string, success: boolean, blocked: boolean, durationMs: number,
) => void;

export class ToolExecutor {
  private tools = new Map<string, ToolDefinition>();
  private onToolCall: ToolCallCallback | null = null;

  setToolCallCallback(callback: ToolCallCallback): void {
    this.onToolCall = callback;
  }

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  async execute(
    name: string,
    toolCallId: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const startTime = Date.now();
    const tool = this.tools.get(name);
    if (!tool) {
      this.onToolCall?.(name, false, false, Date.now() - startTime);
      return { toolCallId, output: null, error: `Unknown tool: ${name}` };
    }
    try {
      const output = await tool.execute(args);
      this.onToolCall?.(name, true, false, Date.now() - startTime);
      return { toolCallId, output };
    } catch (error) {
      this.onToolCall?.(name, false, false, Date.now() - startTime);
      return { toolCallId, output: null, error: (error as Error).message };
    }
  }

  listTools(): string[] {
    return [...this.tools.keys()];
  }
}
