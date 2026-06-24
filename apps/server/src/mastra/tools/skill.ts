import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { toolServices } from './tool-context.js';
import type { SkillEntry } from '@cabinet/agent';
import { CABINET_DIR } from '@cabinet/storage';
import { injectAgentSkillTools } from '../../context/skills.js';
import { getServerContext } from '../../context.js';

const SKILLS_DIR = join(CABINET_DIR, 'skills');

function ensureSkillDir(name: string): string {
  const dir = join(SKILLS_DIR, name);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function reInjectSkills(): void {
  try {
    const { mastra, skillRegistry } = getServerContext();
    if (mastra && skillRegistry) {
      injectAgentSkillTools(mastra, skillRegistry);
    }
  } catch {
    /* best-effort */
  }
}

export const createSkillTool = createTool({
  id: 'create_skill',
  description:
    'Create a new skill in Cabinet. Skills are reusable instructions/prompts that agents can invoke as tools (use_skill__<name>). Creates SKILL.md file, persists to DB, and registers in runtime.',
  inputSchema: z.object({
    name: z.string().describe('Skill identifier, e.g. "aihot", "codeReview"'),
    description: z.string().describe('What the skill does'),
    promptTemplate: z.string().optional().describe('Markdown instruction body for the skill'),
    kind: z
      .enum(['tool', 'prompt', 'composite'])
      .optional()
      .default('tool')
      .describe('tool (callable), prompt (injected into context), or composite'),
    exposure: z
      .enum(['prompt', 'tool', 'both'])
      .optional()
      .default('both')
      .describe(
        'How the skill is exposed: prompt (system context), tool (use_skill__<name>), or both',
      ),
  }),
  execute: async ({ name, description, promptTemplate, kind, exposure }) => {
    const { skillRegistry, logger, _skillRepo } = toolServices;
    const skillRepo = _skillRepo;
    const id = `skill_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const existing = skillRepo.findByName(name);
    if (existing) {
      return { error: `Skill "${name}" already exists`, existingId: existing.id };
    }

    const dir = ensureSkillDir(name);
    const refsDir = join(dir, 'references');
    const scriptsDir = join(dir, 'scripts');

    const resolvedKind = kind ?? 'tool';
    const resolvedExposure = exposure ?? 'both';
    const resolvedPromptTemplate = promptTemplate ?? '';

    const skillMd = [
      '---',
      `name: ${name}`,
      `description: ${description}`,
      `kind: ${resolvedKind}`,
      `exposure: ${resolvedExposure}`,
      'version: 1',
      'status: active',
      '---',
      '',
      resolvedPromptTemplate,
    ].join('\n');
    writeFileSync(join(dir, 'SKILL.md'), skillMd, 'utf-8');

    skillRepo.insert({
      id,
      name,
      description,
      kind: resolvedKind,
      input_schema: '{}',
      output_schema: '{}',
      prompt_template: resolvedPromptTemplate,
      version: 1,
      status: 'active',
      metadata: '{}',
      references_path: existsSync(refsDir) ? refsDir : '',
      scripts_path: existsSync(scriptsDir) ? scriptsDir : '',
      exposure: resolvedExposure,
    });

    skillRegistry.register({
      id,
      name,
      description,
      kind: resolvedKind as SkillEntry['kind'],
      exposure: resolvedExposure as SkillEntry['exposure'],
      promptTemplate: resolvedPromptTemplate,
      inputSchema: {},
      outputSchema: {},
      version: 1,
      status: 'active',
      referencesPath: existsSync(refsDir) ? refsDir : '',
      scriptsPath: existsSync(scriptsDir) ? scriptsDir : '',
    });

    reInjectSkills();
    toolServices.broadcast('skill_created', { id, name });
    logger.info('Skill created via agent tool', { id, name });
    return { id, name, status: 'created', path: join(dir, 'SKILL.md') };
  },
});

export const updateSkillTool = createTool({
  id: 'update_skill',
  description:
    'Update an existing skill. Pass only the fields you want to change (at minimum the name to identify the skill).',
  inputSchema: z.object({
    name: z.string().describe('Name of the skill to update'),
    description: z.string().optional().describe('New description'),
    promptTemplate: z.string().optional().describe('New Markdown instruction body'),
    kind: z.enum(['tool', 'prompt', 'composite']).optional().describe('New skill type'),
  }),
  execute: async ({ name, description, promptTemplate, kind }) => {
    const { skillRegistry, logger, _skillRepo } = toolServices;
    const skillRepo = _skillRepo;

    const existing = skillRepo.findByName(name);
    if (!existing) {
      return { error: `Skill "${name}" not found. Use create_skill to create it first.` };
    }

    const fullRow = skillRepo.findById(existing.id);
    if (!fullRow) {
      return { error: `Skill "${name}" DB record not found` };
    }

    const newVersion = fullRow.version + 1;
    skillRepo.update(existing.id, {
      name,
      description: description ?? fullRow.description,
      version: newVersion,
    });

    const regSkill = skillRegistry.load(name);
    if (regSkill) {
      skillRegistry.register({
        ...regSkill,
        description: description ?? regSkill.description,
        kind: (kind as SkillEntry['kind']) ?? regSkill.kind,
        version: newVersion,
        promptTemplate: promptTemplate ?? regSkill.promptTemplate,
      });
    }

    const dir = ensureSkillDir(name);
    const skillMd = [
      '---',
      `name: ${name}`,
      `description: ${description ?? fullRow.description}`,
      `kind: ${kind ?? fullRow.kind}`,
      `version: ${newVersion}`,
      `status: ${fullRow.status}`,
      '---',
      '',
      promptTemplate ?? fullRow.prompt_template ?? '',
    ].join('\n');
    writeFileSync(join(dir, 'SKILL.md'), skillMd, 'utf-8');

    reInjectSkills();
    toolServices.broadcast('skill_updated', { id: existing.id, name });
    logger.info('Skill updated via agent tool', { id: existing.id, name });
    return { id: existing.id, name, status: 'updated', version: newVersion };
  },
});

export const useSkillTool = createTool({
  id: 'use_skill',
  description:
    'Invoke a registered skill by name. Use this to run any skill that is registered in the system. Pass arguments as space-separated string or key=value pairs.',
  inputSchema: z.object({
    skill: z.string().describe('Name of the skill to invoke (e.g. "aihot", "workflowDesigner")'),
    arguments: z
      .string()
      .optional()
      .describe('Arguments for the skill (space-separated positional args or key=value)'),
  }),
  execute: async ({ skill: skillName, arguments: args }) => {
    const { skillRegistry, logger } = toolServices;

    if (!skillName) {
      const available = skillRegistry.listNames();
      return {
        error: 'No skill name provided',
        availableSkills: available,
        hint: 'Provide a skill name, e.g. use_skill(skill: "aihot")',
      };
    }

    const skill = skillRegistry.load(skillName);
    if (!skill) {
      const names = skillRegistry.listNames();
      return {
        error: `Skill "${skillName}" not found`,
        availableSkills: names,
        hint:
          names.length > 0
            ? `Available: ${names.join(', ')}`
            : 'No skills registered yet. Use create_skill to create one.',
      };
    }

    const result = await skillRegistry.executeSkill(skill, {
      arguments: args ?? '',
    });
    logger.info('Skill invoked via agent tool', { name: skillName });
    return { skillName: result.skillName, output: result.output };
  },
});
