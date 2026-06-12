import type { ToolExecutor } from '../tool-executor.js';

/** Register MCP tools from an MCP manager (must provide callTool function). */
export function registerMCPTools(
  executor: ToolExecutor,
  mcpCallTool: (
    name: string,
    args: Record<string, unknown>,
    trustLevel?: import('@cabinet/types').TrustLevel,
  ) => Promise<unknown>,
  mcpListTools: () => {
    serverName: string;
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }[],
): ToolExecutor {
  for (const tool of mcpListTools()) {
    const fullName = `mcp__${tool.name}`;
    executor.register({
      name: fullName,
      description: tool.description,
      parameters: tool.inputSchema,
      execute: async (args: Record<string, unknown>, context) => {
        const result = await mcpCallTool(fullName, args, context?.trustLevel);
        return result;
      },
    });
  }
  return executor;
}
