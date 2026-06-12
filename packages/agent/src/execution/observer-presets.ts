import type { PISObserverConfig } from '../observers/process-identity-observer.js';
import type { ReflectionConfig } from '../observers/reflection.js';
import type { JudgeConfig } from '../observers/judge.js';
import type { AutoReplanConfig } from '../observers/auto-replan.js';
import type { SelfConsistencyConfig } from '../reasoning/self-consistency.js';

/** Supported observer pipeline presets.
 *  - minimal:    safety + tool execution only
 *  - standard:   minimal + context monitor, handoff, reflection
 *  - enhanced:   standard + judge (sample) + auto-replan (error-driven)
 *  - full:       all available observers + self-consistency engine
 */
export type ObserverPresetName = 'minimal' | 'standard' | 'enhanced' | 'full';

export interface ObserverPresetDefaults {
  reflection: boolean;
  judge: boolean;
  autoReplan: boolean;
  pis: boolean;
  selfConsistency: boolean;
}

export const DEFAULT_OBSERVER_PRESET: ObserverPresetName = 'standard';

const PRESET_DEFAULTS: Record<ObserverPresetName, ObserverPresetDefaults> = {
  minimal: {
    reflection: false,
    judge: false,
    autoReplan: false,
    pis: false,
    selfConsistency: false,
  },
  standard: {
    reflection: true,
    judge: false,
    autoReplan: false,
    pis: false,
    selfConsistency: false,
  },
  enhanced: {
    reflection: true,
    judge: true,
    autoReplan: true,
    pis: false,
    selfConsistency: false,
  },
  full: {
    reflection: true,
    judge: true,
    autoReplan: true,
    pis: true,
    selfConsistency: true,
  },
};

export interface ObserverActivationInput {
  preset?: ObserverPresetName;
  pis?: PISObserverConfig;
  reflection?: ReflectionConfig;
  judge?: JudgeConfig;
  autoReplan?: AutoReplanConfig;
  selfConsistency?: SelfConsistencyConfig;
}

/** Resolve whether each optional observer is active.
 *
 * Rules:
 *  1. If the config explicitly sets `enabled`, that wins.
 *  2. If a config object is provided without an explicit `enabled`, default to
 *     `true` ("default activation" — configuring an observer implies intent).
 *  3. Otherwise fall back to the preset's default.
 */
export function resolveObserverActivation(
  input: ObserverActivationInput,
): ObserverPresetDefaults & { preset: ObserverPresetName } {
  const preset = input.preset ?? DEFAULT_OBSERVER_PRESET;
  const defaults = PRESET_DEFAULTS[preset];

  const configured = (cfg: { enabled?: boolean } | undefined): boolean | undefined => {
    if (cfg === undefined) return undefined;
    return cfg.enabled ?? true;
  };

  return {
    preset,
    reflection: configured(input.reflection) ?? defaults.reflection,
    judge: configured(input.judge) ?? defaults.judge,
    autoReplan: configured(input.autoReplan) ?? defaults.autoReplan,
    pis: configured(input.pis) ?? defaults.pis,
    selfConsistency: configured(input.selfConsistency) ?? defaults.selfConsistency,
  };
}

/** Expose preset defaults for testing/documentation. */
export function getObserverPresetDefaults(preset: ObserverPresetName): ObserverPresetDefaults {
  return PRESET_DEFAULTS[preset];
}
