import { spawn, type SpawnOptions } from 'node:child_process';

export const isWindows = process.platform === 'win32';

export function spawnCrossPlatform(command: string, args: string[], options: SpawnOptions = {}) {
  return spawn(command, args, { shell: isWindows, ...options });
}
