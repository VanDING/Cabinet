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
  /** Per-tool timeout in ms. Falls back to AgentLoop's toolTimeoutMs. */
  timeoutMs?: number;
}

/** Full metadata for a tool (for AI SDK conversion). */
export interface ToolDescriptor {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>): Promise<unknown>;
  /** Per-tool timeout in ms. Falls back to AgentLoop's toolTimeoutMs. */
  timeoutMs?: number;
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
      const summarized = this.summarizeToolResult(name, output);
      this.onToolCall?.(name, true, false, Date.now() - startTime);
      return { toolCallId, output: summarized };
    } catch (error) {
      this.onToolCall?.(name, false, false, Date.now() - startTime);
      return { toolCallId, output: null, error: (error as Error).message };
    }
  }

  /** Summarize verbose tool results to reduce context bloat. */
  private summarizeToolResult(name: string, output: unknown): unknown {
    if (name === 'read_file' || name === 'file_info') {
      if (typeof output === 'string' && output.length > 200) {
        return `${output.slice(0, 200)}... (${output.length - 200} more chars)`;
      }
    }
    if (name === 'list_directory') {
      if (Array.isArray(output) && output.length > 20) {
        return [...output.slice(0, 20), `... (${output.length - 20} more items)`];
      }
    }
    if (name === 'grep' || name === 'searchFiles' || name === 'searchContent') {
      if (Array.isArray(output)) {
        if (output.length > 3) {
          return [...output.slice(0, 3), `... (${output.length - 3} more matches)`];
        }
        return output;
      }
      if (typeof output === 'string') {
        const lines = output.split('\n');
        if (lines.length > 3) {
          return `${lines.slice(0, 3).join('\n')}\n... (${lines.length - 3} more lines)`;
        }
      }
    }
    return output;
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
      timeoutMs: def.timeoutMs,
    }));
  }

  /** Look up a single tool's descriptor by name. */
  getToolDescriptor(name: string): ToolDescriptor | undefined {
    const def = this.tools.get(name);
    if (!def) return undefined;
    return {
      name,
      description: def.description ?? `Execute the ${name} tool`,
      parameters: def.parameters ?? { type: 'object', properties: {} },
      execute: def.execute,
      timeoutMs: def.timeoutMs,
    };
  }

  /** Create a lightweight view that only exposes allowed tools.
   *  The view shares the same tool instances and callback — no re-registration needed. */
  createView(allowedTools: string[]): ToolExecutor {
    const allowed = new Set(allowedTools);
    const view = new ToolExecutor();
    for (const [name, tool] of this.tools) {
      if (allowed.has(name)) {
        view.register(tool);
      }
    }
    if (this.onToolCall) {
      view.setToolCallCallback(this.onToolCall);
    }
    return view;
  }
}
