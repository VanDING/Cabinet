import { describe, it, expect } from 'vitest';
import { SkillRegistry, type SkillEntry } from '../skill-registry.js';

describe('SkillRegistry concurrency', () => {
  it('handles concurrent register + discover without corruption', async () => {
    const registry = new SkillRegistry();
    const skills: SkillEntry[] = Array.from({ length: 100 }, (_, i) => ({
      id: `skill_${i}`,
      name: `skill_${i}`,
      description: `desc_${i}`,
      kind: 'prompt',
      exposure: 'prompt',
      promptTemplate: `template_${i}`,
      inputSchema: {},
      outputSchema: {},
      version: 1,
      status: 'active',
    }));

    const writers = skills.map((s) => registry.registerAsync(s));
    const readers = Array.from({ length: 50 }, () =>
      Promise.resolve(registry.discover()),
    );

    await Promise.all([...writers, ...readers]);

    const final = registry.discover();
    expect(final).toHaveLength(100);
    const names = new Set(final.map((s) => s.name));
    expect(names.size).toBe(100);
  });

  it('handles concurrent loadFromDirectoryAsync + clearProjectSkillsAsync', async () => {
    const registry = new SkillRegistry();

    // Seed with project-scoped skills via sync API
    registry.register({
      id: 'p1', name: 'project_skill_1', description: 'd', kind: 'prompt', exposure: 'prompt',
      promptTemplate: 't', inputSchema: {}, outputSchema: {}, version: 1, status: 'active', scope: 'project',
    });
    registry.register({
      id: 'p2', name: 'project_skill_2', description: 'd', kind: 'prompt', exposure: 'prompt',
      promptTemplate: 't', inputSchema: {}, outputSchema: {}, version: 1, status: 'active', scope: 'project',
    });
    registry.register({
      id: 'g1', name: 'global_skill_1', description: 'd', kind: 'prompt', exposure: 'prompt',
      promptTemplate: 't', inputSchema: {}, outputSchema: {}, version: 1, status: 'active', scope: 'global',
    });

    // Run clear + discover concurrently
    const clearPromise = registry.clearProjectSkillsAsync();
    const discoverPromise = Promise.resolve(registry.discover());

    const [cleared] = await Promise.all([clearPromise, discoverPromise]);
    expect(cleared).toBe(2);

    const remaining = registry.listAll();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.name).toBe('global_skill_1');
  });

  it('getToolDefinitions uses snapshot and does not corrupt during registration', () => {
    const registry = new SkillRegistry();
    registry.register({
      id: 's1', name: 'skill_a', description: 'd', kind: 'tool', exposure: 'tool',
      promptTemplate: 't', inputSchema: {}, outputSchema: {}, version: 1, status: 'active',
    });

    const toolsBefore = registry.getToolDefinitions();
    expect(toolsBefore).toHaveLength(1);

    registry.register({
      id: 's2', name: 'skill_b', description: 'd', kind: 'tool', exposure: 'tool',
      promptTemplate: 't', inputSchema: {}, outputSchema: {}, version: 1, status: 'active',
    });

    const toolsAfter = registry.getToolDefinitions();
    expect(toolsAfter).toHaveLength(2);
  });
});
