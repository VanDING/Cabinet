import { getSkillRegistry } from '../skill-registry.js';
import type { ToolExecutor } from '../tool-executor.js';

/** Register per-skill tools (use_skill__name) from the SkillRegistry. */
export function registerSkillTools(executor: ToolExecutor): ToolExecutor {
  const registry = getSkillRegistry();
  const skillTools = registry.getToolDefinitions();
  for (const tool of skillTools) {
    executor.register(tool);
  }

  // Also register the generic use_skill dispatcher
  executor.register({
    name: 'use_skill',
    parameters: {
      type: 'object',
      properties: {
        skill: { type: 'string', description: 'Name of the skill to invoke' },
        arguments: { type: 'string', description: 'Arguments to pass to the skill (optional)' },
      },
      required: ['skill'],
    },
    execute: async (args: Record<string, unknown>) => {
      const skillName = args.skill as string;
      if (!skillName) return { error: 'skill name is required' };
      const skill = registry.load(skillName);
      if (!skill) return { error: `Skill not found: ${skillName}` };
      const result = await registry.executeSkill(skill, args);
      return result;
    },
  });

  // Register update_skill for in-place skill modification
  executor.register({
    name: 'update_skill',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the skill to update' },
        description: { type: 'string', description: 'Updated description' },
        promptTemplate: { type: 'string', description: 'Updated instruction body (Markdown)' },
        kind: { type: 'string', description: 'Updated kind: tool, prompt, or composite' },
      },
      required: ['name'],
    },
    execute: async (args: Record<string, unknown>) => {
      const skillName = args.name as string;
      if (!skillName) return { error: 'name is required' };
      const existing = registry.load(skillName);
      if (!existing) return { error: `Skill not found: ${skillName}` };
      const updated = {
        ...existing,
        description: (args.description as string) ?? existing.description,
        promptTemplate: (args.promptTemplate as string) ?? existing.promptTemplate,
        kind: (args.kind as 'tool' | 'prompt' | 'composite') ?? existing.kind,
        version: existing.version + 1,
      };
      registry.register(updated);
      return { updated: true, name: skillName, version: updated.version };
    },
  });

  return executor;
}
