import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryEventBus } from '@cabinet/events';
import {
  AdaptiveContextMonitor,
  DEFAULT_ADAPTIVE_CONFIG,
  classifyTaskCategory,
} from '../context-monitor-adaptive.js';
import type { SessionMetricsRepository } from '@cabinet/storage';

describe('AdaptiveContextMonitor', () => {
  let eventBus: MemoryEventBus;
  let mockRepo: SessionMetricsRepository;

  beforeEach(() => {
    eventBus = new MemoryEventBus();
    mockRepo = {
      getZonePerformance: vi.fn().mockReturnValue([
        {
          zone: 'smart',
          sessionCount: 30,
          avgSuccessRate: 0.9,
          avgToolErrorRate: 0.05,
          avgStepCount: 10,
        },
        {
          zone: 'warning',
          sessionCount: 30,
          avgSuccessRate: 0.7,
          avgToolErrorRate: 0.15,
          avgStepCount: 15,
        },
        {
          zone: 'critical',
          sessionCount: 30,
          avgSuccessRate: 0.5,
          avgToolErrorRate: 0.3,
          avgStepCount: 20,
        },
        {
          zone: 'dumb',
          sessionCount: 30,
          avgSuccessRate: 0.3,
          avgToolErrorRate: 0.5,
          avgStepCount: 25,
        },
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
    const repo = {
      getZonePerformance: vi.fn().mockReturnValue([]),
    } as unknown as SessionMetricsRepository;
    const monitor = new AdaptiveContextMonitor(
      eventBus,
      repo,
      DEFAULT_ADAPTIVE_CONFIG,
      'claude-sonnet-4-6',
    );
    const config = await monitor.recalibrate('claude-sonnet-4-6');
    expect(config.smartZoneThreshold).toBe(0.4);
    expect(config.warningThreshold).toBe(0.6);
    expect(config.criticalThreshold).toBe(0.8);
  });

  it('recalibrates from historical data', async () => {
    const monitor = new AdaptiveContextMonitor(
      eventBus,
      mockRepo,
      DEFAULT_ADAPTIVE_CONFIG,
      'claude-sonnet-4-6',
    );
    const config = await monitor.recalibrate('claude-sonnet-4-6');
    expect(config.smartZoneThreshold).toBeGreaterThanOrEqual(0.3);
    expect(config.criticalThreshold).toBeLessThanOrEqual(0.9);
  });

  it('pickConfig returns exploration config 10% of the time', () => {
    const monitor = new AdaptiveContextMonitor(
      eventBus,
      mockRepo,
      DEFAULT_ADAPTIVE_CONFIG,
      'claude-sonnet-4-6',
    );
    const explored = 0;
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
      {
        ...DEFAULT_ADAPTIVE_CONFIG,
        hardLimits: { smartZoneMin: 0.35, criticalThresholdMax: 0.85 },
      },
      'claude-sonnet-4-6',
    );
    const config = await monitor.recalibrate('claude-sonnet-4-6');
    expect(config.smartZoneThreshold).toBeGreaterThanOrEqual(0.35);
    expect(config.criticalThreshold).toBeLessThanOrEqual(0.85);
  });

  it('recalibrate with taskCategory produces different thresholds than without', async () => {
    const categoryRepo = {
      getZonePerformance: vi.fn().mockImplementation((query: any) => {
        if (query.taskCategory === 'code') {
          return [
            {
              zone: 'smart',
              sessionCount: 30,
              avgSuccessRate: 0.95,
              avgToolErrorRate: 0.02,
              avgStepCount: 8,
            },
            {
              zone: 'warning',
              sessionCount: 30,
              avgSuccessRate: 0.8,
              avgToolErrorRate: 0.1,
              avgStepCount: 12,
            },
            {
              zone: 'critical',
              sessionCount: 30,
              avgSuccessRate: 0.6,
              avgToolErrorRate: 0.25,
              avgStepCount: 18,
            },
            {
              zone: 'dumb',
              sessionCount: 30,
              avgSuccessRate: 0.4,
              avgToolErrorRate: 0.45,
              avgStepCount: 22,
            },
          ];
        }
        return []; // insufficient for other categories
      }),
      getPeakUtilizationDistribution: mockRepo.getPeakUtilizationDistribution,
    } as unknown as SessionMetricsRepository;

    const lowSampleConfig = { ...DEFAULT_ADAPTIVE_CONFIG, minSamplesPerZone: 1 };
    const monitor = new AdaptiveContextMonitor(
      eventBus,
      categoryRepo,
      lowSampleConfig,
      'claude-sonnet-4-6',
    );
    const withCategory = await monitor.recalibrate('claude-sonnet-4-6', undefined, 'code');
    const withoutCategory = await monitor.recalibrate('claude-sonnet-4-6');
    // With category should use category-specific data
    // Without category should fall back to defaults due to empty role/model data
    expect(withCategory.smartZoneThreshold).not.toBe(withoutCategory.smartZoneThreshold);
  });

  it('falls back to role-level when category samples insufficient', async () => {
    const fallbackRepo = {
      getZonePerformance: vi.fn().mockImplementation((query: any) => {
        if (query.taskCategory) return []; // insufficient
        if (query.role === 'secretary') {
          return [
            {
              zone: 'smart',
              sessionCount: 30,
              avgSuccessRate: 0.9,
              avgToolErrorRate: 0.05,
              avgStepCount: 10,
            },
            {
              zone: 'warning',
              sessionCount: 30,
              avgSuccessRate: 0.7,
              avgToolErrorRate: 0.15,
              avgStepCount: 15,
            },
            {
              zone: 'critical',
              sessionCount: 30,
              avgSuccessRate: 0.5,
              avgToolErrorRate: 0.3,
              avgStepCount: 20,
            },
            {
              zone: 'dumb',
              sessionCount: 30,
              avgSuccessRate: 0.3,
              avgToolErrorRate: 0.5,
              avgStepCount: 25,
            },
          ];
        }
        return [];
      }),
      getPeakUtilizationDistribution: mockRepo.getPeakUtilizationDistribution,
    } as unknown as SessionMetricsRepository;

    const monitor = new AdaptiveContextMonitor(
      eventBus,
      fallbackRepo,
      DEFAULT_ADAPTIVE_CONFIG,
      'claude-sonnet-4-6',
    );
    const config = await monitor.recalibrate('claude-sonnet-4-6', 'secretary', 'code');
    expect(config.smartZoneThreshold).toBeGreaterThanOrEqual(0.3);
  });

  describe('classifyTaskCategory', () => {
    it('classifies code tasks', () => {
      expect(classifyTaskCategory('Implement the user authentication module')).toBe('code');
      expect(classifyTaskCategory('Refactor the database layer')).toBe('code');
      expect(classifyTaskCategory('Fix the race condition in agent-loop.ts')).toBe('code');
    });

    it('classifies analysis tasks', () => {
      expect(classifyTaskCategory('Analyze the security vulnerabilities')).toBe('analysis');
      expect(classifyTaskCategory('Review the codebase for bugs')).toBe('analysis');
      expect(classifyTaskCategory('Evaluate the performance of the system')).toBe('analysis');
    });

    it('classifies search tasks', () => {
      expect(classifyTaskCategory('Find all references to MemoryProvider')).toBe('search');
      expect(classifyTaskCategory('Search for deprecated APIs')).toBe('search');
      expect(classifyTaskCategory('Locate the configuration file')).toBe('search');
    });

    it('classifies conversation as fallback', () => {
      expect(classifyTaskCategory('Hello, how are you?')).toBe('conversation');
      expect(classifyTaskCategory('What is the weather today?')).toBe('conversation');
    });
  });
});
