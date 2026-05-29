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
import { zen } from './zen';
import { memphis } from './memphis';
import { brutalism } from './brutalism';
import { bauhaus } from './bauhaus';

export const registry: Theme[] = [lightDefault, darkDefault, pixelBY, warm, geek, glass, cyberpunk, vaporwave, zen, memphis, brutalism, bauhaus];

export const defaultTheme = lightDefault;

export function getTheme(id: string): Theme | undefined {
  return registry.find((t) => t.id === id);
}
