import type { ToolDefinition } from '../tool-executor.js';

export interface LSPToolDeps {
  workspaceSymbols: (query: string) => Promise<{ available: boolean; error?: string; symbols?: { name: string; kind: string; file: string; line: number; column: number }[] }>;
  goToDefinition: (file: string, line: number, column: number) => Promise<{ available: boolean; error?: string; symbols?: { name: string; kind: string; file: string; line: number; column: number }[] }>;
  findReferences: (file: string, line: number, column: number) => Promise<{ available: boolean; error?: string; references?: { file: string; line: number; column: number; lineText: string }[] }>;
  diagnostics: (file?: string) => Promise<{ available: boolean; error?: string; diagnostics?: { file: string; line: number; column: number; message: string; category: 'error' | 'warning' | 'suggestion' }[] }>;
}

export function createLSPTools(deps: LSPToolDeps): ToolDefinition[] {
  return [
    {
      name: 'workspace_symbol',
      description: 'Search for symbols (functions, classes, variables, types) by name in the workspace using TypeScript language service. Works for TS/JS projects.',
      timeoutMs: 30000,
      execute: async (args: Record<string, unknown>) => {
        const query = args.query as string;
        if (!query) return { error: 'query is required' };
        try {
          return await deps.workspaceSymbols(query);
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'go_to_definition',
      description: 'Find where a symbol is defined. Provide the file path, line, and column of the symbol reference.',
      timeoutMs: 30000,
      execute: async (args: Record<string, unknown>) => {
        const file = args.file as string;
        const line = (args.line as number) ?? 1;
        const column = (args.column as number) ?? 1;
        if (!file) return { error: 'file is required' };
        try {
          return await deps.goToDefinition(file, line, column);
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'find_references',
      description: 'Find all references to a symbol across the workspace. Provide the file, line, and column of the symbol.',
      timeoutMs: 30000,
      execute: async (args: Record<string, unknown>) => {
        const file = args.file as string;
        const line = (args.line as number) ?? 1;
        const column = (args.column as number) ?? 1;
        if (!file) return { error: 'file is required' };
        try {
          return await deps.findReferences(file, line, column);
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'diagnostics',
      description: 'Get TypeScript compiler errors and warnings. If file is provided, returns diagnostics for that file only. Otherwise returns diagnostics for all files.',
      timeoutMs: 30000,
      execute: async (args: Record<string, unknown>) => {
        const file = args.file as string | undefined;
        try {
          return await deps.diagnostics(file);
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
  ];
}
