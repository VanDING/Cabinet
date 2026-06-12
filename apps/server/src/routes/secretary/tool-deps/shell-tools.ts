import type { ServerContext } from '../../../context.js';
import { detectDangerousCommand } from '../../../utils/security.js';
import { resolveSafePath, buildSafeEnv } from '../../../capabilities/helpers.js';
import { execAsync } from '../../../capabilities/helpers.js';

export function buildShellTools(ctx: ServerContext) {
  return {
    execCommand: async (command: string, cwd?: string, timeout?: number) => {
      const blocked = detectDangerousCommand(command);
      if (blocked) throw new Error(`Command blocked for safety: ${blocked}`);
      const workDir = cwd ? await resolveSafePath(cwd) : process.cwd();

      const { stdout, stderr } = await execAsync(command, {
        cwd: workDir,
        timeout: timeout ?? 60000,
        maxBuffer: 10 * 1024 * 1024,
        env: buildSafeEnv(),
        shell: process.platform === 'win32' ? process.env.COMSPEC || 'cmd.exe' : '/bin/bash',
      });
      return { stdout, stderr, exitCode: 0 };
    },
  };
}
