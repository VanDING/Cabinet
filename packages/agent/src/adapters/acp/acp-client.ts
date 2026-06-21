import { spawn, type ChildProcess } from 'node:child_process';
import { isWindows } from '../../utils/spawn.js';

interface AcpRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}
interface AcpNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}
interface AcpResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export class AcpClient {
  private proc: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private buffer = '';
  private updateHandler?: (update: unknown) => void;

  constructor(
    private command: string,
    private args: string[],
    private env?: Record<string, string>,
  ) {}

  async connect(): Promise<void> {
    this.proc = spawn(this.command, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.env },
      shell: isWindows,
    });
    this.proc.stdout?.setEncoding('utf-8');
    this.proc.stdout?.on('data', (chunk: string) => this.onData(chunk));
    this.proc.on('error', (err) => {
      for (const { reject } of this.pending.values()) reject(err);
      this.pending.clear();
    });
    await this.request('initialize', { protocolVersion: 1, clientCapabilities: {} });
  }

  onUpdate(handler: (update: unknown) => void): void {
    this.updateHandler = handler;
  }

  async newSession(cwd: string, mcpServers?: unknown): Promise<string> {
    const result = (await this.request('session/new', { cwd, mcpServers })) as {
      sessionId: string;
    };
    return result.sessionId;
  }

  async prompt(sessionId: string, message: string): Promise<void> {
    this.sendNotification('session/prompt', { sessionId, message });
  }

  async cancel(sessionId: string): Promise<void> {
    this.sendNotification('session/cancel', { sessionId });
  }

  async disconnect(): Promise<void> {
    this.proc?.stdin?.end();
    this.proc?.kill('SIGTERM');
    this.proc = null;
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as AcpResponse | AcpNotification;
        if ('id' in msg && msg.id !== undefined) {
          const waiter = this.pending.get(msg.id);
          if (waiter) {
            this.pending.delete(msg.id);
            if (msg.error) waiter.reject(new Error(msg.error.message));
            else waiter.resolve(msg.result);
          }
        } else if ('method' in msg) {
          if ((msg as AcpNotification).method === 'session/update') {
            this.updateHandler?.(msg.params);
          }
        }
      } catch {
        /* not JSON — ignore line */
      }
    }
  }

  private request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    const req: AcpRequest = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc?.stdin?.write(JSON.stringify(req) + '\n');
    });
  }

  private sendNotification(method: string, params?: unknown): void {
    const notif: AcpNotification = { jsonrpc: '2.0', method, params };
    this.proc?.stdin?.write(JSON.stringify(notif) + '\n');
  }
}
