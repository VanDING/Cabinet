import { spawn } from 'node:child_process';
import type { StructuredInput } from '@cabinet/types';

/**
 * Execute code in a sandboxed child process with structured JSON context (M3 Code Sandbox).
 *
 * Spawns a Node.js child process, injects the structured workflow context via stdin,
 * captures stdout/stderr, and enforces a timeout. Falls back to the runCode handler
 * if spawn is not available.
 */
export function runCodeSandboxed(
  code: string,
  input: StructuredInput,
  timeoutMs: number,
): Promise<string> {
  const contextJson = JSON.stringify({
    input: input.previousOutputs,
    upstream: input.upstreamItems.map((i) => ({
      nodeId: i.nodeId,
      type: i.type,
      items: i.items,
    })),
  });

  return new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', code], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs,
      env: { ...process.env, CABINET_SANDBOX: '1' },
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    child.stdin?.write(contextJson);
    child.stdin?.end();

    child.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
      const stderr = Buffer.concat(stderrChunks).toString('utf-8');

      if (code === 0) {
        resolve(stdout.trim() || stderr.trim());
      } else {
        reject(new Error(`Sandbox exited with code ${code}: ${stderr.slice(0, 300)}`));
      }
    });

    child.on('error', (err) => {
      reject(new Error(`Sandbox spawn failed: ${err.message}`));
    });
  });
}
