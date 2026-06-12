import { watch } from 'node:fs';
import { join } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { parseSkillMarkdown } from '@cabinet/agent';
import { broadcast } from '../ws/handler.js';
import type { WatcherDeps } from './types.js';
import { debounce } from './utils.js';

export function startSkillWatcher(dataDir: string, deps: WatcherDeps): () => void {
  const skillsDir = join(dataDir, 'skills');
  if (!existsSync(skillsDir)) {
    deps.logger.warn('Skills directory does not exist, skipping watcher', { dir: skillsDir });
    return () => {};
  }

  const scan = () => {
    try {
      const currentNames = new Set<string>();
      const entries = readdirSync(skillsDir, { withFileTypes: true }).filter((d) =>
        d.isDirectory(),
      );

      for (const entry of entries) {
        const skillMdPath = join(skillsDir, entry.name, 'SKILL.md');
        if (!existsSync(skillMdPath)) continue;

        const content = readFileSync(skillMdPath, 'utf-8');
        const parsed = parseSkillMarkdown(content);
        if (!parsed) continue;

        currentNames.add(parsed.name);
        const existing = deps.skillRegistry.load(parsed.name);
        const refsDir = join(skillsDir, entry.name, 'references');
        const scriptsDir = join(skillsDir, entry.name, 'scripts');
        const refsPath = existsSync(refsDir) ? refsDir : '';
        const scriptsPath = existsSync(scriptsDir) ? scriptsDir : '';

        if (!existing) {
          // New skill discovered
          const id = `skill_${Date.now()}`;
          deps.skillRegistry.register({
            id,
            name: parsed.name,
            description: parsed.description,
            kind: parsed.kind ?? 'prompt',
            exposure: (parsed.exposure as 'prompt' | 'tool' | 'both') ?? 'prompt',
            promptTemplate: parsed.body,
            inputSchema: {},
            outputSchema: {},
            version: parsed.version ?? 1,
            status: 'active',
            referencesPath: refsPath,
            scriptsPath,
            metadata: parsed.metadata ?? {},
          });

          const dbExisting = deps.skillRepo.findByName(parsed.name);
          if (!dbExisting) {
            deps.skillRepo.insert({
              id,
              name: parsed.name,
              description: parsed.description,
              kind: parsed.kind ?? 'prompt',
              input_schema: '{}',
              output_schema: '{}',
              prompt_template: parsed.body,
              version: parsed.version ?? 1,
              status: 'active',
              metadata: JSON.stringify(parsed.metadata ?? {}),
              references_path: refsPath,
              scripts_path: scriptsPath,
            });
          }

          broadcast('skill_created', { id, name: parsed.name });
          deps.logger.info('Skill auto-discovered from filesystem', { id, name: parsed.name });
        } else {
          // Existing skill — check if content changed
          const changed =
            existing.promptTemplate !== parsed.body ||
            existing.description !== parsed.description ||
            existing.kind !== (parsed.kind ?? 'prompt');

          if (changed) {
            const newVersion = (existing.version ?? 0) + 1;
            deps.skillRegistry.register({
              id: existing.id,
              name: parsed.name,
              description: parsed.description,
              kind: parsed.kind ?? 'prompt',
              exposure:
                (parsed.exposure as 'prompt' | 'tool' | 'both') ?? existing.exposure ?? 'prompt',
              promptTemplate: parsed.body,
              inputSchema: {},
              outputSchema: {},
              version: newVersion,
              status: 'active',
              referencesPath: refsPath || (existing.referencesPath ?? ''),
              scriptsPath: scriptsPath || (existing.scriptsPath ?? ''),
              metadata: parsed.metadata ?? existing.metadata ?? {},
            });

            deps.skillRepo.update(existing.id, {
              description: parsed.description,
              version: newVersion,
              metadata: JSON.stringify(parsed.metadata ?? {}),
            });

            broadcast('skill_updated', { id: existing.id, name: parsed.name });
            deps.logger.info('Skill auto-updated from filesystem', {
              id: existing.id,
              name: parsed.name,
            });
          }
        }
      }

      // Detect deletions: registry has skills that no longer exist on disk
      for (const name of deps.skillRegistry.listNames()) {
        if (!currentNames.has(name)) {
          const skill = deps.skillRegistry.load(name);
          if (skill) {
            deps.skillRegistry.unregister(name);
            deps.skillRepo.delete(skill.id);
            broadcast('skill_deleted', { id: skill.id, name: skill.name });
            deps.logger.info('Skill auto-removed (directory deleted)', {
              id: skill.id,
              name: skill.name,
            });
          }
        }
      }
    } catch (err) {
      deps.logger.warn('Skill watcher scan failed', { error: (err as Error).message });
    }
  };

  const debouncedScan = debounce(scan, 500);

  const watcher = watch(skillsDir, { recursive: false }, (_eventType, _filename) => {
    debouncedScan();
  });

  deps.logger.info('Skill filesystem watcher started', { dir: skillsDir });

  // Initial scan to catch anything that appeared between startup and watcher init
  scan();

  return () => {
    watcher.close();
    deps.logger.info('Skill filesystem watcher stopped');
  };
}
