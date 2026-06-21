import { describe, it, expect } from 'vitest';
import { RECIPES } from '../scanner-recipe.js';

describe('RECIPES', () => {
  it('contains all 9 known agents', () => {
    expect(RECIPES).toHaveLength(9);
  });

  it.each(RECIPES.map((r) => [r.id, r.name] as const))(
    '%s (%s) has valid structure',
    (id, _name) => {
      const recipe = RECIPES.find((r) => r.id === id)!;
      expect(recipe.command).toBeTruthy();
      expect(recipe.detectArgs.length).toBeGreaterThan(0);
      expect(['acp', 'headless', 'terminal-only']).toContain(recipe.dispatch.protocol);
      expect(recipe.install.win32.length).toBeGreaterThan(0);
      expect(recipe.install.darwin.length).toBeGreaterThan(0);
      expect(recipe.install.linux.length).toBeGreaterThan(0);
      expect(recipe.projectorId).toBeTruthy();
    },
  );

  it('all dispatch protocols are valid', () => {
    for (const recipe of RECIPES) {
      expect(['acp', 'headless', 'terminal-only']).toContain(recipe.dispatch.protocol);
    }
  });
});
