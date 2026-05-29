// apps/desktop/src/themes/registry.ts
import type { Theme } from './types';
import { lightDefault } from './light-default';
import { darkDefault } from './dark-default';
import { pixelBY } from './pixel-by';

export const registry: Theme[] = [lightDefault, darkDefault, pixelBY];

export const defaultTheme = lightDefault;

export function getTheme(id: string): Theme | undefined {
  return registry.find((t) => t.id === id);
}
