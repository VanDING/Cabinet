import type { ToolDefinition } from '../tool-executor.js';

export interface ShellToolDeps {
  execCommand: (
    command: string,
    cwd?: string,
    timeout?: number,
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

export function createShellTools(deps: ShellToolDeps): ToolDefinition[] {
  return [
    {
      name: 'execute_command',
      execute: async (args: Record<string, unknown>) => {
        const command = args.command as string;
        if (!command) return { error: 'command is required' };

        const cwd = args.cwd as string | undefined;
        const timeout = (args.timeout as number) ?? 60000;

        if (timeout > 300000) return { error: 'timeout exceeds maximum of 300 seconds' };

        try {
          const result = await deps.execCommand(command, cwd, timeout);
          return {
            exitCode: result.exitCode,
            stdout: result.stdout.slice(0, 50000),
            stderr: result.stderr.slice(0, 50000),
            truncated: result.stdout.length > 50000 || result.stderr.length > 50000,
          };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
  ];
}
