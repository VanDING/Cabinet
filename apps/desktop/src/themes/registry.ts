// apps/desktop/src/themes/registry.ts
import type { Theme } from './types';

// Foundations
import { lightDefault } from './light-default';
import { darkDefault } from './dark-default';

// Warm Minimal
import { warm } from './warm';
import { brutalism } from './brutalism';

// Retro-Futurism
// Synth & Neon
import { synthwave } from './synthwave';
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

export const registry: Theme[] = [
  lightDefault,
  darkDefault,
  warm,
  brutalism,
  synthwave,
  cyberpunk,
  techno,
  polar,
  pixelBY,
  geek,
  afrofuturism,
  sumie,
];

export const defaultTheme = lightDefault;

export function getTheme(id: string): Theme | undefined {
  return registry.find((t) => t.id === id);
}
