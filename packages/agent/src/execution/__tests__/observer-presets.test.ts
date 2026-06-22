import { describe, it, expect } from 'vitest';
import {
  resolveObserverActivation,
  getObserverPresetDefaults,
  DEFAULT_OBSERVER_PRESET,
  type ObserverActivationInput,
} from '../observer-presets.js';

describe('resolveObserverActivation', () => {
  it('uses standard preset by default', () => {
    const result = resolveObserverActivation({});
    expect(result.preset).toBe(DEFAULT_OBSERVER_PRESET);
    expect(result.reflection).toBe(true);
    expect(result.judge).toBe(false);
    expect(result.autoReplan).toBe(false);
    expect(result.selfConsistency).toBe(false);
  });

  it.each<[import('../observer-presets.js').ObserverPresetName, boolean[]]>([
    ['minimal', [false, false, false, false]],
    ['standard', [true, false, false, false]],
    ['enhanced', [true, true, true, false]],
    ['full', [true, true, true, true]],
  ])(
    'preset %s has expected defaults',
    (preset, [reflection, judge, autoReplan, selfConsistency]) => {
      const result = resolveObserverActivation({ preset });
      expect(result.preset).toBe(preset);
      expect(result.reflection).toBe(reflection);
      expect(result.judge).toBe(judge);
      expect(result.autoReplan).toBe(autoReplan);
      expect(result.selfConsistency).toBe(selfConsistency);
    },
  );

  it('explicit enabled=false overrides preset default', () => {
    const result = resolveObserverActivation({
      preset: 'full',
      reflection: { enabled: false },
      judge: { enabled: false, sampleRate: 0.5 },
    });
    expect(result.reflection).toBe(false);
    expect(result.judge).toBe(false);
  });

  it('config presence implies enabled by default (default activation)', () => {
    const result = resolveObserverActivation({
      preset: 'minimal',
      judge: { sampleRate: 0.2 },
      autoReplan: { errorThreshold: 1 },
      selfConsistency: { samples: 5 },
    });
    expect(result.judge).toBe(true);
    expect(result.autoReplan).toBe(true);
    expect(result.selfConsistency).toBe(true);
  });
});

describe('getObserverPresetDefaults', () => {
  it('returns the configured defaults for each preset', () => {
    expect(getObserverPresetDefaults('minimal')).toEqual({
      reflection: false,
      judge: false,
      autoReplan: false,
      selfConsistency: false,
    });
    expect(getObserverPresetDefaults('full')).toEqual({
      reflection: true,
      judge: true,
      autoReplan: true,
      selfConsistency: true,
    });
  });
});
