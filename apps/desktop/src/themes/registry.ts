// apps/desktop/src/themes/registry.ts
import type { Theme } from './types';
import { lightDefault } from './light-default';
import { darkDefault } from './dark-default';

export const registry: Theme[] = [lightDefault, darkDefault];

export const defaultTheme = lightDefault;

export function getTheme(id: string): Theme | undefined {
  return registry.find((t) => t.id === id);
}
