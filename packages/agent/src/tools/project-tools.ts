import { DEFAULT_CAPTAIN_ID, DEFAULT_CAPTAIN_NAME } from '@cabinet/types';
import type { ToolDefinition } from '../tool-executor.js';
import type { ToolDependencies } from './tool-dependencies.js';

export function createProjectTools(deps: ToolDependencies): ToolDefinition[] {
  return [
    // ═══════════════════════════════════════════════════════════
    // Project Tools (read + write)
    // ═══════════════════════════════════════════════════════════
    {
      name: 'get_project_context',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project ID to retrieve context for' },
          brief: { type: 'string', description: 'Optional Chair brief/description for context' },
        },
        required: ['projectId'],
      },
      execute: async (args: Record<string, unknown>) => {
        const projectId = args.projectId as string;
        const chairBrief = args.brief as string | undefined;
        const ctx = deps.project.get(projectId);
        if (!ctx) return { error: `Project not found: ${projectId}` };
        return {
          goals: ctx.goals,
          milestones: ctx.milestones,
          keyDecisions: ctx.keyDecisions,
          summary: ctx.summary,
        };
      },
    },
    {
      name: 'add_milestone',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project ID (defaults to "default")' },
          title: { type: 'string', description: 'Milestone title text' },
        },
        required: ['title'],
      },
      execute: async (args: Record<string, unknown>) => {
        const projectId = (args.projectId as string) ?? 'default';
        const title = args.title as string;
        if (!title) return { error: 'title is required' };
        deps.project.addMilestone(projectId, title);
        return { added: true, projectId, title };
      },
    },
    {
      name: 'update_project_summary',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project ID (defaults to "default")' },
          summary: { type: 'string', description: 'Updated project summary text' },
        },
        required: ['summary'],
      },
      execute: async (args: Record<string, unknown>) => {
        const projectId = (args.projectId as string) ?? 'default';
        const summary = args.summary as string;
        if (!summary) return { error: 'summary is required' };
        deps.project.updateSummary(projectId, summary);
        return { updated: true, projectId, preview: summary.slice(0, 200) };
      },
    },
    {
      name: 'get_captain_preferences',
      execute: async (args: Record<string, unknown>) => {
        const captainId = args.captainId as string;
        const prefs = deps.entity.getPreferences(captainId);
        return prefs ?? { captainId, preferences: {} };
      },
    },
    {
      name: 'set_captain_preferences',
      execute: async (args: Record<string, unknown>) => {
        const captainId = (args.captainId as string) ?? DEFAULT_CAPTAIN_ID;
        const name = (args.name as string) ?? DEFAULT_CAPTAIN_NAME;
        const prefs = (args.preferences as Record<string, unknown>) ?? {};
        deps.entity.setPreferences(captainId, name, prefs);
        return { updated: true, captainId };
      },
    },

    // Late project tools originally defined after agent management tools.
    {
      name: 'set_project_context',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project ID to set as active context' },
          brief: {
            type: 'string',
            description: 'Optional Chair brief describing the current task or focus',
          },
        },
        required: ['projectId'],
      },
      execute: async (args: Record<string, unknown>) => {
        const projectId = args.projectId as string;
        const chairBrief = args.brief as string | undefined;
        if (!projectId) return { error: 'projectId is required' };
        const result = deps.setProjectContext(projectId);
        if (chairBrief) {
          deps.project.updateSummary(projectId, chairBrief);
        }
        return { activeProject: result };
      },
    },
    {
      name: 'create_project',
      parameters: { type: 'object', properties: {} },
      execute: async (args: Record<string, unknown>) => {
        const name = args.name as string;
        if (!name) return { error: 'name is required' };
        const result = deps.createProject({
          name,
          description: args.description as string,
          rootPath: args.rootPath as string,
        });
        return { project: result };
      },
    },
    {
      name: 'list_projects',
      parameters: { type: 'object', properties: {} },
      execute: async (_args: Record<string, unknown>) => {
        return { projects: deps.listProjects() };
      },
    },
    {
      name: 'get_project_context',
      parameters: { type: 'object', properties: {} },
      execute: async (args: Record<string, unknown>) => {
        const projectId = args.projectId as string;
        const chairBrief = args.brief as string | undefined;
        if (!projectId) return { error: 'projectId is required' };
        return { context: deps.getProjectContext(projectId) };
      },
    },
  ];
}
