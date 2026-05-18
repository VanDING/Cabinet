export interface ToolResult {
  toolCallId: string;
  output: unknown;
  error?: string;
}

export interface ToolDefinition {
  name: string;
  execute(args: Record<string, unknown>): Promise<unknown>;
  /** Human-readable description of what the tool does (used for AI SDK tool registration). */
  description?: string;
  /** JSON Schema for the tool's input parameters. */
  parameters?: Record<string, unknown>;
}

/** Full metadata for a tool (for AI SDK conversion). */
export interface ToolDescriptor {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
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

  /** Return full tool metadata for AI SDK conversion. */
  getToolDescriptors(): ToolDescriptor[] {
    return [...this.tools.entries()].map(([name, def]) => ({
      name,
      description: def.description ?? `Execute the ${name} tool`,
      parameters: def.parameters ?? { type: 'object', properties: {} },
      execute: def.execute,
    }));
  }
}
