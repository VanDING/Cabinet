import type { ToolDefinition } from './tool-executor.js';

// ── Skill Metadata (L1 — always loaded, ~50 tokens each) ──

export interface SkillMetadata {
  name: string;
  description: string;
  kind: 'tool' | 'prompt' | 'composite';
  version: number;
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
        results.push({ name: s.name, description: s.description, kind: s.kind, version: s.version });
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
        execute: async (args: Record<string, unknown>) => {
          return this.executeSkill(skill, args);
        },
      });
    }
    return tools;
  }

  /** Execute a skill's prompt template with input variables. */
  async executeSkill(
    skill: SkillEntry,
    args: Record<string, unknown>,
  ): Promise<{ skillName: string; output: string }> {
    // Simple template substitution: replace {{key}} with arg values
    let prompt = skill.promptTemplate;
    for (const [key, value] of Object.entries(args)) {
      prompt = prompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
    }
    return { skillName: skill.name, output: prompt };
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
