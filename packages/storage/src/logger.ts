export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

export class Logger {
  private buffer: LogEntry[] = [];
  private readonly maxBuffer = 1000;

  constructor(private readonly namespace: string) {}

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: context ? { ...context, namespace: this.namespace } : { namespace: this.namespace },
    };

    // Buffer
    this.buffer.push(entry);
    if (this.buffer.length > this.maxBuffer) {
      this.buffer.shift();
    }

    // Console output (structured)
    const output = `${entry.timestamp} [${level.toUpperCase()}] ${this.namespace}: ${message}`;
    switch (level) {
      case 'error':
        console.error(output, context ?? '');
        break;
      case 'warn':
        console.warn(output, context ?? '');
        break;
      case 'debug':
        console.debug(output, context ?? '');
        break;
      default:
        console.log(output, context ?? '');
        break;
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
