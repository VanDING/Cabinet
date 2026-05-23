import type { EventBus } from '@cabinet/events';
import { MessageType } from '@cabinet/types';

// ── Configuration ──────────────────────────────────────────────

export interface ContextWindowConfig {
  /** Model's maximum context window in tokens */
  maxTokens: number;
  /** Fraction of maxTokens this agent is allowed to use (0-1, default 1.0 = full window). */
  contextBudget?: number;
  /** Below this ratio: focused reasoning, accurate tool calls */
  smartZoneThreshold: number;
  /** Above this ratio: first warning level */
  warningThreshold: number;
  /** Above this ratio: critical — hallucinations, loops, format confusion */
  criticalThreshold: number;
}

/**
 * Dex Horthy's Smart/Dumb Zone model:
 *   0–40%   = Smart Zone  (focused reasoning, high quality)
 *   40–60%  = Warning      (degradation begins)
 *   60–80%  = Critical     (more hallucinations, going in circles)
 *   >80%    = Dumb Zone    (format confusion, worse code)
 */
export const DEFAULT_WINDOW_CONFIG: ContextWindowConfig = {
  maxTokens: 200_000, // Claude Sonnet 4.6 / Opus 4.7
  smartZoneThreshold: 0.4, // 40%
  warningThreshold: 0.6, // 60%
  criticalThreshold: 0.8, // 80%
};

/** Per-model context window sizes */
export const MODEL_CONTEXT_SIZES: Record<string, number> = {
  'claude-haiku-4-5': 200_000,
  'claude-sonnet-4-6': 200_000,
  'claude-opus-4-7': 200_000,
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4.1': 1_000_000,
  'deepseek-v4-pro': 1_000_000,
  'deepseek-v3': 128_000,
  'gemini-2.5-pro': 1_000_000,
  'gemini-2.5-flash': 1_000_000,
  'qwen-3': 128_000,
};

// ── Token Estimation ───────────────────────────────────────────

/**
 * Rough token estimation without a real tokenizer.
 * Uses character-based heuristics:
 *   - CJK characters: ~2 chars per token
 *   - English/other:   ~4 chars per token
 *   - Mixed text:      weighted average
 */
function estimateTokens(text: string): number {
  if (!text) return 0;

  let cjkChars = 0;
  let otherChars = 0;

  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (
      (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified
      (code >= 0x3400 && code <= 0x4dbf) || // CJK Ext-A
      (code >= 0x20000 && code <= 0x2a6df) || // CJK Ext-B
      (code >= 0xf900 && code <= 0xfaff) || // CJK Compat
      (code >= 0x3040 && code <= 0x309f) || // Hiragana
      (code >= 0x30a0 && code <= 0x30ff) || // Katakana
      (code >= 0xac00 && code <= 0xd7af) // Hangul
    ) {
      cjkChars++;
    } else {
      otherChars++;
    }
  }

  return Math.ceil(cjkChars / 2 + otherChars / 4);
}

// ── Snapshot ───────────────────────────────────────────────────

export type ContextZone = 'smart' | 'warning' | 'critical' | 'dumb';

export interface ContextBreakdown {
  systemPrompt: number;
  messages: number;
  toolResults: number;
  memory: number;
}

export interface ContextSnapshot {
  estimatedTokens: number;
  maxTokens: number;
  utilization: number; // 0.0 – 1.0
  zone: ContextZone;
  breakdown: ContextBreakdown;
  timestamp: Date;
}

// ── Monitor ────────────────────────────────────────────────────

export class ContextMonitor {
  private config: ContextWindowConfig;
  private lastSnapshot: ContextSnapshot | null = null;
  private zoneCrossings: { from: ContextZone; to: ContextZone; at: Date }[] = [];

  constructor(
    private readonly eventBus: EventBus,
    config?: Partial<ContextWindowConfig>,
  ) {
    this.config = { ...DEFAULT_WINDOW_CONFIG, ...config };
  }

  /** Pick context window size for a given model. */
  static forModel(model: string, eventBus: EventBus, contextBudget?: number): ContextMonitor {
    const maxTokens = MODEL_CONTEXT_SIZES[model] ?? DEFAULT_WINDOW_CONFIG.maxTokens;
    return new ContextMonitor(eventBus, { maxTokens, contextBudget });
  }

  /** Estimate tokens for a block of text. Public for external use (e.g. pre-call budgeting). */
  estimateTokens(text: string): number {
    return estimateTokens(text);
  }

  /** Take a snapshot of current context utilization. */
  snapshot(breakdown: ContextBreakdown): ContextSnapshot {
    const estimatedTokens =
      breakdown.systemPrompt + breakdown.messages + breakdown.toolResults + breakdown.memory;

    const budget = this.config.contextBudget ?? 1.0;
    const effectiveMaxTokens = this.config.maxTokens * budget;
    const utilization = estimatedTokens / effectiveMaxTokens;
    const zone = this.classifyZone(utilization);

    const snap: ContextSnapshot = {
      estimatedTokens,
      maxTokens: effectiveMaxTokens,
      utilization: Math.round(utilization * 10_000) / 10_000,
      zone,
      breakdown,
      timestamp: new Date(),
    };

    // Detect zone crossings
    if (this.lastSnapshot && this.lastSnapshot.zone !== zone) {
      this.zoneCrossings.push({
        from: this.lastSnapshot.zone,
        to: zone,
        at: new Date(),
      });
    }

    this.lastSnapshot = snap;

    // Emit event when crossing into warning+ territory
    if (zone === 'warning' || zone === 'critical' || zone === 'dumb') {
      this.eventBus
        .publish({
          messageId: `ctx_zone_${zone}_${Date.now()}`,
          correlationId: `ctx_${Date.now()}`,
          causationId: null,
          timestamp: new Date(),
          messageType: MessageType.SystemNotification,
          payload: {
            type: 'context_zone_alert',
            data: {
              zone,
              utilization: snap.utilization,
              estimatedTokens: snap.estimatedTokens,
              maxTokens: snap.maxTokens,
              breakdown: snap.breakdown,
            },
          },
        })
        .catch(() => {
          /* fire-and-forget */
        });
    }

    return snap;
  }

  /** Check whether the given utilization crosses into a risk zone. */
  classifyZone(utilization: number): ContextZone {
    if (utilization >= this.config.criticalThreshold) return 'dumb';
    if (utilization >= this.config.warningThreshold) return 'critical';
    if (utilization >= this.config.smartZoneThreshold) return 'warning';
    return 'smart';
  }

  /** Should the agent take corrective action based on current zone? */
  shouldCompact(snapshot: ContextSnapshot): boolean {
    return snapshot.zone === 'critical' || snapshot.zone === 'dumb';
  }

  /** Get a human-readable summary of the current context state. */
  summarize(): string {
    if (!this.lastSnapshot) return 'No context snapshot taken yet.';

    const s = this.lastSnapshot;
    const pct = (s.utilization * 100).toFixed(1);
    const zoneLabels: Record<ContextZone, string> = {
      smart: 'Smart Zone (0–40%)',
      warning: 'Warning Zone (40–60%)',
      critical: 'Critical Zone (60–80%)',
      dumb: 'Dumb Zone (>80%)',
    };

    return [
      `Context: ${s.estimatedTokens.toLocaleString()} / ${s.maxTokens.toLocaleString()} tokens (${pct}%)`,
      `Zone:   ${zoneLabels[s.zone]}`,
      `  system:  ${s.breakdown.systemPrompt.toLocaleString()}`,
      `  msgs:    ${s.breakdown.messages.toLocaleString()}`,
      `  tools:   ${s.breakdown.toolResults.toLocaleString()}`,
      `  memory:  ${s.breakdown.memory.toLocaleString()}`,
    ].join('\n');
  }

  /** How many times has the zone changed during this session? */
  get crossingCount(): number {
    return this.zoneCrossings.length;
  }

  /** The most recent snapshot, if any. */
  get current(): ContextSnapshot | null {
    return this.lastSnapshot;
  }
}
