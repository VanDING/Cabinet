import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import pino from 'pino';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  namespace: string;
  traceId?: string;
  sessionId?: string;
  context?: Record<string, unknown>;
}

const jsonFormat = process.env.LOG_FORMAT === 'json';
const minLevelEnv = process.env.LOG_LEVEL as LogLevel | undefined;
const minLevel: number = minLevelEnv && LOG_LEVEL_PRIORITY[minLevelEnv] !== undefined
  ? LOG_LEVEL_PRIORITY[minLevelEnv]
  : LOG_LEVEL_PRIORITY.info;
const pinoLevel = (['debug', 'info', 'warn', 'error'] as LogLevel[])[minLevel];

const LOG_DIR = join(homedir(), '.cabinet', 'logs');
const LOG_FILE = process.env.LOG_FILE ?? join(LOG_DIR, 'cabinet.log');

// Ensure log directory exists before pino-roll tries to create files
try {
  mkdirSync(LOG_DIR, { recursive: true });
} catch { /* directory exists or read-only */ }

// Resolve pino-roll path for worker-thread transport (pnpm-safe)
const require = createRequire(import.meta.url);
const pinoRollPath = require.resolve('pino-roll');

const rootPino = pino({
  level: pinoLevel,
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'apiKey',
      'password',
      'token',
      'secret',
      '*.apiKey',
      '*.password',
      '*.token',
      '*.secret',
      'context.apiKey',
      'context.password',
      'context.token',
      'context.secret',
    ],
    censor: '[Redacted]',
  },
}, pino.transport({
  targets: [
    jsonFormat || process.env.NODE_ENV === 'production'
      ? { target: 'pino/file', level: pinoLevel }
      : { target: 'pino-pretty', options: { colorize: true, translateTime: true }, level: pinoLevel },
    {
      target: pinoRollPath,
      options: {
        file: LOG_FILE,
        size: '10m',
        limit: { count: 5 },
        mkdir: true,
      },
      level: pinoLevel,
    },
  ] as any[],
}));

let globalTraceId: string | undefined;
let globalSessionId: string | undefined;

export function setLogTraceId(id: string | undefined): void {
  globalTraceId = id;
}

export function setLogSessionId(id: string | undefined): void {
  globalSessionId = id;
}

export class Logger {
  private buffer: LogEntry[] = [];
  private readonly maxBuffer = 1000;
  private instanceTraceId?: string;
  private instanceSessionId?: string;

  constructor(
    private readonly namespace: string,
    opts?: { traceId?: string; sessionId?: string },
  ) {
    this.instanceTraceId = opts?.traceId;
    this.instanceSessionId = opts?.sessionId;
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (LOG_LEVEL_PRIORITY[level] < minLevel) return;

    const traceId = this.instanceTraceId ?? globalTraceId;
    const sessionId = this.instanceSessionId ?? globalSessionId;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      namespace: this.namespace,
      traceId,
      sessionId,
      context: context ? { ...context, namespace: this.namespace } : undefined,
    };

    this.buffer.push(entry);
    if (this.buffer.length > this.maxBuffer) {
      this.buffer.shift();
    }

    const bindings: Record<string, unknown> = {
      ...(context ?? {}),
      namespace: this.namespace,
    };
    if (traceId) bindings.traceId = traceId;
    if (sessionId) bindings.sessionId = sessionId;

    switch (level) {
      case 'debug': rootPino.debug(bindings, message); break;
      case 'warn': rootPino.warn(bindings, message); break;
      case 'error': rootPino.error(bindings, message); break;
      default: rootPino.info(bindings, message); break;
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log('error', message, context);
  }

  /** Flush buffered entries and underlying pino transports. */
  async flush(): Promise<void> {
    return new Promise((resolve) => rootPino.flush(() => resolve()));
  }

  getEntries(level?: LogLevel): LogEntry[] {
    return level ? this.buffer.filter((e) => e.level === level) : [...this.buffer];
  }

  clear(): void {
    this.buffer = [];
  }
}

// Singleton factory
const loggers = new Map<string, Logger>();
export function getLogger(
  namespace: string,
  opts?: { traceId?: string; sessionId?: string },
): Logger {
  // When per-request opts are provided, create a new instance rather than caching
  if (opts?.traceId || opts?.sessionId) {
    return new Logger(namespace, opts);
  }
  let logger = loggers.get(namespace);
  if (!logger) {
    logger = new Logger(namespace);
    loggers.set(namespace, logger);
  }
  return logger;
}
