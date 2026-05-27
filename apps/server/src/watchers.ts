import { watch } from 'node:fs';
import { join } from 'node:path';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import type { SkillRegistry } from '@cabinet/agent';
import type { AgentRoleRegistry } from '@cabinet/agent';
import { parseSkillMarkdown } from '@cabinet/agent';
import type { SkillRepository, AgentRoleRepository } from '@cabinet/storage';
import { broadcast } from './ws/handler.js';

interface WatcherDeps {
  skillRegistry: SkillRegistry;
  skillRepo: SkillRepository;
  agentRegistry: AgentRoleRegistry;
  agentRoleRepo: AgentRoleRepository;
  logger: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
  };
}

/** Debounce helper: accumulate calls and execute once after delay. */
function debounce<T extends (...args: unknown[]) => void>(fn: T, delayMs: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: unknown[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, delayMs);
  }) as T;
}

// ── Skill Watcher ──

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

// ── Agent Watcher ──

export function startAgentWatcher(dataDir: string, deps: WatcherDeps): () => void {
  const agentsDir = join(dataDir, 'agents');
  if (!existsSync(agentsDir)) {
    deps.logger.warn('Agents directory does not exist, skipping watcher', { dir: agentsDir });
    return () => {};
  }

  const scan = () => {
    try {
      const currentNames = new Set<string>();
      const entries = readdirSync(agentsDir, { withFileTypes: true }).filter((d) =>
        d.isDirectory(),
      );

      for (const entry of entries) {
        const agentJsonPath = join(agentsDir, entry.name, 'agent.json');
        if (!existsSync(agentJsonPath)) continue;

        let agentCard: Record<string, unknown>;
        try {
          agentCard = JSON.parse(readFileSync(agentJsonPath, 'utf-8'));
        } catch {
          continue;
        }

        const name = String(agentCard.name ?? entry.name);
        if (!name) continue;

        currentNames.add(name);
        const existing = deps.agentRegistry.get(name);

        if (!existing || existing.type !== 'custom') {
          // New agent discovered
          const role = {
            type: 'custom' as const,
            name,
            description: String(agentCard.description ?? ''),
            systemPrompt: String(agentCard.systemPrompt ?? agentCard.instructions ?? ''),
            modelTier: ((agentCard.modelTier as string) || 'default') as any,
            temperature: parseFloat(String(agentCard.temperature ?? 0.7)),
            maxResponseTokens: parseInt(
              String(agentCard.maxResponseTokens ?? agentCard.maxTokens ?? 4096),
              10,
            ),
            allowedTools: (Array.isArray(agentCard.allowedTools)
              ? agentCard.allowedTools
              : []) as string[],
            contextBudget: parseInt(
              String(agentCard.contextBudget ?? agentCard.contextWindow ?? 100000),
              10,
            ),
          };

          deps.agentRegistry.register(role);

          const dbExisting = deps.agentRoleRepo.findByName(name);
          if (!dbExisting) {
            deps.agentRoleRepo.upsert({
              type: name,
              name,
              description: role.description,
              system_prompt: role.systemPrompt,
              model_tier: role.modelTier,
              temperature: role.temperature,
              max_response_tokens: role.maxResponseTokens,
              allowed_tools: JSON.stringify(role.allowedTools),
              context_budget: role.contextBudget,
              is_builtin: 0,
              created_at: new Date().toISOString(),
            });
          }

          broadcast('agent_created', { name });
          deps.logger.info('Agent auto-discovered from filesystem', { name });
        } else {
          // Existing custom agent — check if content changed
          const changed =
            existing.description !== String(agentCard.description ?? '') ||
            existing.systemPrompt !==
              String(agentCard.systemPrompt ?? agentCard.instructions ?? '') ||
            existing.modelTier !== String(agentCard.modelTier ?? 'default');

          if (changed) {
            deps.agentRegistry.update(name, {
              description: String(agentCard.description ?? ''),
              systemPrompt: String(agentCard.systemPrompt ?? agentCard.instructions ?? ''),
              modelTier: ((agentCard.modelTier as string) || 'default') as any,
              temperature: parseFloat(String(agentCard.temperature ?? 0.7)),
              maxResponseTokens: parseInt(
                String(agentCard.maxResponseTokens ?? agentCard.maxTokens ?? 4096),
                10,
              ),
              allowedTools: (Array.isArray(agentCard.allowedTools)
                ? agentCard.allowedTools
                : []) as string[],
              contextBudget: parseInt(
                String(agentCard.contextBudget ?? agentCard.contextWindow ?? 100000),
                10,
              ),
            });

            deps.agentRoleRepo.upsert({
              type: name,
              name,
              description: String(agentCard.description ?? ''),
              system_prompt: String(agentCard.systemPrompt ?? agentCard.instructions ?? ''),
              model_tier: ((agentCard.modelTier as string) || 'default') as any,
              temperature: parseFloat(String(agentCard.temperature ?? 0.7)),
              max_response_tokens: parseInt(
                String(agentCard.maxResponseTokens ?? agentCard.maxTokens ?? 4096),
                10,
              ),
              allowed_tools: JSON.stringify(
                Array.isArray(agentCard.allowedTools) ? agentCard.allowedTools : [],
              ),
              context_budget: parseInt(
                String(agentCard.contextBudget ?? agentCard.contextWindow ?? 100000),
                10,
              ),
              is_builtin: 0,
              created_at: new Date().toISOString(),
            });

            broadcast('agent_updated', { name });
            deps.logger.info('Agent auto-updated from filesystem', { name });
          }
        }
      }

      // Detect deletions
      for (const role of deps.agentRegistry.list()) {
        if (role.type === 'custom' && !currentNames.has(role.name)) {
          deps.agentRegistry.unregister(role.name);
          deps.agentRoleRepo.deleteByType(role.name);
          broadcast('agent_deleted', { name: role.name });
          deps.logger.info('Agent auto-removed (directory deleted)', { name: role.name });
        }
      }
    } catch (err) {
      deps.logger.warn('Agent watcher scan failed', { error: (err as Error).message });
    }
  };

  const debouncedScan = debounce(scan, 500);

  const watcher = watch(agentsDir, { recursive: false }, (_eventType, _filename) => {
    debouncedScan();
  });

  deps.logger.info('Agent filesystem watcher started', { dir: agentsDir });

  // Initial scan
  scan();

  return () => {
    watcher.close();
    deps.logger.info('Agent filesystem watcher stopped');
  };
}
