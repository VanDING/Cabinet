//
// AutoDiscoverer — scans the filesystem and PATH for available agent CLIs.
//
// On startup, discovers CLI agents (claude, codex, etc.) by checking PATH,
// and A2A agents by scanning ~/.cabinet/agents/ for agent.json files.
// Discovered agents are registered in AgentRoleRegistry automatically.
//

import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CABINET_DIR } from '@cabinet/storage';
import type { AgentRoleRepository } from '@cabinet/storage';
import type { AgentRoleRegistry } from '../agent-roles.js';

// ── Known CLI agents ──────────────────────────────────────────────

export interface KnownCliAgent {
  name: string;
  command: string;
  detectArgs: string[];
  installHint?: string;
}

const KNOWN_CLI_AGENTS: KnownCliAgent[] = [
  { name: 'Claude Code', command: 'claude', detectArgs: ['--version'] },
  { name: 'Codex', command: 'codex', detectArgs: ['--version'] },
  { name: 'OpenCode', command: 'opencode', detectArgs: ['--version'] },
  { name: 'Qwen Code', command: 'qwen-code', detectArgs: ['--version'] },
  { name: 'Gemini CLI', command: 'gemini', detectArgs: ['--version'] },
  { name: 'Cursor Agent', command: 'cursor-agent', detectArgs: ['--version'] },
  { name: 'Kimi', command: 'kimi', detectArgs: ['--version'] },
  { name: 'Kiro CLI', command: 'kiro-cli', detectArgs: ['--version'] },
];

const AGENTS_DIR = join(CABINET_DIR, 'agents');

export interface DiscoveryResult {
  agentId: string;
  name: string;
  protocol: 'cli' | 'a2a';
  command?: string;
  baseUrl?: string;
  detected: boolean;
  error?: string;
}

export class AutoDiscoverer {
  private lastResults: DiscoveryResult[] = [];

  constructor(
    private readonly registry: AgentRoleRegistry,
    private readonly agentRoleRepo?: AgentRoleRepository,
  ) {}

  /** Run full discovery: CLI PATH scan + A2A directory scan. */
  async discover(): Promise<DiscoveryResult[]> {
    const results: DiscoveryResult[] = [];

    // CLI discovery
    for (const agent of KNOWN_CLI_AGENTS) {
      const installed = await this.detectCommand(agent.command, agent.detectArgs);
      const agentId = `external_cli:${agent.command}`;
      results.push({
        agentId,
        name: agent.name,
        protocol: 'cli',
        command: agent.command,
        detected: installed,
        error: installed ? undefined : 'Not found on PATH',
      });

      if (installed) {
        this.registerCliAgent(agentId, agent);
      }
    }

    // A2A directory scan
    if (existsSync(AGENTS_DIR)) {
      try {
        const entries = readdirSync(AGENTS_DIR, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const agentJsonPath = join(AGENTS_DIR, entry.name, 'agent.json');
          if (!existsSync(agentJsonPath)) continue;

          try {
            const raw = readFileSync(agentJsonPath, 'utf-8');
            const card = JSON.parse(raw);
            const agentId = `external_a2a:${card.name ?? entry.name}`;
            results.push({
              agentId,
              name: card.display_name ?? card.name ?? entry.name,
              protocol: 'a2a',
              baseUrl: card.connection?.base_url ?? card.baseUrl,
              detected: true,
            });
            this.registerA2AAgent(agentId, card, entry.name);
          } catch (err) {
            results.push({
              agentId: `external_a2a:${entry.name}`,
              name: entry.name,
              protocol: 'a2a',
              detected: false,
              error: `Invalid agent.json: ${String(err)}`,
            });
          }
        }
      } catch {
        // AGENTS_DIR not readable — skip
      }
    }

    this.lastResults = results;
    return results;
  }

  /** Return cached discovery results. */
  getLastResults(): DiscoveryResult[] {
    return this.lastResults;
  }

  // ── CLI detection ─────────────────────────────────────────────

  private detectCommand(command: string, args: string[]): Promise<boolean> {
    return new Promise((resolve) => {
      const isWindows = process.platform === 'win32';
      const proc = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000,
        shell: isWindows,
      });
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }

  // ── Registration ──────────────────────────────────────────────

  private registerCliAgent(agentId: string, agent: KnownCliAgent): void {
    if (this.registry.get(agentId)) return; // already registered
    this.registry.register({
      type: 'external_cli',
      name: agentId,
      description: `${agent.name} CLI agent (auto-discovered)`,
      modules: {
        identity: `You are ${agent.name}, running as a CLI agent dispatched by Cabinet.`,
      },
      modelTier: 'default',
      temperature: 0.7,
      allowedTools: [],
      contextBudget: 0.3,
      external: {
        protocol: 'cli',
        configSource: 'agent_native',
        command: agent.command,
        args: ['--print'],
        timeoutMs: 300_000,
        maxRetries: 2,
      },
    });

    // Persist to DB so it survives restarts and shows in UI
    if (this.agentRoleRepo && !this.agentRoleRepo.findByName(agentId)) {
      try {
        this.agentRoleRepo.upsert({
          type: 'external_cli',
          name: agentId,
          description: `${agent.name} CLI agent (auto-discovered)`,
          system_prompt: `You are ${agent.name}, running as a CLI agent dispatched by Cabinet.`,
          model: 'default',
          model_tier: 'default',
          temperature: 0.7,
          max_response_tokens: 4096,
          allowed_tools: '[]',
          context_budget: 0.3,
          is_builtin: 0,
          created_at: new Date().toISOString(),
        });
      } catch { /* DB write is best-effort */ }
    }
  }

  private registerA2AAgent(agentId: string, card: Record<string, unknown>, dirName: string): void {
    if (this.registry.get(agentId)) return;
    const conn = (card.connection ?? {}) as Record<string, unknown>;
    const identity = (card.systemPrompt as string) ?? (card.instructions as string) ?? `You are ${dirName}.`;
    this.registry.register({
      type: 'external_a2a',
      name: agentId,
      description: (card.description as string) ?? `${dirName} A2A agent (auto-discovered)`,
      modules: { identity },
      modelTier: 'default',
      temperature: 0.7,
      allowedTools: [],
      contextBudget: 0.3,
      external: {
        protocol: 'a2a',
        configSource: 'agent_native',
        baseUrl: (conn.base_url as string) ?? (card.baseUrl as string) ?? `http://localhost:${dirName}`,
        healthCheckUrl: (conn.health_check as string),
        timeoutMs: 120_000,
        maxRetries: 2,
      },
    });

    // Persist to DB
    if (this.agentRoleRepo && !this.agentRoleRepo.findByName(agentId)) {
      try {
        this.agentRoleRepo.upsert({
          type: 'external_a2a',
          name: agentId,
          description: (card.description as string) ?? `${dirName} A2A agent (auto-discovered)`,
          system_prompt: identity,
          model: 'default',
          model_tier: 'default',
          temperature: 0.7,
          max_response_tokens: 4096,
          allowed_tools: '[]',
          context_budget: 0.3,
          is_builtin: 0,
          created_at: new Date().toISOString(),
        });
      } catch { /* DB write is best-effort */ }
    }
  }
}
