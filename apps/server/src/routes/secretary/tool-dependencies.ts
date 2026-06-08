// buildToolDependencies — extracted from secretary.ts (Phase 1.1 split).
// Builds the ToolDependencies map (~55 tool callbacks) consumed by AgentLoops.

import type { ServerContext } from '../../context.js';
import type { ToolDependencies } from '@cabinet/agent';
import { DEFAULT_CAPTAIN_ID, MessageType, type DelegationTier, type Decision } from '@cabinet/types';
import {
  AgentLoop,
  AgentDispatcher,
  SafetyChecker,
  CheckpointManager,
  AgentRoleRegistry,
  RulesLoader,
  OrganizeInteractiveAgent,
  CliAdapter,
  A2AConnector,
} from '@cabinet/agent';
import type { AgentRoleType, InteractiveSubAgent } from '@cabinet/agent';
import {
  SecretaryAgent,
  IntentParser,
  type ParsedIntent,
  type AgentRouteResult,
} from '@cabinet/secretary';
import { broadcast } from '../../ws/handler.js';
import { detectDangerousCommand } from '../../utils/security.js';
import { chunkText, cosineSimilarity, extractTitle, type ChunkResult } from '../../utils/text-utils.js';
import { globToRegex, safeRegex } from '../../utils/regex-utils.js';
import { isInternalIP } from '../../utils/net-utils.js';
import { createStandardToolExecutor, createStandardMemoryProvider } from '../../agent-factory.js';
import { runWorkflowById } from '../workflows.js';
import {
  buildEnvironmentSection,
  createSystemKnowledgeCapabilities,
  createDocumentCapabilities,
  createArchiveCapabilities,
  createBrowserCapabilities,
  createCommunicationCapabilities,
  createSystemCapabilities,
} from '../../capabilities.js';
import {
  getWorkspaceSymbols,
  getDefinition,
  getReferences,
  getDiagnostics,
} from '../../lsp/ts-service.js';
import { indexProject } from '../../lsp/indexer.js';
import { CABINET_DIR, DocumentChunkRepository, EvaluationResultRepository } from '@cabinet/storage';
import {
  readFile,
  writeFile,
  readdir,
  mkdir,
  stat,
  unlink,
  rmdir,
  rename,
  copyFile as fsCopyFile,
  realpath,
} from 'node:fs/promises';
import { existsSync, mkdirSync, writeFileSync, readdirSync, watchFile, unwatchFile, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname, basename, extname, resolve } from 'node:path';
import { homedir } from 'node:os';

// Shared utilities from sibling extract
import {
  execAsync,
  ROLES_NEEDING_ENV,
  cabinetMdCache,
  loadCabinetMd,
  buildSystemPrompt,
  readTextFile,
  MIME_MAP,
  TEXT_EXTENSIONS,
  isTextFile,
  resolveSafePath,
  buildSafeEnv,
} from './utils.js';
async function executeWorkflowById(workflowId: string, _ctx: ServerContext): Promise<{ runId: string; status: string; steps?: unknown[] }> {
  const result = await runWorkflowById(workflowId);
  return { runId: result.runId, status: result.status, steps: result.steps };
}

export function buildToolDependencies(ctx: ServerContext, activeProjectId?: string, _inject?: Record<string, unknown>): ToolDependencies {
  const docCaps = createDocumentCapabilities();
  const archiveCaps = createArchiveCapabilities();
  const browserCaps = createBrowserCapabilities();
  const commCaps = createCommunicationCapabilities();
  const sysCaps = createSystemCapabilities();

  return {
    // ── Read path ──
    decisionStore: ctx.decisionRepo,
    eventBus: ctx.eventBus,
    shortTerm: ctx.shortTerm,
    longTerm: ctx.longTerm,
    entity: ctx.entity,
    project: ctx.project,

    // ── Decision write callbacks ──
    createDecision(input) {
      const id = `dec_${Date.now()}`;
      const decision = ctx.decisionService.create({
        id,
        projectId: input.projectId,
        type: input.type,
        title: input.title,
        description: input.description,
        options: input.options,
        classification: input.classification,
        captainId: input.captainId,
      }) as Decision;
      if (decision.status === 'approved' && decision.captainId === 'system') {
        ctx.logger.info('Decision auto-approved', {
          decisionId: decision.id,
          title: decision.title,
          level: decision.level,
        });
      }
      return decision;
    },
    approveDecision(decisionId, captainId, chosenOptionId) {
      return ctx.decisionService.approve(decisionId, captainId, chosenOptionId);
    },
    rejectDecision(decisionId, captainId) {
      return ctx.decisionService.reject(decisionId, captainId);
    },

    // ── Workflow read callbacks ──
    listWorkflows() {
      const targetProjectId = activeProjectId ?? 'default';
      const rows = ctx.db
        .prepare(
          'SELECT id, name, definition, status FROM workflows WHERE project_id = ? ORDER BY created_at DESC',
        )
        .all(targetProjectId) as any[];
      return rows.map((r: any) => {
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
      const row = ctx.db
        .prepare('SELECT id, name, definition, status FROM workflows WHERE id = ?')
        .get(id) as any;
      if (!row) return undefined;
      return {
        id: row.id,
        name: row.name,
        definition: JSON.parse(row.definition ?? '{}'),
        status: row.status,
      };
    },

    // ── Workflow write callbacks ──
    createWorkflow(input) {
      let projectId = input.projectId;
      if (!projectId || projectId === 'global') {
        const activeProjects = ctx.projectRepo.listByStatus('active');
        const fallback = activeProjects[0];
        if (!fallback) {
          throw new Error(
            'No active project available. Create a project first before creating a workflow.',
          );
        }
        projectId = fallback.id;
      }
      // Verify the project exists to satisfy foreign key constraint
      const project = ctx.projectRepo.findById(projectId);
      if (!project) {
        throw new Error(`Project not found: ${projectId}`);
      }
      const id = `wf_${Date.now()}`;
      ctx.db
        .prepare(
          'INSERT INTO workflows (id, project_id, name, definition, status) VALUES (?, ?, ?, ?, ?)',
        )
        .run(id, projectId, input.name, JSON.stringify(input.definition ?? {}), 'draft');
      ctx.logger.info('Workflow created via tool', { id, name: input.name, projectId });
      return { id };
    },
    updateWorkflow(id, input) {
      if (input.name !== undefined || input.definition !== undefined) {
        const name = input.name;
        const definition = input.definition;
        if (name !== undefined && definition !== undefined) {
          ctx.workflowRepo.updateNameAndDefinition(id, name, JSON.stringify(definition));
        } else if (name !== undefined) {
          ctx.workflowRepo.updateNameAndDefinition(id, name);
        } else if (definition !== undefined) {
          ctx.workflowRepo.updateNameAndDefinition(id, undefined, JSON.stringify(definition));
        }
      }
    },
    deleteWorkflow(id) {
      ctx.workflowRepo.delete(id);
      ctx.logger.info('Workflow deleted via tool', { id });
    },
    async runWorkflow(id) {
      return executeWorkflowById(id, ctx);
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

    // ── Memory write callbacks ──
    async writeLongTermMemory(content, metadata) {
      // Auto-generate embedding for semantic search
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

    // ── Employee write callback ──
    createEmployee(input) {
      const id = `emp_${Date.now()}`;
      const targetProjectId = activeProjectId ?? 'default';
      ctx.db
        .prepare(
          'INSERT INTO employees (id, project_id, name, role, kind, persona, permission_level) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(id, targetProjectId, input.name, input.role, input.kind, '{}', 'read');
      ctx.logger.info('Employee created via tool', { id, name: input.name });
    },

    // ── Agent registry callbacks ──
    registerAgent(input) {
      const role = {
        type: 'custom' as const,
        name: input.name,
        description: input.description,
        modules: { identity: input.systemPrompt },
        modelTier: ((input as any).modelTier as string) || 'default',
        temperature: input.temperature,
        maxResponseTokens: input.maxResponseTokens,
        allowedTools: input.allowedTools,
        contextBudget: input.contextBudget,
      };
      ctx.agentRegistry.register(role as any);
      // Persist to DB
      try {
        ctx.agentRoleRepo.upsert({
          type: input.name,
          name: input.name,
          description: input.description ?? '',
          system_prompt: input.systemPrompt ?? '',
          model_tier: ((input as any).modelTier as string) || 'default',
          temperature: input.temperature ?? 0.3,
          max_response_tokens: input.maxResponseTokens ?? 4000,
          allowed_tools: JSON.stringify(input.allowedTools ?? []),
          context_budget: input.contextBudget ?? 0.4,
          is_builtin: 0,
          created_at: new Date().toISOString(),
        });
      } catch (e) {
        ctx.logger.warn('Failed to persist custom agent to DB', {
          name: input.name,
          error: String(e),
        });
      }
      // Persist to disk (~/.cabinet/agents/<name>/agent.json)
      try {
        const agentsDir = join(CABINET_DIR, 'agents', input.name);
        if (!existsSync(agentsDir)) mkdirSync(agentsDir, { recursive: true });
        writeFileSync(join(agentsDir, 'agent.json'), JSON.stringify(role, null, 2), 'utf-8');
      } catch (e) {
        ctx.logger.warn('Failed to persist custom agent to disk', {
          name: input.name,
          error: String(e),
        });
      }
      ctx.logger.info('Agent registered via tool', { name: input.name });
      return { type: 'custom', name: input.name };
    },
    updateAgent(name, updates) {
      const existing = ctx.agentRegistry.get(name);
      if (existing && existing.type === 'custom') {
        ctx.agentRegistry.update(name, updates as any);
        // Update DB
        ctx.agentRoleRepo.update(name, {
          system_prompt: updates.systemPrompt as string,
          model: updates.model as string,
          model_tier: updates.modelTier as string,
          temperature: updates.temperature as number,
          max_response_tokens: updates.maxResponseTokens as number,
          allowed_tools: updates.allowedTools ? JSON.stringify(updates.allowedTools) : undefined,
          context_budget: updates.contextBudget as number,
        });
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
    async invokeAgent(agentName, message, callerSessionId) {
      const registry = ctx.agentRegistry;
      const role = registry.get(agentName);
      if (!role) throw new Error(`Agent not found: ${agentName}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const loop = (_inject?.getAgentLoopForRole as any)?.(
        role.type as AgentRoleType,
        `${callerSessionId ?? 'invoke'}_${Date.now()}`,
        'global',
        DEFAULT_CAPTAIN_ID,
        undefined,
        (_inject?.resolveModel as (arg: { modelTier: string }) => string)?.({ modelTier: 'default' }),
        callerSessionId,
      );
      if (!loop) throw new Error(`Cannot invoke ${agentName}: no LLM gateway available`);
      // Inject recent conversation context from caller session
      let augmentedMessage = message;
      if (callerSessionId) {
        const session = ctx.sessionManager.get(callerSessionId);
        if (session && session.messages.length > 0) {
          const recent = session.messages.slice(-10);
          const history = recent
            .map((m) => `[${m.role}]: ${m.content.slice(0, 500)}`)
            .join('\n');
          augmentedMessage = `[Conversation history — use for context only. The current task follows after "---"]:\n${history}\n\n---\n\n[Current task]: ${message}`;
        }
      }
      const result = await loop.run(augmentedMessage);
      return { agentName: role.name, response: result.content };
    },

    // ── Project tools ──
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
        status: 'active' as const,
        rootPath: input.rootPath ?? '',
        createdAt: new Date(),
      });
      ctx.projectContextRepo.insert({
        project_id: id,
        summary: '',
        goals: '[]',
        milestones: '[]',
        constraints: '{}',
        tech_summary: '',
        risk_map: '[]',
        key_decisions: '[]',
        updated_at: new Date().toISOString(),
      });
      // Initialize project memory so context is immediately available to agents
      ctx.project.initialize(id, []);
      ctx.logger.info('Project created via tool', { id, name: input.name });
      return { id, name: input.name };
    },
    listProjects() {
      const rows = ctx.projectRepo.listByStatus('active');
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        lastActivityAt: r.lastActivityAt,
        activeWorkflowCount: 0,
      }));
    },
    getProjectContext(projectId) {
      const project = ctx.projectRepo.findById(projectId);
      if (!project) return null;
      const pctx = ctx.projectContextRepo.findByProjectId(projectId);
      const decisions = ctx.decisionRepo.listByProject(projectId, { limit: 5 });
      return {
        id: project.id,
        name: project.name,
        description: project.description,
        rootPath: project.rootPath ?? '',
        summary: pctx?.summary ?? '',
        goals: JSON.parse(pctx?.goals ?? '[]'),
        constraints: JSON.parse(pctx?.constraints ?? '{}'),
        recentDecisions: decisions,
      };
    },

    getDashboardStats() {
      const pendingDecisions = ctx.decisionRepo.listAllPending().length;
      const activeWorkflows = ctx.workflowRepo.countByStatus(['running']);
      const activeProjects = ctx.projectRepo.listAll().filter((p) => !p.archived).length;
      const todayCost = ctx.costTracker.getDailyCost();
      const metrics = ctx.metrics.getSummary();
      const recentEvents = ctx.eventRepo
        .findAll()
        .slice(-10)
        .map((e) => ({
          message: e.messageType,
          time: e.timestamp instanceof Date ? e.timestamp.toISOString() : String(e.timestamp),
        }));
      return {
        pendingDecisions,
        activeWorkflows,
        activeProjects,
        todayCost,
        totalLLMCalls: metrics.totalLLMCalls,
        totalTokens: metrics.totalTokens,
        totalDecisions: metrics.totalDecisions,
        errors: metrics.errors,
        recentEvents,
      };
    },

    delegateTask(name, agentName, description) {
      return ctx.taskTracker.addTask(name, agentName, description);
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

    // ── File system callbacks ──
    readFile: async (filePath, offset, limit) => {
      const safePath = await resolveSafePath(filePath);
      ctx.fileTracker.record('global', safePath, 'read');
      const ext = extname(filePath).toLowerCase();
      const mimeType = MIME_MAP[ext] ?? null;
      const isText = isTextFile(ext);

      if (isText) {
        const content = await readTextFile(safePath);
        const size = Buffer.byteLength(content, 'utf-8');
        if (offset !== undefined || limit !== undefined) {
          const lines = content.split('\n');
          const start = offset ?? 0;
          const end = limit ? start + limit : lines.length;
          return {
            content: lines.slice(start, end).join('\n'),
            size,
            encoding: 'utf-8' as const,
            mimeType: mimeType ?? undefined,
          };
        }
        return { content, size, encoding: 'utf-8' as const, mimeType: mimeType ?? undefined };
      }

      // Binary file — read as base64
      const buf = await readFile(safePath);
      if (buf.length > 5 * 1024 * 1024) throw new Error('Binary file exceeds 5MB limit');
      const base64 = buf.toString('base64');
      return {
        content: base64,
        size: buf.length,
        encoding: 'base64' as const,
        mimeType: mimeType ?? 'application/octet-stream',
      };
    },

    writeFile: async (filePath, content, overwrite) => {
      const safePath = await resolveSafePath(filePath);
      ctx.fileTracker.record('global', safePath, 'write');
      if (content.length > 5 * 1024 * 1024) throw new Error('Content exceeds 5MB limit');
      if (overwrite === false && existsSync(safePath)) {
        return { written: false, skipped: true };
      }
      await mkdir(dirname(safePath), { recursive: true });
      await writeFile(safePath, content, 'utf-8');
      return { written: true, skipped: false };
    },

    editFile: async (filePath, oldString, newString, replaceAll) => {
      const safePath = await resolveSafePath(filePath);
      ctx.fileTracker.record('global', safePath, 'edit');
      const content = await readTextFile(safePath);
      if (!content.includes(oldString)) return { changed: false, occurrences: 0 };
      if (replaceAll) {
        const parts = content.split(oldString);
        const occurrences = parts.length - 1;
        await writeFile(safePath, parts.join(newString), 'utf-8');
        return { changed: true, occurrences };
      }
      await writeFile(safePath, content.replace(oldString, newString), 'utf-8');
      return { changed: true, occurrences: 1 };
    },

    applyPatch: async (filePath, diff) => {
      const safePath = await resolveSafePath(filePath);
      const content = await readTextFile(safePath);
      const lines = content.split('\n');
      const diffLines = diff.split('\n');
      let hunksApplied = 0;
      let hunksFailed = 0;
      let i = 0;
      while (i < diffLines.length) {
        const line = diffLines[i];
        if (
          !line ||
          line.startsWith('diff ') ||
          line.startsWith('--- ') ||
          line.startsWith('+++ ') ||
          line.startsWith('index ')
        ) {
          i++;
          continue;
        }
        const hunkMatch = line.match(/^@@\s+-(\d+),?(\d*)\s+\+(\d+),?(\d*)\s+@@/);
        if (hunkMatch) {
          const oldStart = parseInt(hunkMatch[1]!, 10) - 1;
          const oldCount = hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1;
          const newStart = parseInt(hunkMatch[3]!, 10) - 1;
          const newCount = hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1;
          i++;
          const hunkLines: { type: 'context' | 'add' | 'remove'; content: string }[] = [];
          while (
            i < diffLines.length &&
            !diffLines[i]!.startsWith('@@') &&
            !diffLines[i]!.startsWith('diff ')
          ) {
            const hl = diffLines[i]!;
            if (hl.startsWith('+')) hunkLines.push({ type: 'add', content: hl.slice(1) });
            else if (hl.startsWith('-')) hunkLines.push({ type: 'remove', content: hl.slice(1) });
            else if (hl.startsWith(' ')) hunkLines.push({ type: 'context', content: hl.slice(1) });
            i++;
          }
          // Verify context matches
          let contextIdx = 0;
          let mismatch = false;
          const result: string[] = [];
          let srcIdx = oldStart;
          for (const hl of hunkLines) {
            if (hl.type === 'context') {
              if (srcIdx < lines.length && lines[srcIdx] !== hl.content) {
                mismatch = true;
                break;
              }
              result.push(lines[srcIdx]!);
              srcIdx++;
              contextIdx++;
            } else if (hl.type === 'remove') {
              if (srcIdx < lines.length && lines[srcIdx] !== hl.content) {
                mismatch = true;
                break;
              }
              srcIdx++;
            } else if (hl.type === 'add') {
              result.push(hl.content);
            }
          }
          if (mismatch) {
            hunksFailed++;
          } else {
            // Apply: replace [oldStart, srcIdx) with result
            const before = lines.slice(0, oldStart);
            const after = lines.slice(srcIdx);
            const newLines = [...before, ...result, ...after];
            lines.length = 0;
            lines.push(...newLines);
            hunksApplied++;
          }
        } else {
          i++;
        }
      }
      if (hunksApplied > 0) {
        await writeFile(safePath, lines.join('\n'), 'utf-8');
        return { applied: true, hunksApplied, hunksFailed };
      }
      return { applied: false, hunksApplied, hunksFailed };
    },

    listDirectory: async (dirPath) => {
      const safePath = await resolveSafePath(dirPath);
      const root = process.cwd();
      const entries = await readdir(safePath, { withFileTypes: true });
      return entries
        .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules')
        .map((e) => ({
          name: e.name,
          path: relative(root, join(safePath, e.name)).replace(/\\/g, '/'),
          isDir: e.isDirectory(),
        }));
    },

    searchFiles: async (pattern, dir) => {
      const root = resolve(process.cwd());
      const searchRoot = dir ? await resolveSafePath(dir) : root;
      const results: string[] = [];
      const regex = globToRegex(pattern);
      async function walk(currentDir: string, depth: number) {
        if (depth > 5) return;
        let entries;
        try {
          entries = await readdir(currentDir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist')
            continue;
          const entryPath = join(currentDir, entry.name);
          if (entry.isDirectory()) {
            await walk(entryPath, depth + 1);
          } else if (regex.test(relative(root, entryPath).replace(/\\/g, '/'))) {
            results.push(relative(root, entryPath).replace(/\\/g, '/'));
          }
        }
      }
      await walk(searchRoot, 0);
      return results.slice(0, 200);
    },

    searchContent: async (pattern, dir, include) => {
      const root = resolve(process.cwd());
      const searchRoot = dir ? await resolveSafePath(dir) : root;
      const results: { file: string; line: number; content: string }[] = [];
      const regex = safeRegex(pattern);
      const includeRegex = include ? globToRegex(include) : null;
      async function walk(currentDir: string, depth: number) {
        if (depth > 5 || results.length >= 100) return;
        let entries;
        try {
          entries = await readdir(currentDir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist')
            continue;
          const entryPath = join(currentDir, entry.name);
          if (entry.isDirectory()) {
            await walk(entryPath, depth + 1);
          } else {
            const relPath = relative(root, entryPath).replace(/\\/g, '/');
            if (includeRegex && !includeRegex.test(relPath)) continue;
            try {
              const content = await readTextFile(entryPath);
              const lines = content.split('\n');
              for (let i = 0; i < lines.length && results.length < 100; i++) {
                const line = lines[i];
                if (line !== undefined && regex.test(line)) {
                  results.push({ file: relPath, line: i + 1, content: line.slice(0, 200) });
                }
              }
            } catch {
              /* skip unreadable files */
            }
          }
        }
      }
      await walk(searchRoot, 0);
      return results;
    },

    deleteFile: async (filePath) => {
      const safePath = await resolveSafePath(filePath);
      ctx.fileTracker.record('global', safePath, 'delete');
      const s = await stat(safePath);
      if (s.isDirectory()) {
        await rmdir(safePath);
      } else {
        await unlink(safePath);
      }
    },

    moveFile: async (source, destination) => {
      const safeSrc = await resolveSafePath(source);
      const safeDest = await resolveSafePath(destination);
      ctx.fileTracker.record('global', safeSrc, 'move');
      await mkdir(dirname(safeDest), { recursive: true });
      await rename(safeSrc, safeDest);
    },

    copyFile: async (source, destination) => {
      const safeSrc = await resolveSafePath(source);
      const safeDest = await resolveSafePath(destination);
      await mkdir(dirname(safeDest), { recursive: true });
      await fsCopyFile(safeSrc, safeDest);
    },

    makeDirectory: async (dirPath) => {
      const safePath = await resolveSafePath(dirPath);
      await mkdir(safePath, { recursive: true });
    },

    fileInfo: async (filePath) => {
      const safePath = await resolveSafePath(filePath);
      const s = await stat(safePath);
      return {
        size: s.size,
        modifiedAt: s.mtime.toISOString(),
        createdAt: s.birthtime.toISOString(),
        isDirectory: s.isDirectory(),
        isFile: s.isFile(),
      };
    },

    recentFiles: async (limit) => {
      return ctx.fileTracker.getRecent('global', limit);
    },

    indexProject: async (projectId, rootPath, force) => {
      return indexProject({
        projectId,
        rootPath,
        db: ctx.db,
        gateway: ctx.gateway,
        logger: ctx.logger,
        force,
      });
    },

    watchFile: async (filePath, timeoutMs) => {
      const safePath = await resolveSafePath(filePath);
      return new Promise((resolve) => {
        const timer = setTimeout(
          () => {
            unwatchFile(safePath);
            resolve({ changed: false, size: 0 });
          },
          Math.min(timeoutMs ?? 30000, 120000),
        );
        try {
          watchFile(safePath, { interval: 500 }, (curr) => {
            clearTimeout(timer);
            unwatchFile(safePath);
            resolve({ changed: true, size: curr.size });
          });
        } catch {
          clearTimeout(timer);
          resolve({ changed: false, size: 0 });
        }
      });
    },

    // ── Web / HTTP callbacks ──
    webFetch: async (url, maxLength) => {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol))
        throw new Error('Only HTTP/HTTPS URLs are allowed');
      if (isInternalIP(parsed.hostname)) throw new Error('Internal IP addresses are not allowed');

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Cabinet/2.0 WebFetcher' },
          redirect: 'follow',
        });
        const contentType = res.headers.get('content-type') ?? 'text/plain';
        const text = await res.text();
        const limit = maxLength ?? 10000;
        let content = text;
        if (contentType.includes('html')) {
          content = text
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
            .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
            .replace(/<header[\s\S]*?<\/header>/gi, ' ')
            .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
            .replace(/<\/?.[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        }
        const truncated = content.slice(0, Math.min(limit, 2 * 1024 * 1024));
        const title = extractTitle(text, contentType);
        return { content: truncated, contentType, status: res.status, title };
      } finally {
        clearTimeout(timer);
      }
    },

    httpRequest: async (method, url, headers, body) => {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol))
        throw new Error('Only HTTP/HTTPS URLs are allowed');
      if (isInternalIP(parsed.hostname)) throw new Error('Internal IP addresses are not allowed');
      if (body && body.length > 1 * 1024 * 1024) throw new Error('Request body exceeds 1MB limit');

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      try {
        const res = await fetch(url, {
          method,
          signal: controller.signal,
          headers: { 'User-Agent': 'Cabinet/2.0', ...headers },
          body: method !== 'GET' && method !== 'HEAD' ? body : undefined,
          redirect: 'follow',
        });
        const resHeaders: Record<string, string> = {};
        res.headers.forEach((v, k) => {
          resHeaders[k] = v;
        });
        const resBody = await res.text();
        return {
          status: res.status,
          headers: resHeaders,
          body: resBody.slice(0, 50 * 1024 * 1024),
        };
      } finally {
        clearTimeout(timer);
      }
    },

    githubApiFetch: async (owner, repo, path) => {
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path ?? ''}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetch(apiUrl, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Cabinet/2.0', Accept: 'application/vnd.github.v3+json' },
        });
        if (!res.ok)
          return { content: '', error: `GitHub API error: ${res.status} ${res.statusText}` };
        const data = await res.json();
        if (Array.isArray(data)) {
          const items = data.map((item: any) => ({
            name: item.name,
            path: item.path,
            type: item.type,
          }));
          return {
            content:
              `Directory listing for ${path ?? 'root'}:\n` +
              items.map((i: any) => `- ${i.type}: ${i.name}`).join('\n'),
            items,
          };
        }
        if (data.content && data.encoding === 'base64') {
          return { content: Buffer.from(data.content, 'base64').toString('utf-8').slice(0, 50000) };
        }
        return { content: JSON.stringify(data, null, 2) };
      } finally {
        clearTimeout(timer);
      }
    },

    cleanWebFetch: async (url, maxLength) => {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol))
        throw new Error('Only HTTP/HTTPS URLs are allowed');
      if (isInternalIP(parsed.hostname)) throw new Error('Internal IP addresses are not allowed');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Cabinet/2.0 WebFetcher' },
          redirect: 'follow',
        });
        const text = await res.text();
        const title = extractTitle(text, res.headers.get('content-type') ?? 'text/plain');
        const cleaned = text
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
          .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
          .replace(/<header[\s\S]*?<\/header>/gi, ' ')
          .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
          .replace(/<\/?.[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        return { content: cleaned.slice(0, maxLength ?? 10000), title };
      } finally {
        clearTimeout(timer);
      }
    },

    // ── Shell execution callback ──
    execCommand: async (command, cwd, timeout) => {
      const blocked = detectDangerousCommand(command);
      if (blocked) throw new Error(`Command blocked for safety: ${blocked}`);
      const workDir = cwd ? await resolveSafePath(cwd) : process.cwd();

      const { stdout, stderr } = await execAsync(command, {
        cwd: workDir,
        timeout: timeout ?? 60000,
        maxBuffer: 10 * 1024 * 1024,
        env: buildSafeEnv(),
        shell: process.platform === 'win32' ? process.env.COMSPEC || 'cmd.exe' : '/bin/bash',
      });
      return { stdout, stderr, exitCode: 0 };
    },

    // ── Knowledge / RAG callbacks ──
    indexDocument: async (filePath, projectId) => {
      const safePath = await resolveSafePath(filePath);
      const content = await readTextFile(safePath);
      if (content.length === 0) throw new Error('File is empty');

      // Clear previous chunks for this file
      new DocumentChunkRepository(ctx.db).deleteByPath(projectId, filePath);

      // Chunk the content
      const chunks = chunkText(content, 800, 100);
      if (chunks.length === 0) throw new Error('No chunks produced');

      // Generate embeddings for each chunk
      let embeddings: number[][] = [];
      if (ctx.gateway) {
        try {
          const result = await ctx.gateway.generateEmbeddings({
            texts: chunks.map((c) => c.content),
          });
          embeddings = result.embeddings;
        } catch {
          // Store without embeddings — text search fallback
        }
      }

      // Store chunks
      const chunkRepo = new DocumentChunkRepository(ctx.db);
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!;
        chunkRepo.insert({
          project_id: projectId,
          source_path: filePath,
          chunk_index: i,
          content: chunk.content,
          embedding: embeddings[i] ? JSON.stringify(embeddings[i]) : null,
          metadata: JSON.stringify({ startChar: chunk.startChar, endChar: chunk.endChar }),
        });
      }
      ctx.logger.info('Document indexed', { path: filePath, chunks: chunks.length, projectId });
      return { chunkCount: chunks.length, filePath };
    },

    searchDocuments: async (query, projectId, limit) => {
      // Try semantic search first
      let queryEmbedding: number[] | undefined;
      if (ctx.gateway) {
        try {
          const result = await ctx.gateway.generateEmbeddings({ texts: [query] });
          queryEmbedding = result.embeddings[0];
        } catch {
          /* fall back to text search */
        }
      }

      const rows = ctx.db
        .prepare('SELECT * FROM document_chunks WHERE project_id = ?')
        .all(projectId) as any[];

      if (rows.length === 0) return { chunks: [] };

      if (queryEmbedding) {
        // Semantic search
        const scored = rows
          .map((row: any) => {
            const emb = row.embedding ? (JSON.parse(row.embedding) as number[]) : null;
            const score = emb ? cosineSimilarity(queryEmbedding!, emb) : 0;
            return {
              content: row.content as string,
              sourcePath: row.source_path as string,
              chunkIndex: row.chunk_index as number,
              score,
            };
          })
          .filter((c) => c.score > 0.25)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit ?? 5);
        return { chunks: scored };
      }

      // Text search fallback
      const lower = query.toLowerCase();
      const scored = rows
        .filter((row: any) => (row.content as string).toLowerCase().includes(lower))
        .slice(0, limit ?? 5)
        .map((row: any) => ({
          content: row.content as string,
          sourcePath: row.source_path as string,
          chunkIndex: row.chunk_index as number,
          score: 0.5,
        }));
      return { chunks: scored };
    },

    clearDocumentIndex: async (projectId, filePath) => {
      if (filePath) {
        const result = ctx.db
          .prepare('DELETE FROM document_chunks WHERE project_id = ? AND source_path = ?')
          .run(projectId, filePath);
        return { removed: result.changes };
      }
      const result = ctx.db
        .prepare('DELETE FROM document_chunks WHERE project_id = ?')
        .run(projectId);
      return { removed: result.changes };
    },

    // ── LSP / Code Intelligence ──
    workspaceSymbols: async (query) => getWorkspaceSymbols(query),
    goToDefinition: async (file, line, column) => getDefinition(file, line, column),
    findReferences: async (file, line, column) => getReferences(file, line, column),
    diagnostics: async (file) => getDiagnostics(file),

    // ── Evaluation callback ──
    evaluateOutput: async (content, sourceType, sourceId) => {
      if (!ctx.gateway) throw new Error('No LLM gateway available for evaluation');

      const evaluatorModel = 'claude-haiku-4-5';
      const prompt = [
        'Evaluate the following AI-generated output across 4 dimensions. Score each 1-10.',
        '',
        'Dimensions:',
        '1. accuracy — factual correctness and absence of errors',
        '2. completeness — covers all necessary aspects, nothing important missing',
        '3. actionability — provides concrete, usable next steps or recommendations',
        '4. clarity — well-structured, easy to understand, appropriate tone',
        '',
        'Output to evaluate:',
        content.slice(0, 4000),
        '',
        'Respond with ONLY a JSON object:',
        '{',
        '  "overallScore": <number 1-10>,',
        '  "dimensions": {',
        '    "accuracy": {"score": <1-10>, "feedback": "<1 sentence>"},',
        '    "completeness": {"score": <1-10>, "feedback": "<1 sentence>"},',
        '    "actionability": {"score": <1-10>, "feedback": "<1 sentence>"},',
        '    "clarity": {"score": <1-10>, "feedback": "<1 sentence>"}',
        '  },',
        '  "feedback": "<2-3 sentence overall assessment>"',
        '}',
      ].join('\n');

      try {
        const result = await ctx.gateway.generateText({
          model: evaluatorModel,
          systemPrompt: 'You are an expert quality evaluator. Be precise and constructive.',
          messages: [{ role: 'user', content: prompt }],
        });
        const parsed = JSON.parse(result.content);
        const overallScore = typeof parsed.overallScore === 'number' ? parsed.overallScore : 5;
        const dimensions = parsed.dimensions ?? {};

        // Persist evaluation result
        new EvaluationResultRepository(ctx.db).insert({
          project_id: 'default',
          session_id: null,
          source_type: sourceType,
          source_id: sourceId ?? null,
          overall_score: overallScore,
          dimensions: JSON.stringify(dimensions),
          feedback: parsed.feedback ?? '',
          evaluator_model: evaluatorModel,
        });

        return { overallScore, dimensions, feedback: parsed.feedback ?? '', evaluatorModel };
      } catch {
        return {
          overallScore: 5,
          dimensions: {},
          feedback: 'Evaluation failed — model output unparseable',
          evaluatorModel,
        };
      }
    },

    // ── Scheduler callbacks ──
    scheduleTask: async (name, cronExpression, prompt, recurring) => {
      const id = `wf_${Date.now()}`;
      const def = {
        steps: [{ type: 'llm', title: name, data: { prompt } }],
        nodes: [
          { id: 'start', type: 'start' },
          { id: 'exec', type: 'llm', title: name, data: { prompt } },
          { id: 'end', type: 'end' },
        ],
        edges: [
          { from: 'start', to: 'exec' },
          { from: 'exec', to: 'end' },
        ],
      };
      const targetProjectId = activeProjectId ?? (ctx.projectRepo.listAll()[0]?.id ?? 'default');
      ctx.workflowRepo.create(id, targetProjectId, name, JSON.stringify(def), 'draft', recurring ? cronExpression : undefined);
      if (recurring) {
        ctx.taskScheduler.schedule(id, name, cronExpression);
      }
      return { id };
    },
    listScheduledTasks: async () => {
      return ctx.taskScheduler.list();
    },
    cancelScheduledTask: async (id) => {
      ctx.taskScheduler.unschedule(id);
      ctx.workflowRepo.updateCron(id, null);
    },

    // ── System knowledge callbacks ──
    querySystemKnowledge: async (query, limit) => {
      return createSystemKnowledgeCapabilities({
        db: ctx.db,
        gateway: ctx.gateway,
        logger: ctx.logger,
        taskScheduler: ctx.taskScheduler,
        workflowRepo: ctx.workflowRepo,
        projectRepo: ctx.projectRepo,
      }).querySystemKnowledge(query, limit);
    },
    getSystemKnowledge: async (topic) => {
      return createSystemKnowledgeCapabilities({
        db: ctx.db,
        gateway: ctx.gateway,
        logger: ctx.logger,
        taskScheduler: ctx.taskScheduler,
        workflowRepo: ctx.workflowRepo,
        projectRepo: ctx.projectRepo,
      }).getSystemKnowledge(topic);
    },

    // ── Document capabilities ──
    readPdf: docCaps.readPdf,
    readDocx: docCaps.readDocx,
    readXlsx: docCaps.readXlsx,
    readPptx: docCaps.readPptx,

    // ── Archive capabilities ──
    listZip: archiveCaps.listZip,
    extractZip: archiveCaps.extractZip,

    // ── Browser capabilities ──
    browserNavigate: browserCaps.browserNavigate,
    browserClick: browserCaps.browserClick,
    browserType: browserCaps.browserType,
    browserRead: browserCaps.browserRead,
    browserScreenshot: browserCaps.browserScreenshot,
    browserEvaluate: browserCaps.browserEvaluate,

    // ── Communication capabilities ──
    fetchRss: commCaps.fetchRss,
    sendEmail: commCaps.sendEmail,

    // ── System capabilities ──
    readClipboard: sysCaps.readClipboard,
    writeClipboard: sysCaps.writeClipboard,
    sendNotification: sysCaps.sendNotification,
    startProcess: sysCaps.startProcess,
    killProcess: sysCaps.killProcess,
    showOpenDialog: sysCaps.showOpenDialog,
  };
}
