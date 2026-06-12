import { spawn } from 'node:child_process';
import { detectDangerousCommand } from '../utils/security.js';
import type { CapabilitiesContext } from './types.js';
import {
  resolveSafePath,
  buildSafeEnv,
  parseCommand,
  isAllowedCommand,
  ALLOWED_COMMANDS,
} from './helpers.js';

export function createShellCapabilities(_ctx: CapabilitiesContext) {
  return {
    execCommand: async (command: string, cwd?: string, timeout?: number) => {
      // 1. Also run the blacklist as secondary defense
      const blocked = detectDangerousCommand(command);
      if (blocked) throw new Error(`Command blocked for safety: ${blocked}`);

      // 2. Parse into [cmd, ...args], reject shell metacharacters
      const parts = parseCommand(command);
      if (!parts || parts.length === 0) {
        throw new Error(
          'Shell metacharacters not allowed. Use simple command with space-separated arguments.',
        );
      }
      const [cmd, ...args] = parts;

      // 3. Allowlist check
      if (!isAllowedCommand(cmd!, args)) {
        throw new Error(
          `Command '${cmd}' not in allowlist or sub-command restricted. Allowed: ${[...ALLOWED_COMMANDS].join(', ')}`,
        );
      }

      const workDir = cwd ? await resolveSafePath(cwd) : process.cwd();

      return new Promise<{ stdout: string; stderr: string; exitCode: number }>(
        (resolve, reject) => {
          const child = spawn(cmd!, args, {
            cwd: workDir,
            shell: false,
            env: buildSafeEnv(),
            timeout: timeout ?? 60000,
          });

          let stdout = '';
          let stderr = '';

          child.stdout?.on('data', (data: Buffer) => {
            stdout += data.toString();
          });
          child.stderr?.on('data', (data: Buffer) => {
            stderr += data.toString();
          });

          child.on('close', (code: number | null) => {
            resolve({ stdout, stderr, exitCode: code ?? 0 });
          });

          child.on('error', (err: Error) => {
            reject(new Error(`Command failed: ${err.message}`));
          });
        },
      );
    },
  };
}
