import { ToolExecutor, type ToolDefinition } from '../tool-executor.js';
import type { ToolDependencies } from './tool-dependencies.js';
import { createAgentTools } from './agent-tools.js';
import { createArchiveTools, type ArchiveToolDeps } from './archive-tools.js';
import { createBrowserTools, type BrowserToolDeps } from './browser-tools.js';
import { createCommunicationTools, type CommunicationToolDeps } from './communication-tools.js';
import { createDecisionTools } from './decision-tools.js';
import { createDocumentTools, type DocumentToolDeps } from './document-tools.js';
import { createEmployeeTools } from './employee-tools.js';
import { createEvaluationTools, type EvaluationToolDeps } from './evaluation-tools.js';
import { createEventTools } from './event-tools.js';
import { createFileTools, type FileToolDeps } from './file-tools.js';
import { createKnowledgeTools, type KnowledgeToolDeps } from './knowledge-tools.js';
import { createLSPTools, type LSPToolDeps } from './lsp-tools.js';
import { createMemoryTools } from './memory-tools.js';
import { createProjectTools } from './project-tools.js';
import { createReviewTools } from './review-tools.js';
import { createSchedulerTools, type SchedulerToolDeps } from './scheduler-tools.js';
import { createShellTools, type ShellToolDeps } from './shell-tools.js';
import { createStatusTools } from './status-tools.js';
import {
  createSystemKnowledgeTools,
  type SystemKnowledgeToolDeps,
} from './system-knowledge-tools.js';
import { createSystemTools, type SystemToolDeps } from './system-tools.js';
import { createTaskTools } from './task-tools.js';
import { createWebTools, type WebToolDeps } from './web-tools.js';
import { createWorkflowTools } from './workflow-tools.js';
import { registerMCPTools } from './mcp-tools.js';
import { registerSkillTools } from './skill-tools.js';

export type { ToolDependencies } from './tool-dependencies.js';
export { registerMCPTools } from './mcp-tools.js';
export { registerSkillTools } from './skill-tools.js';

export function createCabinetTools(deps: ToolDependencies): ToolDefinition[] {
  return [
    // ═══════════════════════════════════════════════════════════
    // Decision Tools
    // ═══════════════════════════════════════════════════════════
    ...createDecisionTools(deps),

    // ═══════════════════════════════════════════════════════════
    // Event/Monitoring Tools
    // ═══════════════════════════════════════════════════════════
    ...createEventTools(deps),

    // ═══════════════════════════════════════════════════════════
    // Memory Tools
    // ═══════════════════════════════════════════════════════════
    ...createMemoryTools(deps),

    // ═══════════════════════════════════════════════════════════
    // Project Tools
    // ═══════════════════════════════════════════════════════════
    ...createProjectTools(deps),

    // ═══════════════════════════════════════════════════════════
    // Workflow Tools
    // ═══════════════════════════════════════════════════════════
    ...createWorkflowTools(deps),

    // ═══════════════════════════════════════════════════════════
    // Employee Tools
    // ═══════════════════════════════════════════════════════════
    ...createEmployeeTools(deps),

    // ═══════════════════════════════════════════════════════════
    // Agent Management Tools
    // ═══════════════════════════════════════════════════════════
    ...createAgentTools(deps),

    // ═══════════════════════════════════════════════════════════
    // Status/Health Tools
    // ═══════════════════════════════════════════════════════════
    ...createStatusTools(deps),

    // ═══════════════════════════════════════════════════════════
    // Task Delegation / Tracking Tools
    // ═══════════════════════════════════════════════════════════
    ...createTaskTools(deps),

    // ═══════════════════════════════════════════════════════════
    // File System Tools
    // ═══════════════════════════════════════════════════════════
    ...createFileTools(deps),

    // ═══════════════════════════════════════════════════════════
    // Web / HTTP Tools
    // ═══════════════════════════════════════════════════════════
    ...createWebTools(deps),

    // ═══════════════════════════════════════════════════════════
    // Shell Execution Tools
    // ═══════════════════════════════════════════════════════════
    ...createShellTools(deps),

    // ═══════════════════════════════════════════════════════════
    // Scheduler Tools
    // ═══════════════════════════════════════════════════════════
    ...createSchedulerTools(deps),

    // ═══════════════════════════════════════════════════════════
    // Knowledge / RAG Tools
    // ═══════════════════════════════════════════════════════════
    ...createKnowledgeTools(deps),

    // ═══════════════════════════════════════════════════════════
    // Evaluation Tools
    // ═══════════════════════════════════════════════════════════
    ...createEvaluationTools(deps),

    // ═══════════════════════════════════════════════════════════
    // LSP Tools
    // ═══════════════════════════════════════════════════════════
    ...createLSPTools(deps),

    // ═══════════════════════════════════════════════════════════
    // System Knowledge Tools
    // ═══════════════════════════════════════════════════════════
    ...createSystemKnowledgeTools(deps),

    // ═══════════════════════════════════════════════════════════
    // Document Tools
    // ═══════════════════════════════════════════════════════════
    ...createDocumentTools(deps),

    // ═══════════════════════════════════════════════════════════
    // Archive Tools
    // ═══════════════════════════════════════════════════════════
    ...createArchiveTools(deps),

    // ═══════════════════════════════════════════════════════════
    // Browser Tools
    // ═══════════════════════════════════════════════════════════
    ...createBrowserTools(deps),

    // ═══════════════════════════════════════════════════════════
    // Communication Tools
    // ═══════════════════════════════════════════════════════════
    ...createCommunicationTools(deps),

    // ═══════════════════════════════════════════════════════════
    // System Tools
    // ═══════════════════════════════════════════════════════════
    ...createSystemTools(deps),

    // ═══════════════════════════════════════════════════════════
    // Review Tools (interactive mode)
    // ═══════════════════════════════════════════════════════════
    ...createReviewTools(deps),
  ];
}

export function registerCabinetTools(executor: ToolExecutor, deps: ToolDependencies): ToolExecutor {
  const tools = createCabinetTools(deps);
  for (const tool of tools) {
    executor.register(tool);
  }

  // Hook: 创建 workflow 时确认 cronExpression 已传入
  executor.addBeforeExecuteHook(async (name, args) => {
    if (name === 'create_workflow' && args.cronExpression === undefined) {
      return { ok: false, message: 'cronExpression is not set — workflow will not be scheduled' };
    }
  });

  return executor;
}
