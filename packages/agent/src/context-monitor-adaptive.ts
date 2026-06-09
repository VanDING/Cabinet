import type { EventBus } from '@cabinet/events';
import {
  ContextMonitor,
  type ContextWindowConfig,
  DEFAULT_WINDOW_CONFIG,
  MODEL_CONTEXT_SIZES,
} from './context-monitor.js';
import type { SessionMetricsRepository } from '@cabinet/storage';

export interface AdaptiveThresholdConfig {
  enabled: boolean;
  explorationRate: number; // 0.0–1.0, default 0.1
  lookbackDays: number; // default 14
  minSamplesPerZone: number; // default 20
  hardLimits: {
    smartZoneMin: number; // default 0.3
    criticalThresholdMax: number; // default 0.9
  };
}

export const DEFAULT_ADAPTIVE_CONFIG: AdaptiveThresholdConfig = {
  enabled: false,
  explorationRate: 0.1,
  lookbackDays: 14,
  minSamplesPerZone: 20,
  hardLimits: {
    smartZoneMin: 0.3,
    criticalThresholdMax: 0.9,
  },
};

/**
 * Data-driven adaptive threshold monitor.
 * Learns optimal zone boundaries per (model, role) from historical
 * session_metrics + step_events data.
 */
export class AdaptiveContextMonitor extends ContextMonitor {
  private adaptiveConfig: AdaptiveThresholdConfig;
  private metricsRepo: SessionMetricsRepository;
  private currentConfig: ContextWindowConfig;
  private exploredConfig: ContextWindowConfig | null = null;

  constructor(
    eventBus: EventBus,
    metricsRepo: SessionMetricsRepository,
    config?: Partial<AdaptiveThresholdConfig>,
    model?: string,
  ) {
    const adaptiveConfig = { ...DEFAULT_ADAPTIVE_CONFIG, ...config };
    super(eventBus, {}, model);
    this.adaptiveConfig = adaptiveConfig;
    this.metricsRepo = metricsRepo;
    this.currentConfig = {
      maxTokens: MODEL_CONTEXT_SIZES[model ?? 'claude-sonnet-4-6'] ?? DEFAULT_WINDOW_CONFIG.maxTokens,
      smartZoneThreshold: DEFAULT_WINDOW_CONFIG.smartZoneThreshold,
      warningThreshold: DEFAULT_WINDOW_CONFIG.warningThreshold,
      criticalThreshold: DEFAULT_WINDOW_CONFIG.criticalThreshold,
    };
  }

  /** Recalibrate thresholds using historical data. */
  async recalibrate(model: string, role?: string): Promise<ContextWindowConfig> {
    const perf = this.metricsRepo.getZonePerformance({
      model,
      role,
      timeWindowDays: this.adaptiveConfig.lookbackDays,
    });

    if (perf.length < this.adaptiveConfig.minSamplesPerZone * 4) {
      return DEFAULT_WINDOW_CONFIG;
    }

    const distribution = this.metricsRepo.getPeakUtilizationDistribution(
      model,
      this.adaptiveConfig.lookbackDays,
    );

    const smartWarningBoundary = this.findInflectionPoint(distribution, 0.30, 0.55);
    const warningCriticalBoundary = this.findInflectionPoint(distribution, 0.55, 0.80);
    const criticalDumbBoundary = this.findInflectionPoint(distribution, 0.75, 0.92);

    this.currentConfig = {
      maxTokens: MODEL_CONTEXT_SIZES[model] ?? DEFAULT_WINDOW_CONFIG.maxTokens,
      smartZoneThreshold: Math.max(
        this.adaptiveConfig.hardLimits.smartZoneMin,
        smartWarningBoundary,
      ),
      warningThreshold: warningCriticalBoundary,
      criticalThreshold: Math.min(
        this.adaptiveConfig.hardLimits.criticalThresholdMax,
        criticalDumbBoundary,
      ),
    };

    return this.currentConfig;
  }

  /** Pick configuration for the next session (exploration vs exploitation). */
  pickConfig(): ContextWindowConfig {
    if (Math.random() < this.adaptiveConfig.explorationRate) {
      // Exploration: random offsets within ±10%, respecting hard limits
      const offset = () => (Math.random() - 0.5) * 0.2; // ±0.1
      this.exploredConfig = {
        ...this.currentConfig,
        smartZoneThreshold: Math.max(
          this.adaptiveConfig.hardLimits.smartZoneMin,
          Math.min(0.5, this.currentConfig.smartZoneThreshold + offset()),
        ),
        warningThreshold: Math.max(
          this.currentConfig.smartZoneThreshold + 0.05,
          Math.min(0.7, this.currentConfig.warningThreshold + offset()),
        ),
        criticalThreshold: Math.max(
          this.currentConfig.warningThreshold + 0.05,
          Math.min(
            this.adaptiveConfig.hardLimits.criticalThresholdMax,
            this.currentConfig.criticalThreshold + offset(),
          ),
        ),
      };
      return this.exploredConfig;
    }
    // Exploitation: use current best
    this.exploredConfig = null;
    return this.currentConfig;
  }

  /**
   * Find the utilization inflection point where successRate drops most steeply.
   * Returns the midpoint of the search range if data is insufficient.
   */
  private findInflectionPoint(
    distribution: { utilizationBin: string; count: number; successRate: number }[],
    minRange: number,
    maxRange: number,
  ): number {
    const filtered = distribution
      .map((d) => ({ ...d, binCenter: parseFloat(d.utilizationBin) }))
      .filter((d) => d.binCenter >= minRange && d.binCenter <= maxRange)
      .sort((a, b) => a.binCenter - b.binCenter);

    if (filtered.length < 3) {
      return (minRange + maxRange) / 2;
    }

    let maxDrop = 0;
    let inflectionBin = filtered[Math.floor(filtered.length / 2)]!.binCenter;

    for (let i = 1; i < filtered.length; i++) {
      const drop = filtered[i - 1]!.successRate - filtered[i]!.successRate;
      if (drop > maxDrop) {
        maxDrop = drop;
        inflectionBin = filtered[i]!.binCenter;
      }
    }

    // If no significant drop found, return midpoint as conservative estimate
    if (maxDrop < 0.05) {
      return (minRange + maxRange) / 2;
    }

    return inflectionBin;
  }
}
