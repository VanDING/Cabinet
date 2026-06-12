/* eslint-disable @typescript-eslint/no-explicit-any */
import { getServerContext } from '../../context.js';
import type { ToolDependencies } from '@cabinet/agent';
import type { WorkflowCapabilities } from '@cabinet/types';
import { createAllCapabilities, type CapabilitiesContext } from '../../capabilities.js';
import { stub } from './state.js';

// ── Tool dependencies (capabilities-gated for workflow agents) ──
export function buildToolDependencies(caps: WorkflowCapabilities = {}): ToolDependencies {
  const ctx = getServerContext();
  const capabilitiesCtx: CapabilitiesContext = {
    db: ctx.db,
    gateway: ctx.gateway,
    logger: ctx.logger,
    taskScheduler: ctx.taskScheduler,
    workflowRepo: ctx.workflowRepo,
    projectRepo: ctx.projectRepo,
  };
  const shared = createAllCapabilities(capabilitiesCtx);

  return {
    decisionStore: ctx.decisionRepo,
    eventBus: ctx.eventBus,
    shortTerm: ctx.shortTerm,
    longTerm: ctx.longTerm,
    entity: ctx.entity,
    project: ctx.project,
    memoryFacade: ctx.memoryFacade,
    createDecision(input) {
      const id = `dec_${Date.now()}`;
      return ctx.decisionService.create({
        id,
        projectId: input.projectId,
        type: input.type,
        title: input.title,
        description: input.description,
        options: input.options,
        classification: input.classification,
        captainId: input.captainId,
      }) as any;
    },
    approveDecision(decisionId, captainId, chosenOptionId) {
      return ctx.decisionService.approve(decisionId, captainId, chosenOptionId);
    },
    rejectDecision(decisionId, captainId) {
      return ctx.decisionService.reject(decisionId, captainId);
    },
    listWorkflows() {
      const rows = ctx.workflowRepo.listAll();
      return rows.map((r) => {
        const def = JSON.parse(r.definition ?? '{}');
        return {
          id: r.id,
          name: r.name,
          status: r.status,
          stepCount: def.steps ? def.steps.length : (def.nodes ?? []).length,
        };
      });
    },
    getWorkflow(id) {
      const row = ctx.workflowRepo.findById(id);
      if (!row) return undefined;
      return {
        id: row.id,
        name: row.name,
        definition: JSON.parse(row.definition ?? '{}'),
        status: row.status,
      };
    },
    createWorkflow(input) {
      const id = `wf_${Date.now()}`;
      const cronExpr = (input as any).cronExpression as string | undefined;
      ctx.workflowRepo.create(
        id,
        input.projectId ?? 'default',
        input.name,
        JSON.stringify(input.definition ?? {}),
        'draft',
        cronExpr,
      );
      if (cronExpr) {
        ctx.taskScheduler.schedule(id, input.name, cronExpr);
      }
      return { id, cronExpression: cronExpr ?? null };
    },
    updateWorkflow(id, input) {
      if (input.name !== undefined || input.definition !== undefined) {
        ctx.workflowRepo.updateNameAndDefinition(
          id,
          input.name,
          input.definition !== undefined ? JSON.stringify(input.definition) : undefined,
        );
      }
    },
    deleteWorkflow(id) {
      ctx.workflowRepo.delete(id);
    },
    async runWorkflow(_id) {
      return { runId: '', status: 'not_implemented' };
    },
    async writeLongTermMemory(content, metadata) {
      let embedding: number[] | undefined;
      if (ctx.gateway) {
        try {
          const result = await ctx.gateway.generateEmbeddings({ texts: [content] });
          embedding = result.embeddings[0];
        } catch {
          /* embedding generation failed — store without */
        }
      }
      return ctx.longTerm.store({
        content,
        metadata: metadata ?? {},
        embedding,
        timestamp: new Date(),
      });
    },
    createEmployee(_input) {},
    registerAgent(input) {
      ctx.agentRegistry.register({
        type: 'custom' as const,
        name: input.name,
        description: input.description,
        modules: { identity: input.systemPrompt },
        modelTier: (((input as any).modelTier as string) || 'default') as any,
        temperature: input.temperature,
        maxResponseTokens: input.maxResponseTokens,
        allowedTools: input.allowedTools,
        contextBudget: input.contextBudget,
      });
      return { type: 'custom', name: input.name };
    },
    updateAgent(name, updates) {
      const existing = ctx.agentRegistry.get(name);
      if (existing && existing.type === 'custom') {
        ctx.agentRegistry.update(name, updates as any);
      }
    },
    deleteAgent(name) {
      ctx.agentRegistry.unregister(name);
      ctx.agentRoleRepo.deleteByName(name);
    },
    listAgents() {
      return ctx.agentRegistry.list().map((r) => ({
        type: r.type,
        name: r.name,
        description: r.description,
        builtIn: r.type !== 'custom',
      }));
    },
    async invokeAgent(_agentName, _message) {
      throw new Error('Agent invocation not available in workflow tool context');
    },
    setProjectContext(projectId) {
      const row = ctx.projectRepo.findById(projectId);
      if (!row) throw new Error(`Project not found: ${projectId}`);
      return { id: row.id, name: row.name };
    },
    createProject(input) {
      const id = `proj_${Date.now()}`;
      ctx.projectRepo.create({
        id,
        name: input.name,
        description: input.description ?? '',
        status: 'active',
        rootPath: input.rootPath ?? '',
        createdAt: new Date(),
      });
      return { id, name: input.name };
    },
    listProjects() {
      const rows = ctx.projectRepo.listAll().filter((p) => !p.archived);
      return rows.map((r) => ({ id: r.id, name: r.name }));
    },
    getProjectContext(projectId) {
      const project = ctx.projectRepo.findById(projectId);
      if (!project) return null;
      return { id: project.id, name: project.name };
    },

    getDashboardStats() {
      const pendingDecisions = ctx.decisionRepo.countByStatus('pending');
      const activeWorkflows = ctx.workflowRepo.countByStatus(['running']);
      const activeProjects = ctx.projectRepo.listAll().filter((p) => !p.archived).length;
      const todayCost = ctx.costTracker.getDailyCost();
      const summary = ctx.metrics.getSummary();
      return {
        pendingDecisions,
        activeWorkflows,
        activeProjects,
        todayCost,
        totalLLMCalls: summary.totalLLMCalls,
        totalTokens: summary.totalTokens,
        totalDecisions: summary.totalDecisions,
        errors: summary.errors,
        recentEvents: [],
      };
    },
    delegateTask(name) {
      return ctx.taskTracker.addTask(name);
    },
    getTaskStatus(taskId) {
      const task = ctx.taskTracker.getTask(taskId);
      if (!task) return null;
      return {
        id: task.id,
        name: task.name,
        status: task.status,
        startTime: task.startTime,
        endTime: task.endTime,
      };
    },
    listActiveTasks() {
      return ctx.taskTracker
        .listActive()
        .map((t) => ({ id: t.id, name: t.name, status: t.status }));
    },
    getDecisionAudit(decisionId) {
      const rows = ctx.auditLogRepo.findByEntity('decision', decisionId);
      return rows.map((r) => ({
        action: r.action,
        actor: r.actor,
        changes: (() => {
          try {
            return JSON.parse(r.changes ?? '{}');
          } catch {
            return {};
          }
        })(),
        timestamp: r.timestamp,
      }));
    },
    getSystemMetrics() {
      return ctx.metrics.getSummary();
    },
    generateEmbeddings: async (texts) => {
      if (!ctx.gateway) throw new Error('No LLM gateway available');
      const result = await ctx.gateway.generateEmbeddings({ texts });
      return result.embeddings;
    },
    getWorkflowRun(runId) {
      const row = ctx.workflowRepo.findRunById(runId);
      if (!row) return null;
      let steps: unknown[] = [];
      try {
        steps = ctx.workflowRepo.findStepsByRunId(runId);
      } catch {
        /* non-fatal */
      }
      return {
        runId: row.run_id,
        workflowId: row.workflow_id,
        status: row.status,
        steps,
        startedAt: row.started_at,
        updatedAt: row.updated_at,
      };
    },
    listWorkflowRuns(workflowId) {
      const rows = ctx.workflowRepo.findRunsByWorkflow(workflowId);
      return rows.map((r) => ({
        runId: r.run_id,
        workflowId: r.workflow_id,
        status: r.status,
        startedAt: r.started_at,
        updatedAt: r.updated_at,
      }));
    },

    // ── File system (capabilities-gated) ──
    readFile: caps.files?.read ? shared.readFile : stub('File read'),
    writeFile: caps.files?.write ? shared.writeFile : stub('File write'),
    editFile: caps.files?.write ? shared.editFile : stub('File edit'),
    applyPatch: caps.files?.write ? shared.applyPatch : stub('Patch application'),
    moveFile: caps.files?.write ? shared.moveFile : stub('File move'),
    copyFile: caps.files?.write ? shared.copyFile : stub('File copy'),
    makeDirectory: caps.files?.write ? shared.makeDirectory : stub('Directory creation'),
    fileInfo: caps.files?.read ? shared.fileInfo : stub('File info'),
    listDirectory: caps.files?.read ? shared.listDirectory : stub('Directory listing'),
    searchFiles: caps.files?.read ? shared.searchFiles : stub('File search'),
    searchContent: caps.files?.read ? shared.searchContent : stub('Content search'),
    deleteFile: caps.files?.write ? shared.deleteFile : stub('File deletion'),
    recentFiles: caps.files?.read ? shared.recentFiles : stub('Recent files'),
    watchFile: caps.files?.read ? shared.watchFile : stub('File watch'),
    indexProject: caps.knowledge?.index ? shared.indexProject : stub('Project indexing'),

    // ── Web / HTTP (capabilities-gated) ──
    webFetch: caps.web?.fetch ? shared.webFetch : stub('Web fetch'),
    httpRequest: caps.web?.http ? shared.httpRequest : stub('HTTP requests'),

    // ── Shell (capabilities-gated) ──
    execCommand: caps.shell ? shared.execCommand : stub('Shell execution'),

    // ── Scheduler (always enabled) ──
    scheduleTask: shared.scheduleTask,
    listScheduledTasks: shared.listScheduledTasks,
    cancelScheduledTask: shared.cancelScheduledTask,

    // ── Knowledge / RAG (capabilities-gated) ──
    indexDocument: caps.knowledge?.index ? shared.indexDocument : stub('Document indexing'),
    searchDocuments: caps.knowledge?.search ? shared.searchDocuments : stub('Document search'),
    clearDocumentIndex: caps.knowledge?.index
      ? shared.clearDocumentIndex
      : stub('Index management'),

    // ── Evaluation (capabilities-gated) ──
    evaluateOutput: caps.evaluation ? shared.evaluateOutput : stub('Evaluation'),

    // ── LSP (always available via TypeScript service) ──
    workspaceSymbols: shared.workspaceSymbols,
    goToDefinition: shared.goToDefinition,
    findReferences: shared.findReferences,
    diagnostics: shared.diagnostics,

    // ── System knowledge (always available) ──
    querySystemKnowledge: shared.querySystemKnowledge,
    getSystemKnowledge: shared.getSystemKnowledge,

    // ── Document (capabilities-gated under files) ──
    readPdf: caps.files?.read ? shared.readPdf : stub('PDF read'),
    readDocx: caps.files?.read ? shared.readDocx : stub('DOCX read'),
    readXlsx: caps.files?.read ? shared.readXlsx : stub('XLSX read'),
    readPptx: caps.files?.read ? shared.readPptx : stub('PPTX read'),

    // ── Archive (capabilities-gated under files) ──
    listZip: caps.files?.read ? shared.listZip : stub('ZIP listing'),
    extractZip: caps.files?.write ? shared.extractZip : stub('ZIP extraction'),

    // ── Browser (capabilities-gated under web) ──
    browserNavigate: caps.web?.fetch ? shared.browserNavigate : stub('Browser navigation'),
    browserClick: caps.web?.fetch ? shared.browserClick : stub('Browser click'),
    browserType: caps.web?.fetch ? shared.browserType : stub('Browser type'),
    browserRead: caps.web?.fetch ? shared.browserRead : stub('Browser read'),
    browserScreenshot: caps.web?.fetch ? shared.browserScreenshot : stub('Browser screenshot'),
    browserEvaluate: caps.web?.fetch ? shared.browserEvaluate : stub('Browser evaluate'),

    // ── Communication (capabilities-gated under web) ──
    fetchRss: caps.web?.fetch ? shared.fetchRss : stub('RSS fetch'),
    sendEmail: caps.web?.fetch ? shared.sendEmail : stub('Email send'),

    // ── System (always available) ──
    readClipboard: shared.readClipboard,
    writeClipboard: shared.writeClipboard,
    sendNotification: shared.sendNotification,
    startProcess: shared.startProcess,
    killProcess: shared.killProcess,
    showOpenDialog: shared.showOpenDialog,
  };
}
