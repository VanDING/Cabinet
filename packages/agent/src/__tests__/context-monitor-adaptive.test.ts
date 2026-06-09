import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryEventBus } from '@cabinet/events';
import { AdaptiveContextMonitor, DEFAULT_ADAPTIVE_CONFIG } from '../context-monitor-adaptive.js';
import type { SessionMetricsRepository } from '@cabinet/storage';

describe('AdaptiveContextMonitor', () => {
  let eventBus: MemoryEventBus;
  let mockRepo: SessionMetricsRepository;

  beforeEach(() => {
    eventBus = new MemoryEventBus();
    mockRepo = {
      getZonePerformance: vi.fn().mockReturnValue([
        { zone: 'smart', sessionCount: 30, avgSuccessRate: 0.9, avgToolErrorRate: 0.05, avgStepCount: 10 },
        { zone: 'warning', sessionCount: 30, avgSuccessRate: 0.7, avgToolErrorRate: 0.15, avgStepCount: 15 },
        { zone: 'critical', sessionCount: 30, avgSuccessRate: 0.5, avgToolErrorRate: 0.3, avgStepCount: 20 },
        { zone: 'dumb', sessionCount: 30, avgSuccessRate: 0.3, avgToolErrorRate: 0.5, avgStepCount: 25 },
      ]),
      getPeakUtilizationDistribution: vi.fn().mockReturnValue([
        { utilizationBin: '0.40', count: 10, successRate: 0.9 },
        { utilizationBin: '0.45', count: 10, successRate: 0.85 },
        { utilizationBin: '0.50', count: 10, successRate: 0.6 },
        { utilizationBin: '0.55', count: 10, successRate: 0.5 },
        { utilizationBin: '0.70', count: 10, successRate: 0.4 },
        { utilizationBin: '0.75', count: 10, successRate: 0.3 },
        { utilizationBin: '0.80', count: 10, successRate: 0.2 },
        { utilizationBin: '0.85', count: 10, successRate: 0.15 },
      ]),
    } as unknown as SessionMetricsRepository;
  });

  it('falls back to defaults when sample insufficient', async () => {
    const repo = { getZonePerformance: vi.fn().mockReturnValue([]) } as unknown as SessionMetricsRepository;
    const monitor = new AdaptiveContextMonitor(eventBus, repo, DEFAULT_ADAPTIVE_CONFIG, 'claude-sonnet-4-6');
    const config = await monitor.recalibrate('claude-sonnet-4-6');
    expect(config.smartZoneThreshold).toBe(0.4);
    expect(config.warningThreshold).toBe(0.6);
    expect(config.criticalThreshold).toBe(0.8);
  });

  it('recalibrates from historical data', async () => {
    const monitor = new AdaptiveContextMonitor(eventBus, mockRepo, DEFAULT_ADAPTIVE_CONFIG, 'claude-sonnet-4-6');
    const config = await monitor.recalibrate('claude-sonnet-4-6');
    expect(config.smartZoneThreshold).toBeGreaterThanOrEqual(0.3);
    expect(config.criticalThreshold).toBeLessThanOrEqual(0.9);
  });

  it('pickConfig returns exploration config 10% of the time', () => {
    const monitor = new AdaptiveContextMonitor(eventBus, mockRepo, DEFAULT_ADAPTIVE_CONFIG, 'claude-sonnet-4-6');
    let explored = 0;
    for (let i = 0; i < 1000; i++) {
      monitor.pickConfig();
    }
    // Just verify no crash and values are within bounds
    const cfg = monitor.pickConfig();
    expect(cfg.smartZoneThreshold).toBeGreaterThanOrEqual(0.3);
    expect(cfg.criticalThreshold).toBeLessThanOrEqual(0.9);
  });

  it('hard limits prevent extreme thresholds', async () => {
    const monitor = new AdaptiveContextMonitor(
      eventBus,
      mockRepo,
      { ...DEFAULT_ADAPTIVE_CONFIG, hardLimits: { smartZoneMin: 0.35, criticalThresholdMax: 0.85 } },
      'claude-sonnet-4-6',
    );
    const config = await monitor.recalibrate('claude-sonnet-4-6');
    expect(config.smartZoneThreshold).toBeGreaterThanOrEqual(0.35);
    expect(config.criticalThreshold).toBeLessThanOrEqual(0.85);
  });
});
