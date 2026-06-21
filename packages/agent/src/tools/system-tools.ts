import type { ToolDefinition } from '../tool-executor.js';

export interface SystemToolDeps {
  readClipboard: () => Promise<{ text: string }>;
  writeClipboard: (text: string) => Promise<{ written: boolean }>;
  sendNotification: (title: string, message: string) => Promise<{ sent: boolean }>;
  startProcess: (command: string, args?: string[], cwd?: string) => Promise<{ pid: number }>;
  killProcess: (pid: number) => Promise<{ killed: boolean; error?: string }>;
  showOpenDialog: (options?: {
    multiple?: boolean;
    filters?: { name: string; extensions: string[] }[];
  }) => Promise<{ paths: string[]; error?: string }>;
}

export function createSystemTools(deps: SystemToolDeps): ToolDefinition[] {
  return [
    {
      name: 'read_clipboard',
      description: 'Read the current contents of the system clipboard.',
      timeoutMs: 5000,
      parameters: {
        type: 'object',
        properties: {},
      },
      execute: async (_args: Record<string, unknown>) => {
        try {
          const result = await deps.readClipboard();
          return { text: result.text };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'write_clipboard',
      description: 'Write text to the system clipboard.',
      timeoutMs: 5000,
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to write to the clipboard' },
        },
        required: ['text'],
      },
      execute: async (args: Record<string, unknown>) => {
        const text = args.text as string;
        if (text === undefined) return { error: 'text is required' };
        try {
          const result = await deps.writeClipboard(text);
          return { written: result.written };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'send_notification',
      description: 'Send a system notification (desktop toast/bubble).',
      timeoutMs: 5000,
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Notification title' },
          message: { type: 'string', description: 'Notification message body' },
        },
        required: ['title', 'message'],
      },
      execute: async (args: Record<string, unknown>) => {
        const title = args.title as string;
        const message = args.message as string;
        if (!title) return { error: 'title is required' };
        if (!message) return { error: 'message is required' };
        try {
          const result = await deps.sendNotification(title, message);
          return { sent: result.sent };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'start_process',
      description:
        'Start a background process. The command is split into executable and args to avoid shell injection. Dangerous commands are blocked.',
      timeoutMs: 10000,
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Executable command to run' },
          args: {
            type: 'array',
            description: 'Array of argument strings (default: [])',
            items: { type: 'string' },
          },
          cwd: {
            type: 'string',
            description: 'Working directory for the process (default: current directory)',
          },
        },
        required: ['command'],
      },
      execute: async (args: Record<string, unknown>) => {
        const command = args.command as string;
        const procArgs = (args.args as string[]) ?? [];
        const cwd = args.cwd as string | undefined;
        if (!command) return { error: 'command is required' };
        try {
          const result = await deps.startProcess(command, procArgs, cwd);
          return { pid: result.pid };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'kill_process',
      description:
        'Kill a process by PID. System processes (PID < 100) are protected and cannot be killed.',
      timeoutMs: 5000,
      parameters: {
        type: 'object',
        properties: {
          pid: { type: 'integer', description: 'Process ID to kill' },
        },
        required: ['pid'],
      },
      execute: async (args: Record<string, unknown>) => {
        const pid = args.pid as number;
        if (pid === undefined || pid === null) return { error: 'pid is required' };
        try {
          const result = await deps.killProcess(pid);
          return { killed: result.killed, error: result.error };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'show_open_dialog',
      description:
        'Show a native file open dialog. Only available in desktop mode; returns an error in server-only mode.',
      timeoutMs: 60000,
      parameters: {
        type: 'object',
        properties: {
          multiple: {
            type: 'boolean',
            description: 'Allow selecting multiple files (default: false)',
          },
          filters: {
            type: 'array',
            description: 'File type filters, e.g. [{ name: "Images", extensions: ["png", "jpg"] }]',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                extensions: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
      execute: async (args: Record<string, unknown>) => {
        const multiple = args.multiple === true;
        const filters = args.filters as { name: string; extensions: string[] }[] | undefined;
        try {
          const result = await deps.showOpenDialog({ multiple, filters });
          return { paths: result.paths, error: result.error };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
  ];
}
