// apps/desktop/src/themes/registry.ts
import type { Theme } from './types';

// Foundations
import { lightDefault } from './light-default';
import { darkDefault } from './dark-default';

// Warm Minimal
import { warm } from './warm';
import { zen } from './zen';
import { brutalism } from './brutalism';

// Retro-Futurism
// Synth & Neon
import { synthwave } from './synthwave';
import { vaporwave } from './vaporwave';
import { cyberpunk } from './cyberpunk';

// Dark Industrial
import { techno } from './techno';
// Atmospheric & Mood
import { polar } from './polar';

// Gaming & Terminal
import { pixelBY } from './pixel-by';
import { geek } from './geek';

// Cultural
import { afrofuturism } from './afrofuturism';

// Eastern Ink
import { sumie } from './sumi-e';

// Nostalgic
import { showaRetro } from './showa-retro';

export const registry: Theme[] = [
  lightDefault,
  darkDefault,
  warm,
  zen,
  brutalism,
  synthwave,
  vaporwave,
  cyberpunk,
  techno,
  polar,
  pixelBY,
  geek,
  afrofuturism,
  sumie,
  showaRetro,
];

export const defaultTheme = lightDefault;

export function getTheme(id: string): Theme | undefined {
  return registry.find((t) => t.id === id);
}
