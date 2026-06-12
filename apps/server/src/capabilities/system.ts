import { spawn } from 'node:child_process';
import notifier from 'node-notifier';
import { detectDangerousCommand } from '../utils/security.js';
import { execAsync } from './helpers.js';

export function createSystemCapabilities(_isDesktopMode = false) {
  return {
    readClipboard: async () => {
      const { stdout } = await execAsync('powershell -Command "Get-Clipboard"', { timeout: 5000 });
      return { text: stdout.trim() };
    },
    writeClipboard: async (text: string) => {
      await execAsync(`echo ${text.replace(/"/g, '\\"')} | clip`, { timeout: 5000 });
      return { written: true };
    },
    sendNotification: async (title: string, message: string) => {
      notifier.notify({ title, message });
      return { sent: true };
    },
    startProcess: async (command: string, args?: string[], cwd?: string) => {
      const fullCommand = args ? `${command} ${args.join(' ')}` : command;
      const blocked = detectDangerousCommand(fullCommand);
      if (blocked) throw new Error(`Command blocked for safety: ${blocked}`);

      const child = spawn(command, args ?? [], {
        cwd,
        detached: true,
        shell: false,
        windowsHide: true,
      });
      return { pid: child.pid! };
    },
    killProcess: async (pid: number) => {
      if (pid < 100) throw new Error('Refusing to kill system process');
      try {
        process.kill(pid);
        return { killed: true };
      } catch (e: unknown) {
        return { killed: false, error: (e as Error).message };
      }
    },
    showOpenDialog: async (_options?: {
      multiple?: boolean;
      filters?: { name: string; extensions: string[] }[];
    }) => {
      return {
        paths: [],
        error: 'Dialog only available in desktop mode. Use read_file with a known path instead.',
      };
    },
  };
}
