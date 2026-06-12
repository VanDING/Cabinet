import type { ToolDefinition } from '../tool-executor.js';
import type { ToolDependencies } from './tool-dependencies.js';

export function createWorkflowTools(deps: ToolDependencies): ToolDefinition[] {
  return [
    // ═══════════════════════════════════════════════════════════
    // Workflow Tools (read + write)
    // ═══════════════════════════════════════════════════════════
    {
      name: 'list_workflows',
      description: 'List all workflows in a project.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project ID to filter by (omit for all)' },
        },
      },
      execute: async (_args: Record<string, unknown>) => {
        const workflows = deps.listWorkflows();
        return { workflows };
      },
    },
    {
      name: 'get_workflow',
      description: 'Retrieve a single workflow by ID, including its full definition.',
      parameters: {
        type: 'object',
        properties: {
          workflowId: { type: 'string', description: 'ID of the workflow to retrieve' },
        },
        required: ['workflowId'],
      },
      execute: async (args: Record<string, unknown>) => {
        const workflowId = args.workflowId as string;
        if (!workflowId) return { error: 'workflowId is required' };
        const wf = deps.getWorkflow(workflowId);
        if (!wf) return { error: `Workflow not found: ${workflowId}` };
        return {
          id: wf.id,
          name: wf.name,
          status: wf.status,
          definition: wf.definition,
        };
      },
    },
    {
      name: 'create_workflow',
      description: `Create a new workflow. The definition must contain either:
- steps: array of WorkflowStep objects (declarative format, preferred for simple workflows)
- OR nodes + edges: DAG format (preferred for complex/agentGroup/loop workflows)

Supported node types: start, end, agentGroup, llm, skill, tool, code, workflow, ifElse, loop, parallel, merge, pass, intentClassify, knowledgeBase, approval, human.
You may also include capabilities (files, web, shell, knowledge, evaluation) and cronExpression.`,
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project ID (required)' },
          name: { type: 'string', description: 'Human-readable workflow name' },
          definition: {
            type: 'object',
            description:
              'Workflow definition object. Use { steps: [...], capabilities?: {...} } for declarative, or { nodes: [...], edges: [...], capabilities?: {...} } for DAG.',
          },
          cronExpression: {
            type: 'string',
            description: 'Optional cron expression for scheduled execution',
          },
        },
        required: ['projectId', 'name', 'definition'],
      },
      execute: async (args: Record<string, unknown>) => {
        const projectId = args.projectId as string;
        if (!projectId) {
          return { error: 'projectId is required' };
        }
        const name = (args.name as string) ?? 'Untitled Workflow';
        const definition = (args.definition as unknown) ?? { nodes: [], edges: [] };
        const result = deps.createWorkflow({ name, projectId, definition });
        return { created: true, workflowId: result.id, name, projectId };
      },
    },
    {
      name: 'update_workflow',
      description: 'Update an existing workflow name or definition.',
      parameters: {
        type: 'object',
        properties: {
          workflowId: { type: 'string', description: 'ID of the workflow to update' },
          name: { type: 'string', description: 'New workflow name' },
          definition: {
            type: 'object',
            description: 'New workflow definition (same format as create_workflow)',
          },
        },
        required: ['workflowId'],
      },
      execute: async (args: Record<string, unknown>) => {
        const workflowId = args.workflowId as string;
        if (!workflowId) return { error: 'workflowId is required' };
        const name = args.name as string | undefined;
        const definition = args.definition as unknown | undefined;
        deps.updateWorkflow(workflowId, { name, definition });
        return { updated: true, workflowId };
      },
    },
    {
      name: 'run_workflow',
      description: 'Execute a workflow by ID immediately.',
      parameters: {
        type: 'object',
        properties: {
          workflowId: { type: 'string', description: 'ID of the workflow to run' },
        },
        required: ['workflowId'],
      },
      execute: async (args: Record<string, unknown>) => {
        const workflowId = args.workflowId as string;
        if (!workflowId) return { error: 'workflowId is required' };
        const result = await deps.runWorkflow(workflowId);
        return { executed: true, ...result };
      },
    },
    {
      name: 'delete_workflow',
      description: 'Delete a workflow by ID.',
      parameters: {
        type: 'object',
        properties: {
          workflowId: { type: 'string', description: 'ID of the workflow to delete' },
        },
        required: ['workflowId'],
      },
      execute: async (args: Record<string, unknown>) => {
        const workflowId = args.workflowId as string;
        if (!workflowId) return { error: 'workflowId is required' };
        deps.deleteWorkflow(workflowId);
        return { deleted: true, workflowId };
      },
    },
    {
      name: 'get_workflow_run',
      description: 'Retrieve details of a specific workflow run.',
      parameters: {
        type: 'object',
        properties: {
          runId: { type: 'string', description: 'ID of the run to retrieve' },
        },
        required: ['runId'],
      },
      execute: async (args: Record<string, unknown>) => {
        const runId = args.runId as string;
        if (!runId) return { error: 'runId is required' };
        const run = deps.getWorkflowRun(runId);
        if (!run) return { error: `Run not found: ${runId}` };
        return run;
      },
    },
    {
      name: 'list_workflow_runs',
      description: 'List all runs for a given workflow.',
      parameters: {
        type: 'object',
        properties: {
          workflowId: { type: 'string', description: 'ID of the workflow' },
        },
        required: ['workflowId'],
      },
      execute: async (args: Record<string, unknown>) => {
        const workflowId = args.workflowId as string;
        if (!workflowId) return { error: 'workflowId is required' };
        return { runs: deps.listWorkflowRuns(workflowId) };
      },
    },
  ];
}
