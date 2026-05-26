import { describe, it, expect } from 'vitest';
import {
  WORKFLOW_DESIGNER_SKILL,
  AGENT_CREATOR_SKILL,
  SKILL_CREATOR_SKILL,
  MCP_BUILDER_SKILL,
  registerBuiltInSkills,
} from '../built-in-skills.js';
import { getSkillRegistry } from '../skill-registry.js';

describe('built-in skills', () => {
  it('should export all 4 skill entries with correct metadata', () => {
    expect(WORKFLOW_DESIGNER_SKILL.name).toBe('workflowDesigner');
    expect(WORKFLOW_DESIGNER_SKILL.kind).toBe('prompt');
    expect(WORKFLOW_DESIGNER_SKILL.status).toBe('active');

    expect(AGENT_CREATOR_SKILL.name).toBe('agentCreator');
    expect(SKILL_CREATOR_SKILL.name).toBe('skillCreator');
    expect(MCP_BUILDER_SKILL.name).toBe('mcpBuilder');
  });

  it('should register all 4 skills into SkillRegistry', () => {
    const registry = getSkillRegistry();
    // Clear any previous state
    for (const name of registry.listNames()) {
      registry.unregister(name);
    }
    registerBuiltInSkills();
    const names = registry.listNames();
    expect(names).toContain('workflowDesigner');
    expect(names).toContain('agentCreator');
    expect(names).toContain('skillCreator');
    expect(names).toContain('mcpBuilder');
  });
});
