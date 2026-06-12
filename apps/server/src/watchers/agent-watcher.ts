import { watch } from 'node:fs';
import { join } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { broadcast } from '../ws/handler.js';
import type { WatcherDeps } from './types.js';
import { debounce } from './utils.js';

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

        let agentCard: Record<string, unknown> & {
          connection?: Record<string, unknown>;
          protocol?: string;
          configSource?: string;
          source?: string;
          systemPrompt?: string;
          instructions?: string;
          capabilities?: unknown[];
          modelTier?: string;
          temperature?: number;
          maxResponseTokens?: number;
          maxTokens?: number;
          allowedTools?: string[];
          contextBudget?: number;
          contextWindow?: number;
        };
        try {
          agentCard = JSON.parse(readFileSync(agentJsonPath, 'utf-8'));
        } catch {
          continue;
        }

        const name = String(agentCard.name ?? entry.name);
        if (!name) continue;

        currentNames.add(name);
        const existing = deps.agentRegistry.get(name);

        // Detect external agent types from manifest
        const isExternal =
          agentCard.source === 'external_a2a' ||
          agentCard.source === 'external_cli' ||
          agentCard.protocol === 'a2a' ||
          agentCard.protocol === 'cli';
        const agentType = isExternal
          ? (agentCard.source as string) ||
            (agentCard.protocol === 'a2a' ? 'external_a2a' : 'external_cli')
          : 'custom';

        if (!existing || (existing.type !== 'custom' && !existing.type.startsWith('external_'))) {
          // New agent discovered (custom or external)
          const role: any = {
            type: agentType,
            name,
            description: String(agentCard.description ?? ''),
            modules: { identity: String(agentCard.systemPrompt ?? agentCard.instructions ?? '') },
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

          if (isExternal) {
            role.external = {
              protocol: agentCard.protocol ?? 'cli',
              configSource: agentCard.configSource ?? 'agent_native',
              baseUrl: agentCard.connection?.base_url,
              command: agentCard.connection?.command,
              args: agentCard.connection?.args ?? ['--print'],
              env: agentCard.connection?.env,
              permissionMode: agentCard.connection?.permission_mode,
              detectCommand: agentCard.connection?.detect_command,
              installCommand: agentCard.connection?.install_command,
              timeoutMs: agentCard.connection?.timeout_ms,
              maxRetries: agentCard.connection?.max_retries,
            };
          }

          deps.agentRegistry.register(role);

          const dbExisting = deps.agentRoleRepo.findByName(name);
          if (!dbExisting) {
            deps.agentRoleRepo.upsert({
              type: name,
              name,
              description: role.description,
              system_prompt: role.modules.identity,
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
            existing.modules.identity !==
              String(agentCard.systemPrompt ?? agentCard.instructions ?? '') ||
            existing.modelTier !== String(agentCard.modelTier ?? 'default') ||
            JSON.stringify((existing.allowedTools ?? []).slice().sort()) !==
              JSON.stringify(
                (Array.isArray(agentCard.allowedTools) ? agentCard.allowedTools : [])
                  .slice()
                  .sort(),
              );

          if (changed) {
            deps.agentRegistry.update(name, {
              description: String(agentCard.description ?? ''),
              modules: { identity: String(agentCard.systemPrompt ?? agentCard.instructions ?? '') },
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
