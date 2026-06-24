//
// Agent Roles — Cabinet system agents.
//
// These are the 5 "cabinet members" hardcoded into the framework.
// Domain-specific agents (MarketAnalyst, CodeReviewer, etc.) are NOT here —
// they are created dynamically via AgentCreator (Task 4).
//
// Each role defines:
//   - system prompt (role-specific instructions)
//   - model preference (cost/speed/capability tradeoff)
//   - tool subset (only the tools relevant to this role)
//   - context budget (how much context this role typically needs)
//

import type { ExternalAgentConfig } from '@cabinet/types';
import { buildCliExternalConfig, buildA2AExternalConfig } from './external-config.js';

// ── Role Definition ────────────────────────────────────────────

export type AgentRoleType =
  | 'secretary'
  | 'curator'
  | 'organize'
  | 'custom'
  | 'external_a2a'
  | 'external_cli';

export type ModelTier = 'deep_reasoning' | 'fast_execution' | 'default';

export interface AgentRole {
  type: AgentRoleType;
  name: string;
  description: string;
  modules: {
    identity: string;
    workflow?: string;
  };
  /** Model tier for routing to user-configured models. */
  modelTier: ModelTier;
  /** Temperature (0 = deterministic, 1 = creative). */
  temperature: number;
  /** Max tokens for LLM response (undefined = model default, no artificial limit). */
  maxResponseTokens?: number;
  /** Tool names this role is allowed to use (empty = all tools). */
  allowedTools: string[];
  /** Context window budget as fraction of total (e.g., 0.3 = 30%). */
  contextBudget: number;
  /** Maximum agent loop steps (default 50 if not set). */
  maxSteps?: number;
  /** Alternative names users might call this agent. e.g. ["codebot", "coder"] */
  aliases?: string[];
  /** Keywords associated with this agent's domain. e.g. ["code", "programming"] */
  keywords?: string[];
  /** Model tier to use for complex/upgraded tasks (e.g., L2/L3 decisions). */
  upgradeModelTier?: ModelTier;
  /** Model tier to use for simple/downgraded tasks (e.g., modifying existing workflow). */
  downgradeModelTier?: ModelTier;
  /** External Agent configuration — only valid when type is external_a2a or external_cli. */
  external?: import('@cabinet/types').ExternalAgentConfig;
}

// ── Built-in Cabinet Roles ─────────────────────────────────────

export const SECRETARY_ROLE: AgentRole = {
  type: 'secretary',
  name: 'Secretary',
  description:
    'Conversation entry point. Understands intent, routes requests to the right cabinet member, handles general questions directly.',
  modules: {
    identity: [
      'You are the Secretary of Cabinet — the entry point for all Captain interactions.',
      '',
      'Core responsibilities:',
      "1. Understand the Captain's intent. Handle general questions directly.",
      '2. For specialized tasks, route to the appropriate cabinet member (Organize, or any custom/external agent).',
      '3. The routing system suggests the best agent — trust it for clear-cut cases, override when you see a better fit.',
    ].join('\n'),
    workflow: [
      '## Routing Rules',
      'Route to organize: workflow design, agent creation, skill writing, MCP building, system architecture design.',
      'Route to custom/external agents: domain-specific tasks (code generation, research, analysis).',
      'Handle yourself: general questions, code review, file review, analysis, file operations, multi-perspective deliberation.',
      '',
      '## Decision Analysis Mode',
      'When asked for decision analysis (权衡/选择/决策):',
      '1. Frame the real question. 2. Expand options. 3. Evaluate across cost, risk, time, reversibility, strategic fit.',
      '4. Assign authorization level (L0-L3). 5. Use create_decision tool. 6. Recommend with caveats, preserve Captain choice.',
      '',
      '## Development Workflow',
      'Edit code → Run tests → Read errors → Fix → Report summary when tests pass.',
      '',
      '## Session Start',
      '- Check short-term memory for recent session context (key: "session_brief"). If prior conversation exists, summarize it briefly.',
      '',
      '## Web Access',
      'When asked about external information, current events, or documentation: use web_fetch. Do not guess or hallucinate.',
      '',
      '## Routing Feedback',
      'Watch for feedback after specialist responses:',
      '- Negative ("不对", "不是这个", "错了") → route was wrong, re-route.',
      '- Positive ("很好", "不错", "对的") → route was correct.',
      '',
      '## Inline Decision Markers',
      'Use [[DECISION:<decision_id>]] to render a decision card inline. Only after calling create_decision.',
    ].join('\n'),
  },
  modelTier: 'default',
  temperature: 0.5,
  allowedTools: [
    'readFile',
    'writeFile',
    'deleteFile',
    'listDirectory',
    'grep',
    'fileInfo',
    'makeDirectory',
    'executeCommand',
    'search',
    'lspInspect',
    'webFetch',
    'webSearch',
    'gitStatus',
    'gitDiff',
    'gitDiffStaged',
    'gitLog',
    'gitShow',
    'gitBranch',
    'gitBlame',
    'gitCheckoutBranch',
    'getDecision',
    'createDecision',
    'approveDecision',
    'rejectDecision',
    'listExternalAgents',
    'registerExternalAgent',
    'deleteExternalAgent',
    'getSystemStatus',
    'getDashboardStats',
    'getMemoryStats',
    'npmInstall',
    'npmList',
    'create_skill',
    'update_skill',
    'use_skill',
  ],
  maxSteps: 500,
};

export const CURATOR_ROLE: AgentRole = {
  type: 'curator',
  name: 'Curator',
  description:
    'Memory curator and pattern analyst. Generates summaries, consolidates learnings, extracts patterns from history.',
  modules: {
    identity:
      'Memory curator and pattern analyst. Summarizes sessions, consolidates learnings, extracts patterns from history.',
    workflow:
      'Use Mastra readFile, grep for reading. Memory operations via Mastra Memory (thread management).',
  },
  modelTier: 'fast_execution',
  temperature: 0.2,
  maxResponseTokens: 4000,
  allowedTools: [
    'readFile',
    'grep',
    'listDirectory',
    'webFetch',
    'getDecision',
    'getSystemStatus',
    'getDashboardStats',
    'use_skill',
  ],
  contextBudget: 0.4,
  maxSteps: 150,
};

export const ORGANIZE_ROLE: AgentRole = {
  type: 'organize',
  name: 'Organize',
  description:
    'Chief organization architect. Translates fuzzy business goals into executable blueprints — agents, workflows, quality gates, and authorization rules.',
  modules: {
    identity: [
      'You are the Organize Agent — the Chief Organization Architect of Cabinet.',
      '',
      "Your mission: translate the Captain's fuzzy business goal into a concrete, executable organization blueprint.",
      '',
      'You are both the architect and the implementer. Default to direct implementation.',
      'Prefer reusing existing agents over creating new ones. Use list_agents before register_agent.',
      'Be proactive within safety boundaries — drive through steps, but always call create_decision for L2+ approval.',
      'When the goal is simple (single-agent, no new workflow): Clarify → Design → Execute → Memorize.',
    ].join('\n'),
    workflow: [
      '## The Six-Step Method',
      '',
      '### Step 1: Clarify (探明需求)',
      '- Understand what the Captain really wants. Ask clarifying questions if vague.',
      '- Use recall, search_memory, get_project_context for context.',
      '- Confirm: what does success look like? Constraints?',
      '',
      '### Step 2: Design (设计方案)',
      '- Decompose the goal into capability requirements.',
      '- Use list_agents to find existing agents. For gaps: design new agents. Do NOT create yet.',
      '- Design workflow, quality gates, authorization rules (L2/L3 approval).',
      '- Call use_skill__workflowDesigner and use_skill__agentCreator for latest design rules.',
      '- Verify: all capabilities covered, no overlapping responsibilities, no circular dependencies.',
      '',
      '### Step 3: Implementation Plan (实施方案)',
      '- Translate design into ordered tool calls: register agents → create workflow → await approval.',
      '- Identify risks and fallbacks.',
      '- Verify: dependencies resolved, workflow schema valid, tools compatible with safety tier.',
      '',
      '### Step 4: Execute (顺序执行)',
      '- Follow the plan step by step. Do NOT skip.',
      '- If a tool call fails, STOP and report. Do not proceed blindly.',
      '',
      '### Step 5: Activate, Test & Iterate (运行测试 + 回退)',
      '- Call run_workflow. Inspect result.',
      '- If design flaw → return to Step 2. If implementation flaw → return to Step 3.',
      '- Do NOT retry without changing something.',
      '',
      '### Step 6: Memorize (写入记忆)',
      '- write_memory with importance ≥ 0.8: {type: "design_experience", goal, agents_created, workflow_id, lessons}.',
      '- Report final summary: agents created, workflow deployed, how to monitor, key lessons.',
      '',
      '## Agent Assignment Principles',
      '- Consecutive steps sharing domain = same agent. Execution agent ≠ approval agent (L2/L3).',
      '- Split parallel steps across agents with different competencies.',
      '- When uncertain: mark as design_decision for Captain.',
      '',
      '## Built-in Skills',
      '- use_skill__workflowDesigner — workflow design rules',
      '- use_skill__agentCreator — agent configuration rules',
      '- use_skill__skillCreator — skill authoring',
      '- use_skill__mcpBuilder — MCP server development',
      '',
      '## Blueprint Output',
      'Present in plain language, then as structured JSON:',
      '{goal, agents: [...], workflow: [...], qualityGates: [...], authorization: [...], designDecisions: [...]}',
    ].join('\n'),
  },
  modelTier: 'deep_reasoning',
  temperature: 0.4,
  allowedTools: [
    'listExternalAgents',
    'registerExternalAgent',
    'deleteExternalAgent',
    'readFile',
    'writeFile',
    'listDirectory',
    'grep',
    'fileInfo',
    'webFetch',
    'webSearch',
    'getDecision',
    'createDecision',
    'getSystemStatus',
    'create_skill',
    'update_skill',
    'use_skill',
    'use_skill__workflowDesigner',
    'use_skill__agentCreator',
    'use_skill__skillCreator',
    'use_skill__mcpBuilder',
  ],
  contextBudget: 0.5,
  maxSteps: 150,
};

export const ORGANIZE_DEPLOY_TOOLS = ['registerExternalAgent'] as const;

/** Returns the Organize role's allowed tools minus deploy-only tools, for the planning phase. */
export function getOrganizePlanningTools(): string[] {
  const deploySet = new Set<string>(ORGANIZE_DEPLOY_TOOLS);
  return ORGANIZE_ROLE.allowedTools.filter((t) => !deploySet.has(t));
}

// ── Role Registry ──────────────────────────────────────────────

export class AgentRoleRegistry {
  private roles = new Map<AgentRoleType, AgentRole>();
  private customRoles = new Map<string, AgentRole>();

  constructor() {
    this.register(SECRETARY_ROLE);
    this.register(CURATOR_ROLE);
    this.register(ORGANIZE_ROLE);
  }

  register(role: AgentRole): void {
    if (role.type === 'custom' || role.type === 'external_a2a' || role.type === 'external_cli') {
      this.customRoles.set(role.name, role);
    } else {
      this.roles.set(role.type, role);
    }
  }

  get(type: AgentRoleType | string): AgentRole | undefined {
    const builtin = this.roles.get(type as AgentRoleType);
    if (builtin) return builtin;
    // Custom and external agents are keyed by name
    const direct = this.customRoles.get(type);
    if (direct) return direct;
    for (const [name, role] of this.customRoles) {
      if (name === type || role.name === type) return role;
    }
    return undefined;
  }

  list(): AgentRole[] {
    return [...this.roles.values(), ...this.customRoles.values()];
  }

  listBuiltIn(): AgentRole[] {
    return [...this.roles.values()];
  }

  /** Remove a custom role from the registry. */
  unregister(type: string): boolean {
    return this.customRoles.delete(type);
  }

  /** Update mutable fields on a live role without touching the shared constant. */
  update(type: AgentRoleType | string, updates: Partial<AgentRole>): AgentRole | undefined {
    const existing = this.roles.get(type as AgentRoleType) ?? this.customRoles.get(type);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates };
    if (existing.type === 'custom' || existing.type.startsWith('external_')) {
      this.customRoles.set(updated.name, updated);
    } else {
      this.roles.set(type as AgentRoleType, updated);
    }
    return updated;
  }

  /** Build a prompt fragment describing all available agents (for LLM routing). */
  describeForRouting(): string {
    const lines: string[] = [];
    for (const r of this.roles.values()) {
      if (r.type === 'curator') continue; // background-only, never routable
      lines.push(`- ${r.type}: ${r.description}`);
    }
    for (const r of this.customRoles.values()) {
      const sourceTag = r.type.startsWith('external_') ? ` (${r.type})` : ' (custom)';
      lines.push(`- ${r.name}${sourceTag}: ${r.description}`);
    }
    return lines.join('\n');
  }

  /**
   * Register an external agent (CLI or A2A) with dedup check.
   * Returns true if registered, false if already exists.
   */
  registerExternalAgent(params: {
    protocol: 'cli' | 'a2a';
    name: string;
    description: string;
    identity: string;
    command?: string;
    args?: string[];
    baseUrl?: string;
    timeoutMs?: number;
    maxRetries?: number;
    dispatchProtocol?: 'acp' | 'headless' | 'terminal-only';
    nativeConfigPaths?: { win32: string[]; darwin: string[]; linux: string[] };
    sdkPackage?: string;
  }): boolean {
    const existing = this.customRoles.get(params.name);
    if (existing) {
      const external =
        params.protocol === 'cli'
          ? buildCliExternalConfig(params.command!, {
              args: params.args,
              dispatchProtocol: params.dispatchProtocol,
              nativeConfigPaths: params.nativeConfigPaths,
              sdkPackage: params.sdkPackage,
            })
          : buildA2AExternalConfig(params.baseUrl!);
      this.customRoles.set(params.name, { ...existing, external });
      return true;
    }
    const type = params.protocol === 'cli' ? 'external_cli' : 'external_a2a';
    const external =
      params.protocol === 'cli'
        ? buildCliExternalConfig(params.command!, {
            args: params.args,
            dispatchProtocol: params.dispatchProtocol,
            nativeConfigPaths: params.nativeConfigPaths,
            sdkPackage: params.sdkPackage,
          })
        : buildA2AExternalConfig(params.baseUrl!);
    this.register({
      type,
      name: params.name,
      description: params.description,
      modules: { identity: params.identity },
      modelTier: 'default',
      temperature: 0.7,
      allowedTools: [],
      contextBudget: 0.3,
      external,
    });
    return true;
  }

  /** Return all valid agent type strings (built-in types + custom/external agent names). */
  getValidAgentTypes(): Set<string> {
    const types = new Set<string>();
    for (const r of this.roles.values()) {
      if (r.type === 'curator') continue; // background-only, never routable
      types.add(r.type);
    }
    for (const r of this.customRoles.values()) {
      types.add(r.name);
    }
    return types;
  }
}
