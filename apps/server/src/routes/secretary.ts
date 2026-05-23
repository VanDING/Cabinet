import { Hono } from 'hono';
import { z } from 'zod';
import { getServerContext, onTierChange, type ServerContext } from '../context.js';
import { DEFAULT_CAPTAIN_ID, MessageType, type DelegationTier } from '@cabinet/types';
import {
  AgentLoop,
  AgentDispatcher,
  ToolExecutor,
  SafetyChecker,
  CheckpointManager,
  registerCabinetTools,
  registerSkillTools,
  registerMCPTools,
  AgentRoleRegistry,
} from '@cabinet/agent';
import type { ToolDependencies, AgentRoleType } from '@cabinet/agent';
import { SecretaryAgent, IntentParser, GreetingService } from '@cabinet/secretary';
import {
  buildChairPrompt, parseChairResponse,
  buildAdvisorPrompt, parseAdvisorResponse,
  buildReviewerTask, parseReviewerResponse,
  buildExtractionPrompt, parseExtractionResponse,
  generateSynthesis,
  type AdvisorFinding,
} from '@cabinet/meeting';
import { ProjectIsolatedMemory } from '@cabinet/memory';
import { broadcast } from '../ws/handler.js';
import type { DispatchMode } from '@cabinet/agent';
import type { Decision } from '@cabinet/types';
import { buildEnvironmentSection } from '../capabilities.js';
import { getWorkspaceSymbols, getDefinition, getReferences, getDiagnostics } from '../lsp/ts-service.js';
import { indexProject } from '../lsp/indexer.js';
import { CABINET_DIR, DocumentChunkRepository, EvaluationResultRepository } from '@cabinet/storage';
import { readFile, writeFile, readdir, mkdir, stat, unlink, rmdir, rename, copyFile as fsCopyFile, realpath } from 'node:fs/promises';
import { existsSync, mkdirSync, writeFileSync, readdirSync, watchFile, unwatchFile } from 'node:fs';
import { join, relative, dirname, basename, extname, resolve } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const RAG_LONGTERM_TOP_K = 5;

/** Roles that need the system environment section in their prompt. */
const ROLES_NEEDING_ENV = new Set(['secretary', 'workflow_designer', 'organize']);

function buildSystemPrompt(roleType: string, roleSystemPrompt: string, projectRootPath?: string): string {
  if (ROLES_NEEDING_ENV.has(roleType)) {
    return buildEnvironmentSection(projectRootPath) + '\n\n' + roleSystemPrompt;
  }
  return roleSystemPrompt;
}

/** Read a text file with auto-detected encoding (UTF-8 → GBK fallback). */
async function readTextFile(filePath: string): Promise<string> {
  const buf = await readFile(filePath);
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    return buf.toString('utf-8').slice(1); // strip BOM
  }
  const utf8 = buf.toString('utf-8');
  if (utf8.includes('�')) {
    try { return new TextDecoder('gbk').decode(buf); } catch { /* fall through */ }
  }
  return utf8;
}

export const secretaryRouter = new Hono();

// ── File tool helpers ──

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.zip': 'application/zip', '.tar': 'application/x-tar', '.gz': 'application/gzip',
};

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.mdx', '.json', '.xml', '.yml', '.yaml', '.toml', '.ini', '.cfg',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.scss', '.less',
  '.html', '.htm', '.vue', '.svelte',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.cpp', '.h', '.hpp',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
  '.sql', '.graphql', '.proto',
  '.env', '.gitignore', '.dockerignore', '.editorconfig',
  '.csv', '.tsv', '.log',
  '.lock', '.toml',
]);

function isTextFile(ext: string): boolean {
  if (TEXT_EXTENSIONS.has(ext)) return true;
  if (!ext || ext.length > 10) return true; // no extension = probably text
  return false;
}

async function resolveSafePath(filePath: string): Promise<string> {
  const fullPath = resolve(filePath);
  try {
    return await realpath(fullPath);
  } catch {
    // File doesn't exist yet (e.g. write_file), allow the unresolved path
    return fullPath;
  }
}

function globToRegex(pattern: string): RegExp {
  let re = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  if (pattern.startsWith('*')) re = '.*' + re.slice(2);
  return new RegExp('^' + re + '$');
}

function safeRegex(pattern: string): RegExp {
  try {
    return new RegExp(pattern, 'i');
  } catch {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(escaped, 'i');
  }
}

function isInternalIP(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '0.0.0.0') return true;
  if (hostname.startsWith('10.') || hostname.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
  if (hostname === '[::1]' || hostname === '[fe80::]' || hostname.startsWith('[fc') || hostname.startsWith('[fd')) return true;
  return false;
}

function extractTitle(html: string, contentType: string): string | undefined {
  if (!contentType.includes('html')) return undefined;
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match?.[1]?.trim().slice(0, 200);
}

const SAFE_ENV_KEYS = new Set([
  'PATH', 'HOME', 'USER', 'USERNAME', 'TEMP', 'TMP', 'TMPDIR',
  'SHELL', 'LANG', 'LC_ALL', 'TERM', 'COLORTERM',
  'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT',
  'NODE_ENV', 'NODE_PATH',
  'DISPLAY', 'WAYLAND_DISPLAY',
  'SSH_AUTH_SOCK',
  'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME',
  'PNPM_HOME', 'npm_config_cache',
]);

function buildSafeEnv(): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (SAFE_ENV_KEYS.has(key) && value !== undefined) {
      safe[key] = value;
    }
  }
  if (!safe.PATH) safe.PATH = process.platform === 'win32' ? 'C:\\Windows\\System32;C:\\Windows;C:\\Windows\\System32\\Wbem' : '/usr/local/bin:/usr/bin:/bin';
  if (!safe.HOME) safe.HOME = process.cwd();
  return safe;
}

function detectDangerousCommand(command: string): string | null {
  const lower = command.toLowerCase();
  if (/\brm\s+-rf\s+\//.test(lower)) return 'rm -rf /';
  if (/\bdd\s+if=/.test(lower)) return 'dd';
  if (/:\s*\(\)\s*\{/.test(lower)) return 'fork bomb pattern';
  if (/>\s*\/dev\/sda/.test(lower)) return 'raw device write';
  if (/\bmkfs\./.test(lower)) return 'mkfs';
  if (lower.includes('/etc/passwd') || lower.includes('/etc/shadow')) return 'sensitive system file';
  if (lower.includes('~/.ssh') || lower.includes('/root/.ssh')) return 'SSH key access';
  return null;
}

// ── Chunking helpers ──

interface ChunkResult {
  content: string;
  startChar: number;
  endChar: number;
}

function chunkText(text: string, chunkSize = 800, overlap = 100): ChunkResult[] {
  const chunks: ChunkResult[] = [];
  const paragraphs = text.split(/\n\s*\n/);
  let current = '';
  let startChar = 0;
  let currentStart = 0;

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    if (current.length + trimmed.length > chunkSize && current.length > 0) {
      chunks.push({ content: current.trim(), startChar: currentStart, endChar: startChar });
      // Overlap: keep last `overlap` chars of previous chunk
      const overlapText = current.length > overlap ? current.slice(-overlap) : current;
      current = overlapText + '\n\n' + trimmed;
      currentStart = startChar - overlapText.length;
    } else {
      current = current ? current + '\n\n' + trimmed : trimmed;
      if (!current || current.length === trimmed.length) currentStart = startChar;
    }
    startChar += para.length + 2; // +2 for the double newline
  }

  if (current.trim()) {
    chunks.push({ content: current.trim(), startChar: currentStart, endChar: text.length });
  }

  return chunks;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    normA += (a[i] ?? 0) ** 2;
    normB += (b[i] ?? 0) ** 2;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Build ToolDependencies from ServerContext ──
function buildToolDependencies(ctx: ServerContext): ToolDependencies {
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
      return ctx.decisionService.create({
        id,
        projectId: input.projectId,
        type: input.type,
        title: input.title,
        description: input.description,
        options: input.options,
        classification: input.classification,
        captainId: input.captainId,
      }) as Decision;
    },
    approveDecision(decisionId, captainId, chosenOptionId) {
      return ctx.decisionService.approve(decisionId, captainId, chosenOptionId);
    },
    rejectDecision(decisionId, captainId) {
      return ctx.decisionService.reject(decisionId, captainId);
    },

    // ── Workflow read callbacks ──
    listWorkflows() {
      const rows = ctx.db
        .prepare('SELECT id, name, definition, status FROM workflows WHERE project_id = ? ORDER BY created_at DESC')
        .all('default') as any[];
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
      return { id: row.id, name: row.name, definition: JSON.parse(row.definition ?? '{}'), status: row.status };
    },

    // ── Workflow write callbacks ──
    createWorkflow(input) {
      const id = `wf_${Date.now()}`;
      ctx.db
        .prepare(
          'INSERT INTO workflows (id, project_id, name, definition, status) VALUES (?, ?, ?, ?, ?)',
        )
        .run(id, input.projectId, input.name, JSON.stringify(input.definition ?? {}), 'draft');
      ctx.logger.info('Workflow created via tool', { id, name: input.name });
      return { id };
    },
    updateWorkflow(id, input) {
      if (input.name !== undefined || input.definition !== undefined) {
        const name = input.name;
        const definition = input.definition;
        if (name !== undefined && definition !== undefined) {
          ctx.db
            .prepare('UPDATE workflows SET name = ?, definition = ? WHERE id = ?')
            .run(name, JSON.stringify(definition), id);
        } else if (name !== undefined) {
          ctx.workflowRepo.updateNameAndDefinition(id, name);
        } else if (definition !== undefined) {
          ctx.db
            .prepare('UPDATE workflows SET definition = ? WHERE id = ?')
            .run(JSON.stringify(definition), id);
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

    // ── Meeting write callback ──
    async startMeeting(topic, advisorIds, projectId) {
      return runMeeting(topic, advisorIds, projectId, ctx);
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
      ctx.db
        .prepare(
          'INSERT INTO employees (id, project_id, name, role, kind, persona, permission_level) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(id, 'default', input.name, input.role, input.kind, '{}', 'read');
      ctx.logger.info('Employee created via tool', { id, name: input.name });
    },

    // ── Agent registry callbacks ──
    registerAgent(input) {
      const role = {
        type: 'custom' as const,
        name: input.name,
        description: input.description,
        systemPrompt: input.systemPrompt,
        modelTier: ((input as any).modelTier as string) || 'default',
        model: input.model,
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
          description: input.description,
          system_prompt: input.systemPrompt,
          model: input.model,
          model_tier: 'default',
          temperature: input.temperature,
          max_response_tokens: input.maxResponseTokens,
          allowed_tools: JSON.stringify(input.allowedTools),
          context_budget: input.contextBudget,
          is_builtin: 0,
          created_at: new Date().toISOString(),
        });
      } catch (e) {
        ctx.logger.warn('Failed to persist custom agent to DB', { name: input.name, error: String(e) });
      }
      // Persist to disk (~/.cabinet/agents/<name>/agent.json)
      try {
        const agentsDir = join(CABINET_DIR, 'agents', input.name);
        if (!existsSync(agentsDir)) mkdirSync(agentsDir, { recursive: true });
        writeFileSync(
          join(agentsDir, 'agent.json'),
          JSON.stringify(role, null, 2),
          'utf-8',
        );
      } catch (e) {
        ctx.logger.warn('Failed to persist custom agent to disk', { name: input.name, error: String(e) });
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
    async invokeAgent(agentName, message) {
      const registry = ctx.agentRegistry;
      const role = registry.get(agentName);
      if (!role) throw new Error(`Agent not found: ${agentName}`);
      const loop = getAgentLoopForRole(
        role.type as AgentRoleType,
        `invoke_${Date.now()}`,
        'global',
        DEFAULT_CAPTAIN_ID,
        undefined,
        resolveModel({ modelTier: 'default', model: 'claude-sonnet-4-6' }),
      );
      if (!loop) throw new Error(`Cannot invoke ${agentName}: no LLM gateway available`);
      const result = await loop.run(message);
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
      ctx.projectRepo.create({ id, name: input.name, description: input.description ?? '', status: 'active' as const, rootPath: input.rootPath ?? '', createdAt: new Date() });
      ctx.projectContextRepo.insert({ project_id: id, summary: '', goals: '[]', milestones: '[]', constraints: '{}', tech_summary: '', risk_map: '[]', key_decisions: '[]', updated_at: new Date().toISOString() });
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
          return { content: lines.slice(start, end).join('\n'), size, encoding: 'utf-8' as const, mimeType: mimeType ?? undefined };
        }
        return { content, size, encoding: 'utf-8' as const, mimeType: mimeType ?? undefined };
      }

      // Binary file — read as base64
      const buf = await readFile(safePath);
      if (buf.length > 5 * 1024 * 1024) throw new Error('Binary file exceeds 5MB limit');
      const base64 = buf.toString('base64');
      return { content: base64, size: buf.length, encoding: 'base64' as const, mimeType: mimeType ?? 'application/octet-stream' };
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
        if (!line || line.startsWith('diff ') || line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('index ')) {
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
          while (i < diffLines.length && !diffLines[i]!.startsWith('@@') && !diffLines[i]!.startsWith('diff ')) {
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
              if (srcIdx < lines.length && lines[srcIdx] !== hl.content) { mismatch = true; break; }
              result.push(lines[srcIdx]!);
              srcIdx++;
              contextIdx++;
            } else if (hl.type === 'remove') {
              if (srcIdx < lines.length && lines[srcIdx] !== hl.content) { mismatch = true; break; }
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
        try { entries = await readdir(currentDir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
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
        try { entries = await readdir(currentDir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
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
            } catch { /* skip unreadable files */ }
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
        const timer = setTimeout(() => {
          unwatchFile(safePath);
          resolve({ changed: false, size: 0 });
        }, Math.min(timeoutMs ?? 30000, 120000));
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
    webFetch: async (url) => {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only HTTP/HTTPS URLs are allowed');
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
        const truncated = text.slice(0, 2 * 1024 * 1024);
        const title = extractTitle(truncated, contentType);
        return { content: truncated, contentType, status: res.status, title };
      } finally {
        clearTimeout(timer);
      }
    },

    httpRequest: async (method, url, headers, body) => {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only HTTP/HTTPS URLs are allowed');
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
        res.headers.forEach((v, k) => { resHeaders[k] = v; });
        const resBody = await res.text();
        return { status: res.status, headers: resHeaders, body: resBody.slice(0, 5 * 1024 * 1024) };
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
        shell: process.platform === 'win32' ? (process.env.COMSPEC || 'cmd.exe') : '/bin/bash',
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
          const result = await ctx.gateway.generateEmbeddings({ texts: chunks.map((c) => c.content) });
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
        } catch { /* fall back to text search */ }
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
            return { content: row.content as string, sourcePath: row.source_path as string, chunkIndex: row.chunk_index as number, score };
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
        return { overallScore: 5, dimensions: {}, feedback: 'Evaluation failed — model output unparseable', evaluatorModel };
      }
    },

    // ── Scheduler callbacks ──
    scheduleTask: async (name, cronExpression, prompt, recurring) => {
      return ctx.taskScheduler.schedule(name, cronExpression, prompt, recurring);
    },
    listScheduledTasks: async () => {
      return ctx.taskScheduler.list();
    },
    cancelScheduledTask: async (id) => {
      ctx.taskScheduler.cancel(id);
    },
  };
}

// ── Workflow execution helper ──
async function executeWorkflowById(
  workflowId: string,
  ctx: ServerContext,
): Promise<{ runId: string; status: string; steps?: unknown[] }> {
  const wf = ctx.workflowRepo.findById(workflowId);
  if (!wf) throw new Error(`Workflow not found: ${workflowId}`);

  const def = JSON.parse(wf.definition ?? '{}');
  const nodes: { id: string; type: string; data: any }[] = def.nodes ?? [];
  const edges: { source: string; target: string }[] = def.edges ?? [];
  const runId = `run_${Date.now()}`;

  if (nodes.length === 0) throw new Error('Workflow has no nodes');

  ctx.workflowRepo.updateStatus(workflowId, 'running');

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const graph = new Map<string, string[]>();
  for (const n of nodes) graph.set(n.id, []);
  for (const e of edges) {
    if (!graph.has(e.source)) graph.set(e.source, []);
    graph.get(e.source)!.push(e.target);
  }

  const results: { nodeId: string; type: string; output: string }[] = [];
  const visited = new Set<string>();

  async function executeNode(nodeId: string): Promise<void> {
    if (visited.has(nodeId)) return;
    const node = nodeMap.get(nodeId);
    if (!node) return;
    visited.add(nodeId);

    const d = node.data ?? {};
    let output = '';

    switch (node.type) {
      case 'start':
        output = 'Workflow started';
        break;
      case 'end':
        output = 'Workflow ended';
        break;
      case 'aiAgent':
      case 'llmCall':
        if (!ctx.gateway) {
          output = 'No LLM available';
          break;
        }
        try {
          const response = await ctx.gateway.generateText({
            model: d.model ?? 'claude-haiku-4-5',
            messages: [{ role: 'user', content: d.prompt ?? d.label ?? 'Process this step' }],
            maxTokens: 200,
          });
          output = response.content;
          ctx.metrics.increment('llm_call', {
            model: d.model ?? 'claude-haiku-4-5',
            purpose: 'workflow_tool',
          });
        } catch (e: any) {
          output = `Error: ${e.message}`;
        }
        break;
      case 'humanApproval':
        output = `Approval pending: ${d.label ?? nodeId}`;
        ctx.workflowRepo.updateStatus(workflowId, 'awaiting_approval');
        broadcast('workflow_approval_needed', { workflowId, runId, nodeId, label: d.label });
        break;
      case 'condition': {
        const prevOutputs = results.map((r) => r.output.toLowerCase()).join(' ');
        const isTrue = prevOutputs.includes('approved') || prevOutputs.includes('true');
        const children = graph.get(nodeId) ?? [];
        if (children.length >= 2) {
          const targetIdx = isTrue ? 0 : Math.min(1, children.length - 1);
          const targetNode = children[targetIdx];
          if (targetNode) await executeNode(targetNode);
        } else {
          for (const child of children) await executeNode(child);
        }
        results.push({ nodeId, type: 'condition', output: `Condition: ${isTrue}` });
        return;
      }
      case 'dataQuery':
        output = 'Data query executed';
        break;
      case 'notification':
        output = d.message ?? 'Notification sent';
        broadcast('workflow_notification', { workflowId, runId, nodeId, message: output });
        break;
      case 'wait':
        output = `Waited ${d.duration ?? '5s'}`;
        break;
      default:
        output = 'Unknown node type';
    }

    results.push({ nodeId, type: node.type ?? 'unknown', output });

    const children = graph.get(nodeId) ?? [];
    for (const child of children) await executeNode(child);
  }

  const startNodes = nodes.filter((n) => n.type === 'start');
  try {
    if (startNodes.length > 0 && startNodes[0]) {
      await executeNode(startNodes[0].id);
    } else {
      for (const n of nodes) await executeNode(n.id);
    }

    const finalStatus = results.some(
      (r) => r.type === 'humanApproval' && r.output.includes('pending'),
    )
      ? 'awaiting_approval'
      : 'completed';
    ctx.workflowRepo.updateStatus(workflowId, finalStatus);
    ctx.auditLogRepo.insert('workflow', workflowId, 'run', 'system', { status: finalStatus, steps: results, runId });
    ctx.logger.info('Workflow executed via tool', {
      workflowId,
      nodes: results.length,
      status: finalStatus,
    });
    return { runId, status: finalStatus, steps: results };
  } catch (e) {
    ctx.workflowRepo.updateStatus(workflowId, 'failed');
    throw e;
  }
}

// ── Meeting result capture (module-level, read by /chat handler) ──
let capturedMeetingResult: MeetingResult | null = null;

interface MeetingResult {
  meetingId: string;
  topic: string;
  synthesis: string;
  perspectives: unknown[];
  crossValidation?: unknown;
  decisionId?: string | null;
}

// ── Meeting execution helper ──
async function runMeeting(
  topic: string,
  advisorIds: string[] | undefined,
  projectId: string | undefined,
  ctx: ServerContext,
): Promise<{
  meetingId: string;
  topic: string;
  synthesis: string;
  perspectives: unknown[];
  decisionId?: string | null;
}> {
  const meetingId = `meeting_${Date.now()}`;

  // Budget gate: refuse meeting if daily budget is already blocked
  const budget = ctx.budgetGuard.canProceed();
  if (!budget.allowed) {
    return {
      meetingId,
      topic,
      synthesis: `Meeting blocked: ${budget.reason ?? 'Budget limit exceeded'}. Approve more budget in Settings to run meetings.`,
      perspectives: [],
    };
  }

  if (!ctx.gateway) {
    const synthesis = `[No LLM] Meeting on "${topic}" created. Configure API keys for AI-powered meetings.`;
    ctx.db
      .prepare(
        "INSERT INTO audit_log (entity_type, entity_id, action, actor, changes, timestamp) VALUES ('meeting', ?, 'create', 'system', ?, datetime('now'))",
      )
      .run(meetingId, JSON.stringify({ topic, status: 'started', synthesis }));
    return { meetingId, topic, synthesis, perspectives: [] };
  }

  const model = 'claude-haiku-4-5';

  // Phase 1: MeetingChair dynamically generates analysis perspectives based on the topic.
  // If the user specified advisor names, they are included as mandatory perspectives.
  let analysisBrief: string;
  try {
    const chairPrompt = buildChairPrompt(topic, advisorIds);
    const chairResponse = await ctx.gateway!.generateText({
      model,
      messages: [{ role: 'user', content: chairPrompt }],
      maxTokens: 1200,
      temperature: 0.3,
    });
    const brief = parseChairResponse(chairResponse.content, topic);
    analysisBrief = JSON.stringify(brief);
    ctx.metrics.increment('llm_call', { model, purpose: 'meeting_chair_brief' });
  } catch {
    analysisBrief = JSON.stringify(parseChairResponse('', topic));
  }

  // Phase 2: Advisor multi-perspective analysis (1 LLM call)
  let perspectives: any[];
  let advisorResult: import('@cabinet/meeting').AdvisorResult;
  try {
    const brief = JSON.parse(analysisBrief);
    const advisorPrompt = buildAdvisorPrompt(brief);
    const advisorResponse = await ctx.gateway!.generateText({
      model,
      messages: [{ role: 'user', content: advisorPrompt }],
      maxTokens: 1500,
      temperature: 0.4,
    });
    advisorResult = parseAdvisorResponse(advisorResponse.content);
    perspectives = advisorResult.findings;
    ctx.metrics.increment('llm_call', { model, purpose: 'meeting_advisor' });
  } catch {
    perspectives = [];
    advisorResult = { findings: [], synthesis: '', risks: [], open_questions: [] };
  }

  // Phase 3: Reviewer adversarial review using Reviewer AgentLoop
  let synthesis = '';
  let reviewPassed = false;
  let reviewIssues: any[] = [];
  const maxRounds = 2;
  for (let round = 0; round < maxRounds && !reviewPassed; round++) {
    try {
      const reviewerLoop = createReviewerLoop(ctx);
      if (reviewerLoop) {
        const reviewerTask = buildReviewerTask(topic, perspectives as AdvisorFinding[], advisorResult.synthesis);
        const reviewerResult = await reviewerLoop.run(reviewerTask);
        const review = parseReviewerResponse(reviewerResult.content);
        reviewPassed = review.pass;
        reviewIssues = review.issues;
      } else {
        reviewPassed = true;
      }
      ctx.metrics.increment('llm_call', { model: 'claude-haiku-4-5', purpose: 'meeting_reviewer' });

      if (reviewPassed || round === maxRounds - 1) {
        synthesis = generateSynthesis({
          topic,
          findings: perspectives as AdvisorFinding[],
          synthesisText: advisorResult.synthesis,
          reviewIssues,
        });
      }
    } catch {
      synthesis = 'Analysis completed.';
      reviewPassed = true;
    }
  }

  // Persist
  ctx.db
    .prepare(
      "INSERT INTO audit_log (entity_type, entity_id, action, actor, changes, timestamp) VALUES ('meeting', ?, 'create', 'system', ?, datetime('now'))",
    )
    .run(
      meetingId,
      JSON.stringify({ topic, status: 'completed', synthesis, perspectives, reviewPassed, projectId }),
    );
  broadcast('meeting_created', {
    meetingId,
    topic,
    attendees: perspectives.map((p: any) => p.name ?? p.advisor),
  });

  // Auto-create deliverable for the completed meeting
  try {
    const did = `d_${Date.now()}`;
    ctx.deliverableRepo.insert({
      id: did,
      project_id: projectId ?? 'default',
      meeting_id: meetingId,
      title: topic,
      type: 'meeting_report',
      file_path: null,
      tags: JSON.stringify(['meeting', 'analysis']),
      created_at: new Date().toISOString(),
    });
  } catch { /* non-fatal */ }

  // Phase 4: Auto-extract decision if meeting produced actionable options
  let decisionId: string | null = null;
  if (ctx.gateway && synthesis && synthesis.length > 20) {
    try {
      const extractionPrompt = buildExtractionPrompt(topic, synthesis, perspectives as AdvisorFinding[]);
      const extractionResponse = await ctx.gateway.generateText({
        model: 'claude-haiku-4-5',
        messages: [{ role: 'user', content: extractionPrompt }],
        maxTokens: 400,
        temperature: 0.1,
      });

      const extracted = parseExtractionResponse(extractionResponse.content);
        if (extracted.hasDecision && extracted.title) {
          const decId = `dec_${Date.now()}`;
          const options = (
            extracted.options ?? [
              { label: 'Approve', impact: 'Proceed as recommended' },
              { label: 'Reject', impact: 'Do not proceed' },
            ]
          ).map((o: any, i: number) => ({
            id: `opt_${i}`,
            label: o.label,
            impact: o.impact ?? '',
          }));

          ctx.decisionService.create({
            id: decId,
            projectId: projectId ?? 'default',
            type: 'strategic',
            title: extracted.title,
            description: extracted.description ?? `Decision extracted from meeting: ${topic}`,
            options,
            classification: {
              scopeDescription: topic,
              isCrossSession: false,
              optionCount: options.length,
              estimatedCostUsd: 0,
              involvesFunds: false,
              involvesPermissions: false,
              involvesDataDeletion: false,
              involvesOrgConfig: false,
            },
          });
          decisionId = decId;
          broadcast('decision_created', {
            decisionId: decId,
            title: extracted.title,
            level: extracted.level ?? 'L1',
          });
          ctx.logger.info('Decision auto-extracted from meeting', { meetingId, decisionId: decId });
        }
    } catch (e: any) {
      ctx.logger.warn('Meeting decision extraction failed', { error: e.message, meetingId });
    }
  }

  const result: MeetingResult = { meetingId, topic, synthesis, perspectives, decisionId };
  capturedMeetingResult = result;
  return result;
}

// ── Multi-agent cache (keyed by sessionId:roleType) ──
const agentLoopCache = new Map<string, AgentLoop>();
const MAX_CACHE_SIZE = 100;
// Per-session secretary agents (keyed by sessionId)
const secretaryAgentCache = new Map<string, SecretaryAgent>();
// Reviewer AgentLoop cache (keyed by delegation tier)
const reviewerLoopCache = new Map<string, AgentLoop>();
const REVIEWER_CACHE_SIZE = 20;
let lastGatewayCheck = false;

// Keep cached agent loops in sync with delegation tier changes from the UI
onTierChange((tier: DelegationTier) => {
  for (const loop of agentLoopCache.values()) {
    try { loop.setDelegationTier(tier); } catch { /* non-fatal */ }
  }
  for (const agent of secretaryAgentCache.values()) {
    try { agent.setDelegationTier(tier); } catch { /* non-fatal */ }
  }
});

function buildMemoryProvider(ctx: ServerContext, projectId?: string) {
  const useIsolation = projectId && projectId !== 'global';
  const isolated = useIsolation
    ? new ProjectIsolatedMemory(projectId!, ctx.shortTerm, ctx.longTerm, ctx.entity, ctx.project)
    : null;

  return {
    async getShortTerm(sid: string) {
      const items: { role: 'user' | 'assistant'; content: string }[] = [];

      // Include conversation history from SessionManager
      const session = ctx.sessionManager.get(sid);
      if (session && session.messages.length > 0) {
        // Exclude last message if it's a user message (will be re-added by AgentLoop)
        const last = session.messages[session.messages.length - 1]!;
        const end = last.role === 'user' ? session.messages.length - 1 : session.messages.length;
        const start = Math.max(0, end - 20);

        if (end > 20) {
          // Keep the most recent 15 messages as-is
          const recentStart = end - 15;
          for (let i = recentStart; i < end; i++) {
            const m = session.messages[i]!;
            items.push({ role: m.role, content: m.content });
          }
          // Compress older messages (from start to recentStart) into a summary
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

      // Append short-term KV data as additional context (scoped per project if isolated)
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
      // Include project root path so the agent knows where the project files are
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

/** Resolve a role's modelTier to the actual model via user-configured modelMapping. */
function resolveModel(role: { modelTier?: string; model: string }): string {
  const ctx = getServerContext();
  const adapter = ctx.gateway as any;
  if (adapter?.resolveModelString && role.modelTier) {
    return adapter.resolveModelString(role.modelTier);
  }
  return role.model;
}

/** Get or create an AgentLoop for a specific role. */
function getAgentLoopForRole(
  roleType: AgentRoleType,
  sessionId: string,
  projectId: string,
  captainId: string,
  thinkingBudget?: number,
  model?: string,
): AgentLoop | null {
  const ctx = getServerContext();
  if (!ctx.gateway) return null;

  // Return cached if available (keyed by sessionId:projectId:roleType)
  const cacheKey = `${sessionId}:${projectId}:${roleType}`;
  const cached = agentLoopCache.get(cacheKey);
  if (cached) return cached;

  const registry = getServerContext().agentRegistry;
  const role = registry.get(roleType);
  if (!role) return null;

  const executor = new ToolExecutor();
  registerCabinetTools(executor, buildToolDependencies(ctx));
  registerSkillTools(executor);
  const mcpCtx = getServerContext();
  registerMCPTools(executor, (name, args) => mcpCtx.mcpManager.callTool(name, args), () => mcpCtx.mcpManager.listTools());

  // Wire observability: track tool calls
  executor.setToolCallCallback((toolName, success, blocked, durationMs) => {
    getServerContext().observability.recordToolCall(toolName, success, blocked, durationMs);
  });

  // Apply role's tool restrictions
  if (role.allowedTools.length > 0) {
    const allTools = executor.listTools();
    for (const toolName of allTools) {
      if (!role.allowedTools.includes(toolName)) {
        executor.unregister(toolName);
      }
    }
  }

  // Look up project root path for the system prompt
  let projectRootPath: string | undefined;
  try {
    const projRow = ctx.projectRepo.findById(projectId);
    if (projRow?.rootPath && existsSync(projRow.rootPath)) {
      projectRootPath = projRow.rootPath;
    }
  } catch { /* best-effort */ }

  const checkpointManager = new CheckpointManager(ctx.db);
  const loop = new AgentLoop({
    gateway: ctx.gateway,
    toolExecutor: executor,
    safetyChecker: new SafetyChecker(ctx.delegationTier),
    checkpointManager,
    memoryProvider: buildMemoryProvider(ctx, projectId),
    sessionId: `${sessionId}-${role.type}`,
    projectId,
    captainId,
    systemPrompt: buildSystemPrompt(role.type, role.systemPrompt, projectRootPath),
    model: model ?? resolveModel(role),
    maxSteps: role.maxSteps ?? 50,
    maxResponseTokens: role.maxResponseTokens,
    temperature: role.temperature,
    contextBudget: role.contextBudget,
    thinkingBudget,
  });

  // FIFO eviction
  if (agentLoopCache.size >= MAX_CACHE_SIZE) {
    const firstKey = agentLoopCache.keys().next().value;
    if (firstKey) agentLoopCache.delete(firstKey);
  }
  // Wire observability: report session completion
  loop.onSessionComplete = (summary) => {
    const obs = getServerContext().observability;
    obs.recordSession({
      sessionId: summary.sessionId,
      projectId: summary.projectId,
      captainId: summary.captainId,
      role: role.type,
      model: summary.model,
      startTime: summary.startTime,
      totalSteps: summary.totalSteps,
      totalTokens: summary.totalTokens,
      totalCost: 0,
      toolCalls: summary.toolCalls,
      contextZoneDistribution: summary.contextZones,
      contextHandoffs: summary.contextHandoffs,
      qualityChecks: { total: 0, passed: 0 },
      errors: summary.errors,
      durationMs: summary.durationMs,
      success: summary.success,
    });
  };

  agentLoopCache.set(cacheKey, loop);
  return loop;
}

/** Create a fresh (non-cached) Reviewer AgentLoop for quality review tasks. */
function createReviewerLoop(ctx: ServerContext): AgentLoop | null {
  if (!ctx.gateway) return null;

  const registry = ctx.agentRegistry;
  const role = registry.get('reviewer');
  if (!role) return null;

  // Check cache first
  const cacheKey = `reviewer_${ctx.delegationTier}`;
  const cached = reviewerLoopCache.get(cacheKey);
  if (cached) return cached;

  const executor = new ToolExecutor();
  registerCabinetTools(executor, buildToolDependencies(ctx));
  registerSkillTools(executor);
  const mcpCtx = getServerContext();
  registerMCPTools(executor, (name, args) => mcpCtx.mcpManager.callTool(name, args), () => mcpCtx.mcpManager.listTools());

  // Restrict to Reviewer's allowed tools
  if (role.allowedTools.length > 0) {
    for (const toolName of executor.listTools()) {
      if (!role.allowedTools.includes(toolName)) {
        executor.unregister(toolName);
      }
    }
  }

  const checkpointManager = new CheckpointManager(ctx.db);
  const loop = new AgentLoop({
    gateway: ctx.gateway,
    toolExecutor: executor,
    safetyChecker: new SafetyChecker(ctx.delegationTier),
    checkpointManager,
    memoryProvider: buildMemoryProvider(ctx, 'default'),
    sessionId: `reviewer_${Date.now()}`,
    projectId: 'default',
    captainId: DEFAULT_CAPTAIN_ID,
    systemPrompt: buildSystemPrompt(role.type, role.systemPrompt),
    model: resolveModel(role),
    maxSteps: role.maxSteps ?? 50,
    maxResponseTokens: role.maxResponseTokens,
    temperature: role.temperature,
    contextBudget: role.contextBudget,
  });

  // FIFO eviction
  if (reviewerLoopCache.size >= REVIEWER_CACHE_SIZE) {
    const firstKey = reviewerLoopCache.keys().next().value;
    if (firstKey) reviewerLoopCache.delete(firstKey);
  }
  reviewerLoopCache.set(cacheKey, loop);
  return loop;
}

/** Dispatch a message to a specialist role's AgentLoop, with optional Reviewer quality gate. */
async function dispatchToSpecialist(
  roleType: AgentRoleType,
  message: string,
  sessionId: string,
  projectId: string,
  captainId: string,
  thinkingBudget?: number,
  model?: string,
): Promise<string> {
  const ctx = getServerContext();
  // Dynamic model up/downgrade based on task complexity
  let effectiveModel = model;
  if (!effectiveModel) {
    const registry = ctx.agentRegistry;
    const roleDef = registry.get(roleType);

    // Upgrade: complex tasks need better models
    if (roleDef?.upgradeModelTier) {
      const needsUpgrade =
        (roleType === 'decision_analyst' && (message.includes('架构') || message.includes('安全') || message.includes('预算') || message.includes('战略') || message.includes('迁移') || message.length > 500)) ||
        (roleType === 'reviewer' && (message.includes('L3') || message.includes('安全关键') || message.length > 2000));
      if (needsUpgrade) {
        effectiveModel = resolveModel({ modelTier: roleDef.upgradeModelTier, model: roleDef.model });
      }
    }

    // Downgrade: simple modifications don't need reasoning models
    if (!effectiveModel && roleDef?.downgradeModelTier) {
      const needsDowngrade =
        (roleType === 'workflow_designer' && (message.includes('修改') || message.includes('更新') || message.includes('调整') || message.includes('改一下')) && !message.includes('创建') && !message.includes('新建') && !message.includes('设计'));
      if (needsDowngrade) {
        effectiveModel = resolveModel({ modelTier: roleDef.downgradeModelTier, model: roleDef.model });
      }
    }
  }

  const loop = getAgentLoopForRole(roleType, sessionId, projectId, captainId, thinkingBudget, effectiveModel);
  if (!loop) return `[No LLM] Cannot dispatch to ${roleType}.`;

  const result = await loop.run(message);
  let output = result.content;

  // Quality gate: non-secretary, non-reviewer outputs get reviewed
  if (roleType !== 'secretary' && roleType !== 'reviewer') {
    const reviewerLoop = createReviewerLoop(ctx);
    if (reviewerLoop) {
      // Segmented review for long outputs: show first 4000 + last 4000 chars with truncation note
      const reviewContent = output.length > 8000
        ? output.slice(0, 4000) + '\n\n[...output truncated, total length: ' + output.length + ' chars...]\n\n' + output.slice(-4000)
        : output;

      const reviewTask = [
        `## Quality Review Task`,
        '',
        `Review the following output produced by the "${roleType}" agent.`,
        `The original user message was: "${message.slice(0, 500)}"`,
        '',
        `Agent output to review:`,
        reviewContent,
        '',
        `Review for: logical completeness, evidence quality, risk assessment, factual errors.`,
        `Use available tools (search_memory, search_documents, read_file) to verify claims if possible.`,
        '',
        `After review, output ONLY a JSON object:`,
        `{"pass": true/false, "score": 0.0-1.0, "issues": [...], "suggestion": {...}}`,
      ].join('\n');

      try {
        const reviewResult = await reviewerLoop.run(reviewTask);
        const reviewMatch = reviewResult.content.match(/\{[\s\S]*\}/);
        const review = reviewMatch ? JSON.parse(reviewMatch[0]) : { pass: true, score: 1.0, issues: [] };

        // Persist review result
        persistReviewResult(ctx, roleType, sessionId, review);

        if (review.pass !== true && review.issues?.length > 0) {
          // Publish quality alert for Harness
          if (ctx.eventBus) {
            ctx.eventBus.publish({
              messageId: `quality_alert_${Date.now()}`,
              correlationId: sessionId,
              causationId: null,
              timestamp: new Date(),
              messageType: MessageType.QualityAlert,
              payload: {
                type: 'review_quality',
                message: `Quality review for ${roleType}: score ${review.score}, ${review.issues?.length ?? 0} issues`,
                severity: review.score < 0.5 ? 'high' : review.score < 0.7 ? 'medium' : 'low',
              },
            }).catch(() => {});

            broadcast('quality_alert', {
              source: roleType,
              sessionId,
              score: review.score,
              issueCount: review.issues?.length ?? 0,
              topIssue: review.issues?.[0]?.detail?.slice(0, 200) ?? null,
            });
          }

          // Append reviewer notes to output
          const issueNotes = (review.issues as any[]).map((i: any) => `- [${i.severity}] ${i.detail}`).join('\n');
          output = `${output}\n\n---\n### Reviewer Notes\n${issueNotes}\n\n⚠️ Review score: ${review.score ?? 'N/A'}`;
        }
      } catch {
        // Review failure is non-fatal — return original output
      }
    }
  }

  return output;
}

/** Dispatch a message to a specialist role with streaming output. */
async function dispatchToSpecialistStreaming(
  roleType: AgentRoleType,
  message: string,
  sessionId: string,
  projectId: string,
  captainId: string,
  callback: import('@cabinet/agent').StreamingCallback,
  thinkingBudget?: number,
  model?: string,
): Promise<void> {
  const ctx = getServerContext();
  const loop = getAgentLoopForRole(roleType, sessionId, projectId, captainId, thinkingBudget, model);
  if (!loop) {
    callback.onError?.(`[No LLM] Cannot dispatch to ${roleType}.`);
    callback.onDone('');
    return;
  }

  try {
    const result = await loop.runStreaming(message, callback);
    // Note: Quality gate (Reviewer) is skipped for streaming — it would delay the stream.
    // The non-streaming dispatchToSpecialist still runs the reviewer for blocking calls.
    void result;
  } catch (e: any) {
    callback.onError?.(e.message ?? 'Unknown error');
    callback.onDone('');
  }
}

/** Persist review result to evaluation_results table. */
function persistReviewResult(
  ctx: ServerContext,
  sourceType: string,
  sourceId: string,
  review: { pass: boolean; score: number; issues: any[] },
): void {
  try {
    new EvaluationResultRepository(ctx.db).insert({
      project_id: null,
      session_id: null,
      source_type: sourceType,
      source_id: sourceId,
      overall_score: review.score ?? 0,
      dimensions: JSON.stringify({ pass: review.pass, issues: review.issues ?? [] }),
      feedback: null,
      evaluator_model: 'claude-haiku-4-5',
    });
  } catch { /* persistence failure is non-fatal */ }
}

function getOrCreateAgent(sessionId: string, projectId: string, captainId: string, model?: string, thinkingBudget?: number) {
  const ctx = getServerContext();
  const hasGateway = ctx.gateway !== null;

  // Reset cache if gateway status changed
  if (hasGateway !== lastGatewayCheck) {
    agentLoopCache.clear();
    secretaryAgentCache.clear();
    lastGatewayCheck = hasGateway;
  }

  const cacheKey = `${sessionId}:${projectId}`;
  const cached = secretaryAgentCache.get(cacheKey);
  if (cached) {
    return { agent: cached };
  }

  // Secretary's own executor (all tools)
  const executor = new ToolExecutor();
  registerCabinetTools(executor, buildToolDependencies(ctx));
  registerSkillTools(executor);
  const mcpCtx = getServerContext();
  registerMCPTools(executor, (name, args) => mcpCtx.mcpManager.callTool(name, args), () => mcpCtx.mcpManager.listTools());
  executor.setToolCallCallback((toolName, success, blocked, durationMs) => {
    getServerContext().observability.recordToolCall(toolName, success, blocked, durationMs);
  });

  const memoryProvider = buildMemoryProvider(ctx, projectId);

  // Load secretary role for temperature and system prompt
  const secretaryRole = ctx.agentRegistry.get('secretary');

  let secretaryLoop: AgentLoop | null = null;
  if (hasGateway) {
    // Look up project root path for the system prompt
    let projectRootPath: string | undefined;
    try {
      if (projectId && projectId !== 'global') {
        const projRow = ctx.projectRepo.findById(projectId);
        if (projRow?.rootPath && existsSync(projRow.rootPath)) {
          projectRootPath = projRow.rootPath;
        }
      }
    } catch { /* best-effort */ }

    const checkpointManager = new CheckpointManager(ctx.db);
    secretaryLoop = new AgentLoop({
      gateway: ctx.gateway!,
      toolExecutor: executor,
      safetyChecker: new SafetyChecker(ctx.delegationTier),
      checkpointManager,
      memoryProvider,
      sessionId,
      projectId,
      captainId,
      systemPrompt: buildSystemPrompt('secretary', secretaryRole?.systemPrompt ?? '', projectRootPath),
      model: model ?? resolveModel(secretaryRole ?? { model: 'claude-sonnet-4-6' }),
      maxSteps: secretaryRole?.maxSteps ?? 50,
      maxResponseTokens: secretaryRole?.maxResponseTokens,
      temperature: secretaryRole?.temperature ?? 0.5,
      contextBudget: secretaryRole?.contextBudget,
      thinkingBudget,
    });
    secretaryLoop.onSessionComplete = (summary) => {
      const obs = getServerContext().observability;
      obs.recordSession({
        sessionId: summary.sessionId,
        projectId: summary.projectId,
        captainId: summary.captainId,
        role: 'secretary',
        model: summary.model,
        startTime: summary.startTime,
        totalSteps: summary.totalSteps,
        totalTokens: summary.totalTokens,
        totalCost: 0,
        toolCalls: summary.toolCalls,
        contextZoneDistribution: summary.contextZones,
        contextHandoffs: summary.contextHandoffs,
        qualityChecks: { total: 0, passed: 0 },
        errors: summary.errors,
        durationMs: summary.durationMs,
        success: summary.success,
      });
    };
  }

  const intentParser = new IntentParser(hasGateway ? ctx.gateway! : undefined);

  // Initialize the router with agent descriptions and valid types (includes custom agents)
  const registry = getServerContext().agentRegistry;
  intentParser.setAgentDescriptions(registry.describeForRouting());
  intentParser.setValidAgentTypes(registry.getValidAgentTypes());
  // Inject captain preferences for personalized routing
  try {
    const captainPrefs = ctx.entity.getPreferences(captainId);
    if (captainPrefs?.preferences) {
      const prefs = captainPrefs.preferences;
      const prefLines: string[] = [];
      if (prefs.riskTolerance) prefLines.push(`- Risk tolerance: ${prefs.riskTolerance}`);
      if (prefs.costSensitivity) prefLines.push(`- Cost sensitivity: ${prefs.costSensitivity}`);
      if (prefs.timeUrgency) prefLines.push(`- Time urgency: ${prefs.timeUrgency}`);
      if (prefs.preferredDecisionStyle) prefLines.push(`- Decision style: ${prefs.preferredDecisionStyle}`);
      if (prefLines.length > 0) {
        intentParser.setCaptainPreferences(prefLines.join('\n'));
      }
    }
  } catch { /* preferences not available — routing works without */ }

  const agent = new SecretaryAgent(
    secretaryLoop ?? (null as any),
    intentParser,
    ctx.sessionManager,
    ctx.gateway ?? undefined,
    // dispatchToRole callback: routes to specialist agents with streaming
    async (roleType: AgentRoleType, msg: string, sid: string, callback: import('@cabinet/agent').StreamingCallback) => {
      await dispatchToSpecialistStreaming(roleType, msg, sid, projectId, captainId, callback, thinkingBudget, model ?? undefined);
    },
  );

  // FIFO eviction for secretary cache
  if (secretaryAgentCache.size >= MAX_CACHE_SIZE) {
    const firstKey = secretaryAgentCache.keys().next().value;
    if (firstKey) secretaryAgentCache.delete(firstKey);
  }
  secretaryAgentCache.set(cacheKey, agent);

  return { agent };
}

const fileSchema = z
  .object({
    name: z.string(),
    path: z.string(),
    type: z.string().optional(),
  })
  .passthrough();

// ── POST /chat ──
const chatSchema = z.object({
  sessionId: z.string(),
  message: z.string(),
  captainId: z.string().optional(),
  projectId: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  files: z.array(fileSchema).optional(),
  stream: z.boolean().optional(),
  dispatchMode: z.enum(['single', 'pipeline', 'parallel']).optional(),
  thinkingBudget: z.number().min(1024).max(128000).nullable().optional(),
});

secretaryRouter.post('/chat', async (c) => {
  const ctx = getServerContext();
  const body = await c.req.json();
  const parsed = chatSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error }, 400);

  const { sessionId, message } = parsed.data;
  const captainId = parsed.data.captainId ?? DEFAULT_CAPTAIN_ID;
  const files = parsed.data.files ?? [];
  let projectId: string = parsed.data.projectId || '';
  const model = parsed.data.model;
  const stream = parsed.data.stream ?? false;
  const dispatchMode: DispatchMode = parsed.data.dispatchMode ?? 'single';
  const thinkingBudget = parsed.data.thinkingBudget ?? undefined;

  // Use 'global' as sentinel when no project is selected (no auto-creation)
  if (!projectId) {
    projectId = 'global';
  }

  const isNewSession = !ctx.sessionManager.get(sessionId);
  if (isNewSession) {
    ctx.sessionManager.create(sessionId, `Session ${sessionId.slice(0, 8)}`, projectId === 'global' ? undefined : projectId);
    // Proactive greeting for new sessions — persist as first assistant message
    try {
      const greeter = new GreetingService();
      const pendingDecisions = ctx.db
        .prepare("SELECT COUNT(*) as count FROM decisions WHERE status = 'pending'")
        .get() as any;
      const activeWorkflows = ctx.db
        .prepare("SELECT COUNT(*) as count FROM workflows WHERE status = 'active' OR status = 'running'")
        .get() as any;
      const prefs = ctx.entity.getPreferences(captainId);
      const captainName = prefs?.name ?? 'Captain';
      const greeting = greeter.generate({
        captainName,
        pendingDecisions: pendingDecisions?.count ?? 0,
        activeWorkflows: activeWorkflows?.count ?? 0,
        todayCost: ctx.costTracker?.getDailyCost() ?? 0,
      });
      // Persist greeting as chat message so it appears in the dialog
      let greetingText = greeting.greeting;
      if (greeting.suggestions && greeting.suggestions.length > 0) {
        greetingText += '\n\n**Suggestions:**\n' + greeting.suggestions.map((s: string) => `- ${s}`).join('\n');
      }
      // Inject Curator session brief if available
      try {
        const brief = ctx.shortTerm.get(sessionId, 'session_brief');
        if (brief && typeof brief === 'string' && brief.length > 0) {
          greetingText += `\n\n**Context Brief:**\n${brief}`;
        }
      } catch { /* brief lookup failure is non-fatal */ }
      ctx.sessionManager.addMessage(sessionId, 'assistant', greetingText);
      broadcast('secretary_greeting', { sessionId, greeting });
    } catch {
      // Greeting failure is non-fatal
    }
  }

  try {
    const { agent } = getOrCreateAgent(sessionId, projectId || 'global', captainId, model ?? undefined, thinkingBudget);

    // Augment message with attached file contents (shared by all modes)
    let augmentedMessage = message;
    if (files.length > 0) {
      const fileLines: string[] = [];
      for (const f of files) {
        fileLines.push(`- ${f.name} (${f.path})`);
        if (f.type === 'project') {
          try {
            const { readFile } = await import('node:fs/promises');
            const { join } = await import('node:path');
            const root = join(process.cwd(), '..', '..', '..');
            const fullPath = join(root, f.path);
            if (fullPath.startsWith(root)) {
              const content = await readTextFile(fullPath);
              fileLines.push(`\n--- ${f.path} ---\n${content.slice(0, 8000)}\n`);
            }
          } catch {
            /* file not readable, skip content */
          }
        }
      }
      augmentedMessage = `${message}\n\n[Attached files]\n${fileLines.join('\n')}`;
    }

    if (ctx.gateway) {
      // ── Dispatch mode: pipeline or parallel ──
      if (dispatchMode === 'pipeline' || dispatchMode === 'parallel') {
        const executor = new ToolExecutor();
        registerCabinetTools(executor, buildToolDependencies(ctx));
  registerSkillTools(executor);
  const mcpCtx = getServerContext();
  registerMCPTools(executor, (name, args) => mcpCtx.mcpManager.callTool(name, args), () => mcpCtx.mcpManager.listTools());

        const dispatcher = new AgentDispatcher(
          ctx.gateway,
          executor,
          ctx.db,
          {
            async getShortTerm(sid: string) {
              const items: { role: 'user' | 'assistant'; content: string }[] = [];
              const session = ctx.sessionManager.get(sid);
              if (session && session.messages.length > 0) {
                // Include all messages except the current one (which is added separately by AgentLoop)
                const recentCount = Math.min(session.messages.length, 30);
                const start = Math.max(0, session.messages.length - recentCount);
                for (let i = start; i < session.messages.length; i++) {
                  const m = session.messages[i]!;
                  items.push({ role: m.role, content: m.content });
                }
              }
              const kv = ctx.shortTerm.getAll(sid);
              for (const [k, v] of Object.entries(kv)) {
                if (typeof v === 'string' && v.length > 0) {
                  items.push({ role: 'user' as const, content: `[${k}]: ${v}` });
                }
              }
              return items;
            },
            async getProjectContext(_pid: string) {
              const projCtx = ctx.project.get(_pid);
              if (!projCtx) return `Cabinet v2.0 project. ${_pid}`;
              return `Project: ${projCtx.summary}\nGoals: ${projCtx.goals.join(', ')}`;
            },
            async getEntityPreferences(_captainId: string) {
              const prefs = ctx.entity.getPreferences(_captainId);
              return prefs?.preferences ?? {};
            },
            async searchLongTerm(query: string, _pid: string) {
              const results = await ctx.longTerm.search(query, 5);
              return results.map((r) => `[Memory] ${r.content}`);
            },
          },
          ctx.eventBus,
          ctx.agentRegistry,
        );

        const result = await dispatcher.dispatch({
          mode: dispatchMode,
          request: augmentedMessage,
          sessionId,
          projectId,
          captainId,
        });

        ctx.metrics.increment('llm_call', {
          model: model ?? 'claude-sonnet-4-6',
          purpose: dispatchMode,
        });
        broadcast('secretary_message', { sessionId, projectId, captainId, mode: dispatchMode });
        try {
          broadcast('cost_updated', {
            daily: ctx.costTracker.getDailyCost(),
            model: model ?? 'claude-sonnet-4-6',
            timestamp: new Date().toISOString(),
          });
        } catch { /* non-fatal */ }

        return c.json({
          sessionId,
          projectId,
          captainId,
          response: result.finalOutput,
          dispatchMode,
          steps: result.steps.map((s) => ({
            role: s.role,
            status: s.status,
            durationMs: s.durationMs,
            agentSteps: s.steps,
          })),
          totalSteps: result.totalSteps,
          totalDurationMs: result.totalDurationMs,
        });
      }

      // ── Single mode (default) ──
      // SSE streaming path — true token-level streaming via gateway.streamText()
      if (stream) {
        const sseStream = new ReadableStream({
          async start(controller) {
            const encoder = new TextEncoder();
            function emit(type: string, data: Record<string, unknown>) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`));
            }
            try {
              capturedMeetingResult = null;
              emit('status', { message: 'Thinking...' });

              let streamedContent = '';

              const streamResult = await agent.handleMessageStreaming(
                sessionId,
                augmentedMessage,
                {
                  onRoutingStart(targetAgent) {
                    emit('routing_start', { targetAgent });
                  },
                  onChunk(content) {
                    streamedContent += content;
                    emit('chunk', { content });
                  },
                  onThinking(content) {
                    emit('thinking', { content });
                  },
                  onThinkingDone() {
                    emit('thinking_done', {});
                  },
                  onToolCall(name, args) {
                    emit('tool_status', { message: `Using tool: ${name}...`, toolType: 'call', detail: { name, args } });
                  },
                  onToolResult(name, result) {
                    emit('tool_status', { message: `Tool completed: ${name}`, toolType: 'result', detail: { name, result } });
                  },
                  onUsage(usage) {
                    ctx.costTracker.record(model ?? 'claude-sonnet-4-6', usage.promptTokens, usage.completionTokens);
                    emit('usage', { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens });
                  },
                  onDone(fullContent) {
                    streamedContent = fullContent;
                    // Done event is emitted after routing below
                  },
                  onError(error) {
                    emit('error', { message: error });
                  },
                },
              );

              const targetAgent = streamResult.routeResult?.targetAgent ?? 'secretary';
              const isRouted = targetAgent !== 'secretary';

              // Emit routing info BEFORE done (so client receives it before closing the stream)
              if (streamResult.routeResult && isRouted) {
                emit('routing', {
                  targetAgent,
                  confidence: streamResult.routeResult.confidence,
                  reasoning: streamResult.routeResult.reasoning,
                });
              }

              // Emit done last — client stops reading here, so routing must come first
              const meeting = capturedMeetingResult;
              ctx.metrics.increment('llm_call', { model: model ?? 'claude-sonnet-4-6', purpose: 'chat' });
              broadcast('secretary_message', { sessionId, projectId, captainId, mode: 'single' });
              try {
                broadcast('cost_updated', {
                  daily: ctx.costTracker.getDailyCost(),
                  model: model ?? 'claude-sonnet-4-6',
                  timestamp: new Date().toISOString(),
                });
              } catch { /* non-fatal */ }
              emit('done', {
                sessionId,
                meeting: meeting ?? undefined,
                agentName: targetAgent,
                content: streamedContent,
                routed: isRouted,
                ...(streamResult.routeResult ? {
                  targetAgent,
                  confidence: streamResult.routeResult.confidence,
                  reasoning: streamResult.routeResult.reasoning,
                } : {}),
              });
            } catch (e: any) {
              emit('error', { message: e.message ?? 'Unknown error' });
            } finally {
              controller.close();
            }
          },
        });

        return new Response(sseStream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          },
        });
      }

      // ── Non-streaming single mode ──
      capturedMeetingResult = null; // Reset before running
      const result = await agent.handleMessage(sessionId, augmentedMessage);
      const meeting = capturedMeetingResult; // Capture any meeting created by tools

      // Record cost if available
      if (result.usage) {
        ctx.costTracker.record(
          model ?? 'claude-sonnet-4-6',
          result.usage.promptTokens,
          result.usage.completionTokens,
        );
      }
      ctx.metrics.increment('llm_call', { model: model ?? 'claude-sonnet-4-6', purpose: 'chat' });

      broadcast('secretary_message', { sessionId, projectId, captainId, mode: 'single' });
      try {
        broadcast('cost_updated', {
          daily: ctx.costTracker.getDailyCost(),
          model: model ?? 'claude-sonnet-4-6',
          timestamp: new Date().toISOString(),
        });
      } catch { /* non-fatal */ }
      return c.json({
        sessionId,
        projectId,
        captainId,
        response: result.response,
        intent: result.intent,
        route: result.routeResult
          ? {
              targetAgent: result.routeResult.targetAgent,
              confidence: result.routeResult.confidence,
              reasoning: result.routeResult.reasoning,
              suggestion: result.routeResult.suggestion,
            }
          : undefined,
        mode: 'single',
        dispatchMode: 'single',
        model: model ?? 'claude-sonnet-4-6',
        toolCalls: (result as any).toolCalls ?? 0,
        meeting: meeting ?? undefined,
        agentName: 'Secretary',
      });
    } else {
      const parser = new IntentParser();
      const intent = parser.parse(message);
      ctx.sessionManager.addMessage(sessionId, 'user', message);
      const response = `[No API key] Intent: ${intent.kind}. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env for LLM mode.`;
      ctx.sessionManager.addMessage(sessionId, 'assistant', response);
      broadcast('secretary_message', { sessionId, projectId, captainId, mode: 'fallback' });
      return c.json({
        sessionId,
        projectId,
        captainId,
        response,
        intent,
        mode: 'fallback',
        model: 'none',
      });
    }
  } catch (error) {
    const msg = (error as Error).message;
    ctx.logger.error('Secretary agent error', { error: msg });
    const isAuthError =
      msg.includes('API key') || msg.includes('not configured') || msg.includes('401');
    return c.json(
      {
        sessionId,
        projectId,
        captainId,
        response: `Error: ${msg}`,
        intent: { kind: 'unknown' },
        mode: 'error',
      },
      isAuthError ? 503 : 500,
    );
  }
});

// ── GET /verify ──
secretaryRouter.get('/verify', async (c) => {
  const { gateway, costTracker, metrics } = getServerContext();
  if (!gateway) {
    return c.json({
      status: 'no_api_key',
      message: 'Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env to enable LLM.',
    });
  }
  try {
    const start = Date.now();
    const testModel = resolveModel({ modelTier: 'default', model: 'claude-haiku-4-5' });
    const response = await gateway.generateText({
      model: testModel,
      messages: [{ role: 'user', content: 'Reply with just "OK".' }],
      maxTokens: 10,
    });
    costTracker.record(
      response.model ?? testModel,
      response.usage?.promptTokens ?? 0,
      response.usage?.completionTokens ?? 0,
    );
    metrics.increment('llm_call', { model: response.model ?? testModel, purpose: 'verify' });
    const latency = Date.now() - start;
    return c.json({
      status: 'ok',
      latency_ms: latency,
      model: response.model,
      tokens: response.usage,
    });
  } catch (error) {
    return c.json(
      {
        status: 'error',
        message: (error as Error).message,
        hint: 'Check your API key and network connection.',
      },
      503,
    );
  }
});

// ── GET /sessions ──
secretaryRouter.get('/sessions', (c) => {
  const { sessionManager } = getServerContext();
  const sessions = sessionManager.list();
  return c.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      title: s.title,
      projectId: s.projectId,
      messageCount: s.messages.length,
      updatedAt: s.updatedAt,
    })),
  });
});

// ── GET /context ──
secretaryRouter.get('/context', (c) => {
  const { sessionManager, metrics } = getServerContext();
  const sessionId = c.req.query('sessionId') ?? 'default';
  const session = sessionManager.get(sessionId);

  const messageCount = session?.messages.length ?? 0;
  // Rough estimate: ~4 chars per token
  const totalChars = session?.messages.reduce((sum, m) => sum + m.content.length, 0) ?? 0;
  const estimatedTokens = Math.ceil(totalChars / 4);

  // Use actual model context window (claude-sonnet-4-6 = 200k, but report accurately)
  const maxContextTokens = 200000;

  return c.json({
    sessionId,
    messageCount,
    estimatedTokens,
    maxContextTokens,
    summary: metrics.getSummary(),
  });
});

// ── POST /compact ──
secretaryRouter.post('/compact', async (c) => {
  const ctx = getServerContext();
  const body = await c.req.json().catch(() => ({}));
  const sessionId = body.sessionId ?? 'default';

  const session = ctx.sessionManager.get(sessionId);
  if (!session) return c.json({ compacted: false, reason: 'Session not found' }, 404);

  const messages = session.messages;
  if (messages.length <= 4) return c.json({ compacted: true, messageCount: messages.length });

  // Keep last 4 messages intact, summarize older ones
  const keepCount = 4;
  const toSummarize = messages.slice(0, messages.length - keepCount);
  const recent = messages.slice(messages.length - keepCount);

  // Build a summary from old messages
  const summaryParts: string[] = [];
  let lastRole = '';
  for (const m of toSummarize) {
    if (m.role !== lastRole) {
      summaryParts.push(`${m.role === 'user' ? 'User asked' : 'Assistant responded'} about: ${m.content.slice(0, 200)}`);
      lastRole = m.role;
    }
  }

  const summary = `[Context summary: ${toSummarize.length} earlier messages compressed. Key topics: ${summaryParts.slice(0, 5).join('; ')}]`;

  // Replace old messages with summary + recent
  session.messages.length = 0;
  session.messages.push({ role: 'user', content: summary, timestamp: new Date() });
  for (const m of recent) {
    session.messages.push(m);
  }

  return c.json({
    compacted: true,
    previousCount: messages.length,
    newCount: session.messages.length,
    estimatedTokens: Math.ceil(session.messages.reduce((sum, m) => sum + m.content.length, 0) / 4),
  });
});

// ── GET /greeting ──
secretaryRouter.get('/greeting', (c) => {
  const { decisionRepo, workflowRepo, costTracker } = getServerContext();
  const greeter = new GreetingService();

  const pendingDecisions = decisionRepo.countByStatus('pending');
  const activeWorkflows = workflowRepo.countByStatus(['running', 'awaiting_approval']);
  const todayCost = costTracker.getDailyCost();

  const result = greeter.generate({
    captainName: 'Captain',
    pendingDecisions,
    activeWorkflows,
    todayCost,
  });

  return c.json(result);
});
