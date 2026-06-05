/**
 * Layer 1: Shared utility tests — MetricsCollector unit tests.
 * Pure logic, no DB needed.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MetricsCollector } from '../metrics.js';

describe('MetricsCollector', () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = new MetricsCollector();
  });

  afterEach(() => {
    collector.stopPeriodicFlush();
  });

  describe('record', () => {
    it('adds a metric to the in-memory list', () => {
      collector.record('llm_call', 1, { model: 'claude' });
      const metrics = collector.getByName('llm_call');
      expect(metrics).toHaveLength(1);
      expect(metrics[0].value).toBe(1);
      expect(metrics[0].tags.model).toBe('claude');
      expect(metrics[0].timestamp).toBeInstanceOf(Date);
    });

    it('accumulates multiple records', () => {
      collector.record('llm_call', 1);
      collector.record('llm_call', 2);
      collector.record('llm_call', 3);
      expect(collector.getByName('llm_call')).toHaveLength(3);
    });

    it('supports tagless recording', () => {
      collector.record('error', 1);
      const m = collector.getByName('error');
      expect(m).toHaveLength(1);
      expect(m[0].tags).toEqual({});
    });
  });

  describe('increment', () => {
    it('records value 1', () => {
      collector.increment('request_count');
      const m = collector.getByName('request_count');
      expect(m).toHaveLength(1);
      expect(m[0].value).toBe(1);
    });

    it('accepts tags', () => {
      collector.increment('request_count', { endpoint: '/api/chat' });
      const m = collector.getByName('request_count');
      expect(m[0].tags.endpoint).toBe('/api/chat');
    });
  });

  describe('gauge', () => {
    it('records with type:gauge tag', () => {
      collector.gauge('memory_usage', 512);
      const m = collector.getByName('memory_usage');
      expect(m).toHaveLength(1);
      expect(m[0].value).toBe(512);
      expect(m[0].tags.type).toBe('gauge');
    });

    it('merges additional tags with gauge type', () => {
      collector.gauge('cpu', 75, { unit: 'percent' });
      const m = collector.getByName('cpu');
      expect(m[0].tags.type).toBe('gauge');
      expect(m[0].tags.unit).toBe('percent');
    });
  });

  describe('sumSince', () => {
    it('sums values matching a name since a given time', () => {
      const before = new Date(Date.now() - 1000);
      collector.record('token_used', 100);
      collector.record('token_used', 200);
      collector.record('token_used', 50);
      // record something else
      collector.record('llm_call', 1);

      expect(collector.sumSince('token_used', before)).toBe(350);
    });

    it('returns 0 for no matches', () => {
      expect(collector.sumSince('nonexistent', new Date(0))).toBe(0);
    });

    it('filters by timestamp correctly', () => {
      collector.record('old_metric', 10);
      // Query from a future timestamp should return 0
      const future = new Date(Date.now() + 10000);
      expect(collector.sumSince('old_metric', future)).toBe(0);
    });
  });

  describe('getByName', () => {
    it('returns empty array for no matches', () => {
      expect(collector.getByName('nonexistent')).toEqual([]);
    });

    it('returns only matching metrics', () => {
      collector.record('a', 1);
      collector.record('b', 2);
      collector.record('a', 3);
      const result = collector.getByName('a');
      expect(result).toHaveLength(2);
      expect(result.every((m) => m.name === 'a')).toBe(true);
    });
  });

  describe('getSummary', () => {
    it('returns zero defaults when no metrics recorded', () => {
      const summary = collector.getSummary();
      expect(summary).toEqual({
        totalLLMCalls: 0,
        totalTokens: 0,
        totalDecisions: 0,
        errors: 0,
      });
    });

    it('aggregates llm_call, token_used, decision_created, and error', () => {
      collector.record('llm_call', 5);
      collector.record('llm_call', 3);
      collector.record('token_used', 5000);
      collector.record('decision_created', 2);
      collector.record('error', 1);

      const summary = collector.getSummary();
      expect(summary.totalLLMCalls).toBe(8);   // 5 + 3
      expect(summary.totalTokens).toBe(5000);
      expect(summary.totalDecisions).toBe(2);
      expect(summary.errors).toBe(1);
    });
  });

  describe('clear', () => {
    it('removes all recorded metrics', () => {
      collector.record('x', 1);
      collector.record('y', 2);
      expect(collector.getByName('x')).toHaveLength(1);

      collector.clear();
      expect(collector.getByName('x')).toEqual([]);
      expect(collector.getByName('y')).toEqual([]);
      expect(collector.getSummary().totalLLMCalls).toBe(0);
    });
  });

  describe('startPeriodicFlush / stopPeriodicFlush', () => {
    it('startPeriodicFlush is a no-op without a repo', () => {
      // Should not throw
      collector.startPeriodicFlush();
      collector.stopPeriodicFlush();
    });

    it('stopPeriodicFlush is safe to call without start', () => {
      // Should not throw
      collector.stopPeriodicFlush();
    });

    it('startPeriodicFlush does not double-schedule', () => {
      collector.startPeriodicFlush();
      collector.startPeriodicFlush();
      collector.stopPeriodicFlush();
      // No assertion needed — just verifying no crash
    });
  });
});
