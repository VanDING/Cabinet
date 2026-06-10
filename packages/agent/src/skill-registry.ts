import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolDefinition } from './tool-executor.js';
import { parseSkillMarkdown } from './skill-loader.js';

// ── Skill Metadata (L1 — always loaded, ~50 tokens each) ──

export interface SkillMetadata {
  name: string;
  description: string;
  kind: 'tool' | 'prompt' | 'composite';
  version: number;
  /** Names of other skills this skill depends on. */
  dependencies?: string[];
}

// ── Full Skill (L2 — loaded on demand) ──

export interface SkillEntry extends SkillMetadata {
  id: string;
  promptTemplate: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  status: 'draft' | 'active' | 'deprecated';
  /** File path to optional reference docs (L3). */
  referencesPath?: string;
  /** File path to optional executable scripts. */
  scriptsPath?: string;
  /** Claude Code extended fields (model, effort, context, agent, etc.). */
  metadata?: Record<string, unknown>;
  /** Scope: global (shared) or project (local to a project). */
  scope?: 'global' | 'project';
}

// ── Simple async mutex for write serialization ──

class Mutex {
  private locked = false;
  private queue: Array<() => void> = [];

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}

// ── Skill Registry ──

export class SkillRegistry {
  private skills = new Map<string, SkillEntry>();
  private writeMutex = new Mutex();

  /** Register a skill (from DB or SKILL.md import). Synchronous — safe in single-threaded Node.js. */
  register(skill: SkillEntry): void {
    this.skills.set(skill.name, skill);
  }

  /** Async variant of register for concurrent scenarios. */
  async registerAsync(skill: SkillEntry): Promise<void> {
    await this.writeMutex.acquire();
    try {
      this.skills.set(skill.name, skill);
    } finally {
      this.writeMutex.release();
    }
  }

  /** Unregister a skill by name. */
  unregister(name: string): boolean {
    return this.skills.delete(name);
  }

  /** Async variant of unregister for concurrent scenarios. */
  async unregisterAsync(name: string): Promise<boolean> {
    await this.writeMutex.acquire();
    try {
      return this.skills.delete(name);
    } finally {
      this.writeMutex.release();
    }
  }

  /** L1: Return metadata for all active skills (for LLM routing). */
  discover(): SkillMetadata[] {
    const snapshot = new Map(this.skills);
    const results: SkillMetadata[] = [];
    for (const s of snapshot.values()) {
      if (s.status === 'active') {
        results.push({
          name: s.name,
          description: s.description,
          kind: s.kind,
          version: s.version,
        });
      }
    }
    return results;
  }

  /** L2: Load full skill entry by name. */
  load(name: string): SkillEntry | undefined {
    return this.skills.get(name);
  }

  /** L3: Get reference docs path for a skill (caller reads file on demand). */
  getReferencesPath(name: string): string | undefined {
    return this.skills.get(name)?.referencesPath;
  }

  /** List all registered skill names. */
  listNames(): string[] {
    return [...new Map(this.skills).keys()];
  }

  /** Get all entries. */
  listAll(): SkillEntry[] {
    return [...new Map(this.skills).values()];
  }

  /** Build a prompt fragment describing available skills for LLM routing context. */
  describeForRouting(): string {
    const active = this.discover();
    if (active.length === 0) return '';
    return active
      .map((s) => `- /${s.name}: ${s.description} (${s.kind}, v${s.version})`)
      .join('\n');
  }

  /** Convert all active skills to ToolDefinitions for injection into ToolExecutor. */
  getToolDefinitions(): ToolDefinition[] {
    const snapshot = new Map(this.skills);
    const tools: ToolDefinition[] = [];
    for (const skill of snapshot.values()) {
      if (skill.status !== 'active') continue;
      tools.push({
        name: `use_skill__${skill.name}`,
        description: skill.description,
        parameters: {
          type: 'object',
          properties: {
            skill: { type: 'string', description: `Skill name: ${skill.name}` },
            arguments: {
              type: 'string',
              description: `Arguments to pass to the ${skill.name} skill (optional)`,
            },
          },
        },
        execute: async (args: Record<string, unknown>) => {
          return this.executeSkill(skill, args);
        },
      });
    }
    return tools;
  }

  /** Load all skills from a directory (e.g., ~/.cabinet/skills/ or project/.cabinet/skills/). */
  loadFromDirectory(dir: string, scope: 'global' | 'project' = 'global'): number {
    let count = 0;
    if (!existsSync(dir)) return count;
    const entries = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory());
    for (const entry of entries) {
      const skillMdPath = join(dir, entry.name, 'SKILL.md');
      if (!existsSync(skillMdPath)) continue;
      try {
        const content = readFileSync(skillMdPath, 'utf-8');
        const parsed = parseSkillMarkdown(content);
        if (!parsed) continue;
        const refsDir = join(dir, entry.name, 'references');
        const scriptsDir = join(dir, entry.name, 'scripts');
        const refsPath = existsSync(refsDir) ? refsDir : '';
        const scriptsPath = existsSync(scriptsDir) ? scriptsDir : '';
        this.register({
          id: `skill_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: parsed.name,
          description: parsed.description,
          kind: parsed.kind ?? 'prompt',
          promptTemplate: parsed.body,
          inputSchema: {},
          outputSchema: {},
          version: parsed.version ?? 1,
          status: 'active',
          referencesPath: refsPath,
          scriptsPath,
          metadata: parsed.metadata ?? {},
          scope,
        });
        count++;
      } catch {
        /* skip malformed skill */
      }
    }
    return count;
  }

  /** Async variant of loadFromDirectory for concurrent scenarios. */
  async loadFromDirectoryAsync(dir: string, scope: 'global' | 'project' = 'global'): Promise<number> {
    await this.writeMutex.acquire();
    try {
      return this.loadFromDirectory(dir, scope);
    } finally {
      this.writeMutex.release();
    }
  }

  /** Remove all project-scoped skills. Call when switching away from a project. */
  clearProjectSkills(): number {
    let count = 0;
    for (const [name, skill] of this.skills) {
      if (skill.scope === 'project') {
        this.skills.delete(name);
        count++;
      }
    }
    return count;
  }

  /** Async variant of clearProjectSkills for concurrent scenarios. */
  async clearProjectSkillsAsync(): Promise<number> {
    await this.writeMutex.acquire();
    try {
      return this.clearProjectSkills();
    } finally {
      this.writeMutex.release();
    }
  }

  private usageCounts = new Map<string, number>();

  /** Get usage statistics for all skills. */
  getUsageStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const [name, count] of this.usageCounts) {
      stats[name] = count;
    }
    return stats;
  }

  /** Execute a skill with full L3 progressive disclosure context. */
  async executeSkill(
    skill: SkillEntry,
    args: Record<string, unknown>,
  ): Promise<{ skillName: string; output: string }> {
    this.usageCounts.set(skill.name, (this.usageCounts.get(skill.name) ?? 0) + 1);
    let prompt = skill.promptTemplate;
    // Positional argument substitution ($ARGUMENTS, $0, $1, ...)
    const argumentStr = String(args.arguments ?? '');
    prompt = prompt.replace(/\$ARGUMENTS/g, argumentStr);
    const positionalArgs = argumentStr.split(/\s+/).filter(Boolean);
    for (let i = 0; i < positionalArgs.length; i++) {
      prompt = prompt.replace(new RegExp(`\\\$${i}`, 'g'), positionalArgs[i]!);
    }
    // Named argument substitution ({{key}})
    for (const [key, value] of Object.entries(args)) {
      prompt = prompt.replace(new RegExp(`\\\{\{${key}\\\}\}`, 'g'), String(value));
    }

    const sections: string[] = [];
    sections.push(`## Skill: ${skill.name}`);
    sections.push(`> ${skill.description}`);
    sections.push('');
    sections.push(prompt);

    // L3: list available scripts (executable via execCommand)
    if (skill.scriptsPath && existsSync(skill.scriptsPath)) {
      try {
        const scripts = readdirSync(skill.scriptsPath).filter((f) => !f.startsWith('.'));
        if (scripts.length > 0) {
          sections.push('\n## Available Scripts');
          for (const s of scripts) {
            const scriptPath = `${skill.scriptsPath}/${s}`;
            sections.push(`- \`scripts/${s}\` — run with execCommand, cwd: \`${scriptPath}\``);
          }
        }
      } catch {
        /* L3 best-effort */
      }
    }

    // L3: list available references (loadable via readFile)
    if (skill.referencesPath && existsSync(skill.referencesPath)) {
      try {
        const refs = readdirSync(skill.referencesPath).filter((f) => !f.startsWith('.'));
        if (refs.length > 0) {
          sections.push('\n## Available References');
          for (const r of refs) {
            sections.push(
              `- \`references/${r}\` — use readFile to load: \`${skill.referencesPath}/${r}\``,
            );
          }
        }
      } catch {
        /* L3 best-effort */
      }
    }

    return { skillName: skill.name, output: sections.join('\n') };
  }
}

/** Singleton shared across the agent layer. */
let sharedRegistry: SkillRegistry | null = null;

export function getSkillRegistry(): SkillRegistry {
  if (!sharedRegistry) {
    sharedRegistry = new SkillRegistry();
  }
  return sharedRegistry;
}

export function setSkillRegistry(registry: SkillRegistry): void {
  sharedRegistry = registry;
}
