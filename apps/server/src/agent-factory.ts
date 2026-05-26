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
      if (!allowedTools.includes(toolName)) {
        executor.unregister(toolName);
      }
    }
  }

  return executor;
}

export function createStandardMemoryProvider(
  ctx: ServerContext,
  projectId?: string,
): MemoryProvider {
  const useIsolation = projectId && projectId !== 'global';
  const isolated = useIsolation
    ? new ProjectIsolatedMemory(projectId!, ctx.shortTerm, ctx.longTerm, ctx.entity, ctx.project)
    : null;

  return {
    async getShortTerm(sid: string) {
      const items: { role: 'user' | 'assistant'; content: string }[] = [];

      const session = ctx.sessionManager.get(sid);
      if (session && session.messages.length > 0) {
        const last = session.messages[session.messages.length - 1]!;
        const end = last.role === 'user' ? session.messages.length - 1 : session.messages.length;
        const start = Math.max(0, end - 20);

        if (end > 20) {
          const recentStart = end - 15;
          for (let i = recentStart; i < end; i++) {
            const m = session.messages[i]!;
            items.push({ role: m.role, content: m.content });
          }
          const olderParts: string[] = [];
          for (let i = start; i < recentStart; i++) {
            const m = session.messages[i]!;
            olderParts.push(m.content.slice(0, 100));
          }
          if (olderParts.length > 0) {
            items.unshift({ role: 'user', content: '[Earlier context summary]: ' + olderParts.join(' | ') });
          }
        } else {
          for (let i = start; i < end; i++) {
            const m = session.messages[i]!;
            items.push({ role: m.role, content: m.content });
          }
        }
      }

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
      const pid = _pid === 'global' ? _pid : (_pid || projectId || 'global');
      if (pid === 'global') return 'No project selected. Use list_projects to see available projects.';
      const projCtx = isolated ? isolated.getProjectContext() : ctx.project.get(pid);
      let contextStr = '';
      try {
        const projRow = ctx.projectRepo.findById(pid);
        if (projRow?.rootPath && existsSync(projRow.rootPath)) {
          contextStr = `Active project files at: ${projRow.rootPath}\n`;
        }
      } catch { /* root_path lookup is best-effort */ }
      if (!projCtx) {
        contextStr += `Project "${pid}" has no context yet. Use set_project_context to add details.`;
      } else {
        contextStr += `Project: ${projCtx.summary}\nGoals: ${projCtx.goals.join(', ')}\nMilestones: ${projCtx.milestones.map((m) => `${(m as any).name ?? (m as any).title ?? 'milestone'} (${(m as any).status ?? 'pending'})`).join(', ')}`;
      }

      return contextStr;
    },
    async getEntityPreferences(_captainId: string) {
      const prefs = ctx.entity.getPreferences(_captainId);
      return prefs?.preferences ?? {};
    },
    async searchLongTerm(query: string, _pid: string) {
      let queryEmbedding: number[] | undefined;
      if (ctx.gateway) {
        try {
          const er = await ctx.gateway.generateEmbeddings({ texts: [query] });
          queryEmbedding = er.embeddings[0];
        } catch { /* fall back to text search */ }
      }
      const results = await ctx.longTerm.search(query, RAG_LONGTERM_TOP_K, queryEmbedding);
      return results.map((r) => `[Memory] ${r.content}`);
    },
  };
}
