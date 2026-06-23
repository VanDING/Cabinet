import { join } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type { BuildState } from './build-state.js';

type ModelTier = 'default' | 'fast_execution' | 'deep_reasoning';

export function scanAgentDirectory(state: BuildState): void {
  const { dataDir, agentRegistry, agentRoleRepo } = state;
  if (!dataDir || !agentRegistry || !agentRoleRepo) return;

  const agentsDir = join(dataDir, 'agents');
  try {
    const agentDirs = readdirSync(agentsDir, { withFileTypes: true }).filter((d) =>
      d.isDirectory(),
    );
    for (const entry of agentDirs) {
      const agentJsonPath = join(agentsDir, entry.name, 'agent.json');
      if (!existsSync(agentJsonPath)) continue;
      try {
        const agentCard = JSON.parse(readFileSync(agentJsonPath, 'utf-8'));
        const name = agentCard.name ?? entry.name;
        const existing = agentRoleRepo.findByName(name);
        if (!existing) {
          agentRegistry.register({
            type: 'custom' as const,
            name,
            description: agentCard.description ?? '',
            modules: { identity: agentCard.systemPrompt ?? agentCard.instructions ?? '' },
            modelTier: (agentCard.modelTier as ModelTier) ?? 'default',
            temperature: agentCard.temperature ?? 0.7,
            maxResponseTokens: agentCard.maxResponseTokens ?? agentCard.maxTokens ?? 4096,
            allowedTools: agentCard.allowedTools ?? [],
            contextBudget: agentCard.contextBudget ?? agentCard.contextWindow ?? 0.3,
          });
          agentRoleRepo.upsert({
            type: 'custom',
            name,
            description: agentCard.description ?? '',
            system_prompt: agentCard.systemPrompt ?? agentCard.instructions ?? '',
            model_tier: (agentCard.modelTier as string) ?? 'default',
            temperature: agentCard.temperature ?? 0.7,
            max_response_tokens: agentCard.maxResponseTokens ?? agentCard.maxTokens ?? 4096,
            allowed_tools: JSON.stringify(agentCard.allowedTools ?? []),
            context_budget: agentCard.contextBudget ?? agentCard.contextWindow ?? 0.3,
            is_builtin: 0,
            created_at: new Date().toISOString(),
          });
        }
      } catch {
        /* skip malformed agent */
      }
    }
    state.logger?.info('Agents scanned from directory', { dir: agentsDir });
  } catch {
    /* agents dir empty */
  }
}

export function scanProjectDirectory(state: BuildState): void {
  const { dataDir, projectRepo, projectContextRepo } = state;
  if (!dataDir || !projectRepo || !projectContextRepo) return;

  const projectsDir = join(dataDir, 'projects');
  try {
    const projFiles = readdirSync(projectsDir).filter((f) => f.endsWith('.json'));
    for (const f of projFiles) {
      try {
        const proj = JSON.parse(readFileSync(join(projectsDir, f), 'utf-8'));
        const existing = projectRepo.findById(proj.id);
        if (!existing) {
          projectRepo.create({
            id: proj.id,
            name: proj.name,
            description: proj.description ?? '',
            status: 'active' as const,
            rootPath: proj.rootPath ?? '',
            createdAt: new Date(),
          });
          projectContextRepo.insert({
            project_id: proj.id,
            summary: '',
            goals: '[]',
            milestones: '[]',
            constraints: '{}',
            tech_summary: '',
            risk_map: '[]',
            key_decisions: '[]',
            updated_at: new Date().toISOString(),
          });
        }
      } catch {
        /* skip malformed project index */
      }
    }
    state.logger?.info('Projects scanned from directory', { dir: projectsDir });
  } catch {
    /* projects dir empty */
  }
}
