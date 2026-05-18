export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  namespace: string;
  traceId?: string;
  sessionId?: string;
  context?: Record<string, unknown>;
}

let globalTraceId: string | undefined;
let globalSessionId: string | undefined;

export function setLogTraceId(id: string | undefined): void {
  globalTraceId = id;
}

export function setLogSessionId(id: string | undefined): void {
  globalSessionId = id;
}

const jsonFormat = process.env.LOG_FORMAT === 'json';

export class Logger {
  private buffer: LogEntry[] = [];
  private readonly maxBuffer = 1000;

  constructor(private readonly namespace: string) {}

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      namespace: this.namespace,
      traceId: globalTraceId,
      sessionId: globalSessionId,
      context,
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

  getEntries(level?: LogLevel): LogEntry[] {
    return level ? this.buffer.filter((e) => e.level === level) : [...this.buffer];
  }

  clear(): void {
    this.buffer = [];
  }
}

// Singleton factory
const loggers = new Map<string, Logger>();
export function getLogger(namespace: string): Logger {
  let logger = loggers.get(namespace);
  if (!logger) {
    logger = new Logger(namespace);
    loggers.set(namespace, logger);
  }
  return logger;
}
