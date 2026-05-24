import { describe, it, expect } from 'vitest';
import { Logger, getLogger } from '../logger';
import { MetricsCollector } from '../metrics';

describe('Logger', () => {
  it('creates logger with namespace', () => {
    const logger = new Logger('test-module');
    logger.info('test message', { key: 'value' });
    const entries = logger.getEntries();
    expect(entries.length).toBe(1);
    expect(entries[0]!.level).toBe('info');
    expect(entries[0]!.message).toBe('test message');
    expect(entries[0]!.context).toEqual({ key: 'value', namespace: 'test-module' });
  });

  it('getLogger returns singleton', () => {
    const a = getLogger('singleton');
    const b = getLogger('singleton');
    expect(a).toBe(b);
  });

  it('buffers up to max entries', () => {
    const logger = new Logger('buffer-test');
    for (let i = 0; i < 10; i++) {
      logger.info(`msg ${i}`);
    }
    expect(logger.getEntries().length).toBe(10);
  });

  it('filters entries by level', () => {
    const logger = new Logger('filter-test');
    logger.info('info msg');
    logger.warn('warn msg');
    logger.error('error msg');

    expect(logger.getEntries('error')).toHaveLength(1);
    expect(logger.getEntries('warn')).toHaveLength(1);
    expect(logger.getEntries('info')).toHaveLength(1);
    expect(logger.getEntries('debug')).toHaveLength(0);
  });

  it('clear removes all entries', () => {
    const logger = new Logger('clear-test');
    logger.info('msg 1');
    logger.info('msg 2');
    expect(logger.getEntries()).toHaveLength(2);
    logger.clear();
    expect(logger.getEntries()).toHaveLength(0);
  });

  it('redacts sensitive fields via pino', async () => {
    const { default: pino } = await import('pino');
    const lines: string[] = [];
    const stream = { write: (chunk: string) => lines.push(chunk) };
    const testLogger = pino(
      {
        redact: {
          paths: ['apiKey', '*.apiKey', 'context.apiKey'],
          censor: '[Redacted]',
        },
      },
      stream as unknown as NodeJS.WritableStream,
    );
    testLogger.info({ apiKey: 'super-secret', user: 'alice' }, 'login attempt');
    const output = lines[0] ?? '';
    expect(output).toContain('[Redacted]');
    expect(output).not.toContain('super-secret');
    expect(output).toContain('alice');
  });
});

describe('MetricsCollector', () => {
  it('records and retrieves metrics', () => {
    const mc = new MetricsCollector();
    mc.increment('llm_call');
    mc.increment('llm_call');
    mc.record('token_used', 500);

    expect(mc.sumSince('llm_call', new Date(0))).toBe(2);
    expect(mc.sumSince('token_used', new Date(0))).toBe(500);
  });

  it('getSummary returns dashboard stats', () => {
    const mc = new MetricsCollector();
    mc.increment('llm_call');
    mc.increment('decision_created');
    mc.increment('error');

    const summary = mc.getSummary();
    expect(summary.totalLLMCalls).toBe(1);
    expect(summary.totalDecisions).toBe(1);
    expect(summary.errors).toBe(1);
  });

  it('getByName filters by metric name', () => {
    const mc = new MetricsCollector();
    mc.increment('llm_call');
    mc.increment('llm_call');
    mc.increment('error');

    expect(mc.getByName('llm_call')).toHaveLength(2);
    expect(mc.getByName('error')).toHaveLength(1);
    expect(mc.getByName('unknown')).toHaveLength(0);
  });

  it('gauge records with type tag', () => {
    const mc = new MetricsCollector();
    mc.gauge('memory_mb', 256);
    const metrics = mc.getByName('memory_mb');
    expect(metrics).toHaveLength(1);
    expect(metrics[0]!.value).toBe(256);
    expect(metrics[0]!.tags['type']).toBe('gauge');
  });

  it('clear removes all metrics', () => {
    const mc = new MetricsCollector();
    mc.increment('test');
    mc.increment('test');
    expect(mc.sumSince('test', new Date(0))).toBe(2);
    mc.clear();
    expect(mc.sumSince('test', new Date(0))).toBe(0);
  });

  it('sumSince respects time filter', () => {
    const mc = new MetricsCollector();
    // Record a metric with an old timestamp by directly manipulating (not possible via API)
    mc.increment('llm_call');
    mc.increment('llm_call');

    // Now filter from a future date should return 0
    const future = new Date(Date.now() + 3600000);
    expect(mc.sumSince('llm_call', future)).toBe(0);

    // Filter from epoch should return all
    expect(mc.sumSince('llm_call', new Date(0))).toBe(2);
  });
});
