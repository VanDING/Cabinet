import { existsSync, readdirSync } from 'node:fs';
import type { ToolDefinition } from './tool-executor.js';

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
}

// ── Skill Registry ──

export class SkillRegistry {
  private skills = new Map<string, SkillEntry>();

  /** Register a skill (from DB or SKILL.md import). */
  register(skill: SkillEntry): void {
    this.skills.set(skill.name, skill);
  }

  /** Unregister a skill by name. */
  unregister(name: string): boolean {
    return this.skills.delete(name);
  }

  /** L1: Return metadata for all active skills (for LLM routing). */
  discover(): SkillMetadata[] {
    const results: SkillMetadata[] = [];
    for (const s of this.skills.values()) {
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
    return [...this.skills.keys()];
  }

  /** Get all entries. */
  listAll(): SkillEntry[] {
    return [...this.skills.values()];
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
    const tools: ToolDefinition[] = [];
    for (const skill of this.skills.values()) {
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
      prompt = prompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
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
