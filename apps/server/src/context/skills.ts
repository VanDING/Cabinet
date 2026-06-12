import { join } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { SkillRegistry, importSkillFromMarkdown, setSkillRegistry } from '@cabinet/agent';
import type { BuildState } from './build-state.js';

export function initSkills(state: BuildState): void {
  const { db, skillRepo, agentRegistry, agentRoleRepo } = state;
  if (!db || !skillRepo || !agentRegistry || !agentRoleRepo) {
    throw new Error('Missing required state for skills');
  }

  const skillRegistry = new SkillRegistry();
  setSkillRegistry(skillRegistry);
  try {
    const skillRows = skillRepo.findActive();
    for (const row of skillRows) {
      skillRegistry.register({
        id: row.id,
        name: row.name,
        description: row.description,
        kind: row.kind as 'tool' | 'prompt' | 'composite',
        exposure: (row.exposure as 'prompt' | 'tool' | 'both') ?? 'prompt',
        promptTemplate: row.prompt_template,
        inputSchema: JSON.parse(row.input_schema ?? '{}'),
        outputSchema: JSON.parse(row.output_schema ?? '{}'),
        version: row.version,
        status: row.status as 'active' | 'draft' | 'deprecated',
      });
    }
    state.logger?.info('Skill registry loaded', { count: skillRows.length });
  } catch (e) {
    state.logger?.warn('Failed to load skills from DB', { error: String(e) });
  }

  state.skillRegistry = skillRegistry;
}

export function scanSkillDirectory(state: BuildState): void {
  const { dataDir, skillRegistry, skillRepo, agentRegistry, agentRoleRepo } = state;
  if (!dataDir || !skillRegistry || !skillRepo || !agentRegistry || !agentRoleRepo) return;

  const skillsDir = join(dataDir, 'skills');
  try {
    const skillDirs = readdirSync(skillsDir, { withFileTypes: true }).filter((d) =>
      d.isDirectory(),
    );
    for (const entry of skillDirs) {
      const skillPath = join(skillsDir, entry.name, 'SKILL.md');
      if (!existsSync(skillPath)) continue;
      try {
        const content = readFileSync(skillPath, 'utf-8');
        const refsDir = join(skillsDir, entry.name, 'references');
        const scriptsDir = join(skillsDir, entry.name, 'scripts');
        const result = importSkillFromMarkdown(content, skillRegistry, {
          referencesPath: existsSync(refsDir) ? refsDir : undefined,
          scriptsPath: existsSync(scriptsDir) ? scriptsDir : undefined,
        });
        if (result) {
          const existing = skillRepo.findByName(result.name);
          if (!existing) {
            const skill = skillRegistry.load(result.name);
            if (skill) {
              skillRepo.insert({
                id: skill.id,
                name: skill.name,
                description: skill.description,
                kind: skill.kind,
                input_schema: '{}',
                output_schema: '{}',
                prompt_template: skill.promptTemplate,
                version: 1,
                status: 'active',
                metadata: null,
                references_path: skill.referencesPath ?? null,
                scripts_path: skill.scriptsPath ?? null,
              });
            }
          }
        }
      } catch {
        /* skip malformed skill */
      }
    }
    state.logger?.info('Skills scanned from directory', { dir: skillsDir });
  } catch {
    /* skills dir empty */
  }
}
