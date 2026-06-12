import type { ToolDefinition } from '../tool-executor.js';
import type { ToolDependencies } from './tool-dependencies.js';

export function createTaskTools(deps: ToolDependencies): ToolDefinition[] {
  return [
    // ═══════════════════════════════════════════════════════════
    // Task Delegation / Tracking Tools
    // ═══════════════════════════════════════════════════════════
    {
      name: 'delegate_task',
      parameters: { type: 'object', properties: {} },
      execute: async (args: Record<string, unknown>) => {
        const name = args.name as string;
        const agentName = args.agentName as string | undefined;
        const description = args.description as string | undefined;
        if (!name) return { error: 'name is required' };
        const taskId = deps.delegateTask(name, agentName, description);
        return { taskId, name, agentName, status: 'running' };
      },
    },
    {
      name: 'get_task_status',
      parameters: { type: 'object', properties: {} },
      execute: async (args: Record<string, unknown>) => {
        const taskId = args.taskId as string;
        if (!taskId) return { error: 'taskId is required' };
        const task = deps.getTaskStatus(taskId);
        if (!task) return { error: `Task not found: ${taskId}` };
        return task;
      },
    },
    {
      name: 'list_active_tasks',
      parameters: { type: 'object', properties: {} },
      execute: async (_args: Record<string, unknown>) => {
        return { tasks: deps.listActiveTasks() };
      },
    },
  ];
}
