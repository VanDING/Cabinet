import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

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

const LOG_DIR = join(homedir(), '.cabinet', 'logs');
const LOG_FILE = process.env.LOG_FILE ?? join(LOG_DIR, 'cabinet.log');
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_ROTATED_FILES = 5;

function rotateLogFile(): void {
  if (!existsSync(LOG_FILE)) return;
  const size = statSync(LOG_FILE).size;
  if (size < MAX_FILE_SIZE) return;

  for (let i = MAX_ROTATED_FILES - 1; i >= 0; i--) {
    const oldPath = i === 0 ? LOG_FILE : `${LOG_FILE}.${i}`;
    const newPath = `${LOG_FILE}.${i + 1}`;
    if (existsSync(oldPath)) {
      if (i === MAX_ROTATED_FILES - 1) {
        try { require('node:fs').unlinkSync(oldPath); } catch { /* ignore */ }
      } else {
        try { renameSync(oldPath, newPath); } catch { /* ignore */ }
      }
    }
  }
  try { renameSync(LOG_FILE, `${LOG_FILE}.1`); } catch { /* ignore */ }
}

function writeToFile(entry: LogEntry): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
  } catch { /* directory exists */ }

  try {
    const line = jsonFormat
      ? JSON.stringify(entry) + '\n'
      : `${entry.timestamp} [${entry.level.toUpperCase()}] ${entry.namespace}: ${entry.message}${entry.context ? ' ' + JSON.stringify(entry.context) : ''}\n`;
    appendFileSync(LOG_FILE, line, 'utf-8');
    rotateLogFile();
  } catch { /* file write failure is non-fatal */ }
}

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
    // Level filtering: skip if below configured minimum
    if (LOG_LEVEL_PRIORITY[level] < minLevel) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      namespace: this.namespace,
      traceId: this.instanceTraceId ?? globalTraceId,
      sessionId: this.instanceSessionId ?? globalSessionId,
      context: context ? { ...context, namespace: this.namespace } : undefined,
    };

    // Buffer
    this.buffer.push(entry);
    if (this.buffer.length > this.maxBuffer) {
      this.buffer.shift();
    }

    // Console output
    if (jsonFormat) {
      const json = JSON.stringify(entry);
      switch (level) {
        case 'error': console.error(json); break;
        case 'warn': console.warn(json); break;
        case 'debug': console.debug(json); break;
        default: console.log(json); break;
      }
    } else {
      const ctxStr = context ? ' ' + JSON.stringify(context) : '';
      const traceStr = entry.traceId ? ` [trace=${entry.traceId}]` : '';
      const output = `${entry.timestamp} [${level.toUpperCase()}] ${this.namespace}${traceStr}: ${message}${ctxStr}`;
      switch (level) {
        case 'error': console.error(output); break;
        case 'warn': console.warn(output); break;
        case 'debug': console.debug(output); break;
        default: console.log(output); break;
      }
    }

    // File output
    writeToFile(entry);
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

  /** Flush buffered entries. Returns immediately (file writes are sync). */
  async flush(): Promise<void> {
    // File writes are synchronous via appendFileSync, so the buffer
    // is already on disk. Console output is also synchronous.
    // This method exists for API symmetry with async transports.
    return Promise.resolve();
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
