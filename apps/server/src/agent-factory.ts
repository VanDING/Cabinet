import {
  ToolExecutor,
  registerCabinetTools,
  registerSkillTools,
  registerMCPTools,
  registerBuiltInSkills,
} from '@cabinet/agent';
import type { ToolDependencies, MemoryProvider } from '@cabinet/agent';
import { ProjectIsolatedMemory } from '@cabinet/memory';
import type { ServerContext } from './context.js';
import { existsSync } from 'node:fs';

const RAG_LONGTERM_TOP_K = 5;

export function createStandardToolExecutor(
  ctx: ServerContext,
  deps: ToolDependencies,
  allowedTools?: string[],
): ToolExecutor {
  const executor = new ToolExecutor();
  registerCabinetTools(executor, deps);
  registerBuiltInSkills();
  registerSkillTools(executor);

  registerMCPTools(
    executor,
    (name, args) => ctx.mcpManager.callTool(name, args),
    () => ctx.mcpManager.listTools(),
  );

  executor.setToolCallCallback((toolName, success, blocked, durationMs) => {
    ctx.observability.recordToolCall(toolName, success, blocked, durationMs);
  });

  if (allowedTools && allowedTools.length > 0) {
    for (const toolName of executor.listTools()) {
      const isPermitted = allowedTools.some((at) => {
        if (at === toolName) return true;
        if (at.endsWith('*') && toolName.startsWith(at.slice(0, -1))) return true;
        if (at === 'use_skill' && toolName.startsWith('use_skill__')) return true;
        return false;
      });
      if (!isPermitted) {
        executor.unregister(toolName);
      }
    }
  }

  return executor;
}

/**
 * Build the server-specific MemoryProvider that the Agent layer consumes.
 *
 * The provider is now a thin adapter around {@link ctx.memoryFacade}.  Server-
 * specific concerns that the facade does not own (project isolation for short-
 * term KV and repo root-path decoration) are layered on top here.
 */
export function createStandardMemoryProvider(
  ctx: ServerContext,
  projectId?: string,
): MemoryProvider {
  const facade = ctx.memoryFacade;
  const useIsolation = projectId && projectId !== 'global';
  const isolated = useIsolation
    ? new ProjectIsolatedMemory(projectId!, ctx.shortTerm, ctx.longTerm, ctx.entity, ctx.project)
    : null;

  return {
    async getShortTerm(sid: string) {
      const items = await facade.getSessionContext(sid);

      // Layer project-isolated short-term KV entries on top of the facade view.
      const scopedSid = isolated ? `${projectId}:${sid}` : sid;
      const kv = ctx.shortTerm.getAll(scopedSid);
      for (const [k, v] of Object.entries(kv)) {
        if (typeof v === 'string' && v.length > 0) {
          items.push({ role: 'user' as const, content: `[${k}]: ${v}` });
        }
      }

      return items;
    },
    async getProjectContext(_pid: string) {
      const pid = _pid === 'global' ? _pid : _pid || projectId || 'global';
      if (pid === 'global')
        return 'No project selected. Use list_projects to see available projects.';

      let contextStr = '';
      try {
        const projRow = ctx.projectRepo.findById(pid);
        if (projRow?.rootPath && existsSync(projRow.rootPath)) {
          contextStr = `Active project files at: ${projRow.rootPath}\n`;
        }
      } catch {
        /* root_path lookup is best-effort */
      }

      const projCtx = isolated ? isolated.getProjectContext() : facade.getProject(pid);
      if (!projCtx) {
        contextStr += `Project "${pid}" has no context yet. Use set_project_context to add details.`;
      } else {
        contextStr += `Project: ${projCtx.summary}\nGoals: ${projCtx.goals.join(', ')}\nMilestones: ${projCtx.milestones
          .map(
            (m) =>
              `${(m as any).name ?? (m as any).title ?? 'milestone'} (${(m as any).status ?? 'pending'})`,
          )
          .join(', ')}`;
      }

      return contextStr;
    },
    async getEntityPreferences(_captainId: string) {
      return facade.getEntityPreferences(_captainId);
    },
    async searchLongTerm(query: string, _pid: string) {
      const results = isolated
        ? await isolated.longTermSearch(query, RAG_LONGTERM_TOP_K)
        : await facade.search(query, { limit: RAG_LONGTERM_TOP_K });
      return results.map((r) => `[Memory] ${r.content}`);
    },
    async getRecentInsights(count: number) {
      return facade.getRecentInsights(count);
    },
  };
}
