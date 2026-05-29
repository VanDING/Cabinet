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
import { dieselpunk } from './dieselpunk';
import { techno } from './techno';
// Atmospheric & Mood
import { filmNoir } from './film-noir';
import { polar } from './polar';

// Gaming & Terminal
import { pixelBY } from './pixel-by';
import { geek } from './geek';

// Cultural
import { afrofuturism } from './afrofuturism';

export const registry: Theme[] = [
  lightDefault,
  darkDefault,
  warm,
  zen,
  brutalism,
  synthwave,
  vaporwave,
  cyberpunk,
  dieselpunk,
  techno,
  filmNoir,
  polar,
  pixelBY,
  geek,
  afrofuturism,
];

export const defaultTheme = lightDefault;

export function getTheme(id: string): Theme | undefined {
  return registry.find((t) => t.id === id);
}
