// apps/desktop/src/themes/registry.ts
import type { Theme } from './types';
import { lightDefault } from './light-default';
import { darkDefault } from './dark-default';
import { pixelBY } from './pixel-by';
import { warm } from './warm';
import { geek } from './geek';
import { glass } from './glass';
import { cyberpunk } from './cyberpunk';
import { vaporwave } from './vaporwave';

export const registry: Theme[] = [lightDefault, darkDefault, pixelBY, warm, geek, glass, cyberpunk, vaporwave];

export const defaultTheme = lightDefault;

export function getTheme(id: string): Theme | undefined {
  return registry.find((t) => t.id === id);
}
