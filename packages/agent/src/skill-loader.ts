import yaml from 'js-yaml';
import { SkillRegistry, type SkillEntry } from './skill-registry.js';
import type { ParsedSkill } from '@cabinet/types';

/**
 * Parse an Anthropic-standard SKILL.md file (YAML frontmatter + Markdown body).
 * Uses js-yaml for full YAML 1.2 compatibility including | literals, nested objects, and lists.
 */
export function parseSkillMarkdown(content: string): ParsedSkill | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;

  const frontmatter = match[1]!;
  const body = match[2]!.trim();

  let fields: Record<string, unknown>;
  try {
    fields = (yaml.load(frontmatter) as Record<string, unknown>) ?? {};
  } catch {
    return null;
  }

  const name = typeof fields['name'] === 'string' ? fields['name'].trim() : '';
  const description = typeof fields['description'] === 'string' ? fields['description'].trim() : '';
  if (!name && !description) return null;

  return {
    name,
    description,
    kind: validateKind(fields['kind']),
    version: typeof fields['version'] === 'number' ? fields['version'] : undefined,
    license: typeof fields['license'] === 'string' ? fields['license'] : undefined,
    compatibility:
      typeof fields['compatibility'] === 'string' ? fields['compatibility'] : undefined,
    model: typeof fields['model'] === 'string' ? fields['model'] : undefined,
    effort: typeof fields['effort'] === 'string' ? fields['effort'] : undefined,
    context: typeof fields['context'] === 'string' ? fields['context'] : undefined,
    agent: typeof fields['agent'] === 'string' ? fields['agent'] : undefined,
    userInvocable:
      typeof fields['user-invocable'] === 'boolean'
        ? fields['user-invocable']
        : fields['user_invocable'] !== undefined
          ? Boolean(fields['user_invocable'])
          : undefined,
    disableModelInvocation:
      typeof fields['disable-model-invocation'] === 'boolean'
        ? fields['disable-model-invocation']
        : fields['disable_model_invocation'] !== undefined
          ? Boolean(fields['disable_model_invocation'])
          : undefined,
    argumentHint:
      typeof fields['argument-hint'] === 'string'
        ? fields['argument-hint']
        : typeof fields['argument_hint'] === 'string'
          ? fields['argument_hint']
          : undefined,
    arguments:
      typeof fields['arguments'] === 'string' || Array.isArray(fields['arguments'])
        ? (fields['arguments'] as string | string[])
        : undefined,
    whenToUse:
      typeof fields['when_to_use'] === 'string'
        ? fields['when_to_use']
        : typeof fields['when-to-use'] === 'string'
          ? fields['when-to-use']
          : undefined,
    allowedTools: extractAllowedTools(fields),
    metadata: extractMetadata(fields),
    body,
  };
}

/**
 * Import a SKILL.md file and register it as a Cabinet Skill.
 * Returns the generated skill ID.
 */
export function importSkillFromMarkdown(
  content: string,
  registry: SkillRegistry,
  opts?: { referencesPath?: string; scriptsPath?: string },
): { id: string; name: string } | null {
  const parsed = parseSkillMarkdown(content);
  if (!parsed) return null;

  const id = `skill_${Date.now()}`;
  const entry: SkillEntry = {
    id,
    name: parsed.name,
    description: parsed.description,
    kind: parsed.kind ?? 'prompt',
    promptTemplate: parsed.body,
    inputSchema: {},
    outputSchema: {},
    version: parsed.version ?? 1,
    status: 'active',
    referencesPath: opts?.referencesPath,
    scriptsPath: opts?.scriptsPath,
    metadata: {
      ...(parsed.metadata ?? {}),
      license: parsed.license,
      compatibility: parsed.compatibility,
      model: parsed.model,
      effort: parsed.effort,
      context: parsed.context,
      agent: parsed.agent,
      userInvocable: parsed.userInvocable,
      argumentHint: parsed.argumentHint,
      whenToUse: parsed.whenToUse,
    },
  };

  registry.register(entry);
  return { id, name: parsed.name };
}

/**
 * Export a Cabinet Skill to SKILL.md format string.
 */
export function exportSkillToMarkdown(skill: SkillEntry): string {
  const frontmatter: Record<string, unknown> = {
    name: skill.name,
    description: skill.description,
    kind: skill.kind,
    version: skill.version,
  };
  if (skill.metadata) {
    for (const [key, value] of Object.entries(skill.metadata)) {
      if (value !== undefined && value !== null && value !== '') {
        frontmatter[key] = value;
      }
    }
  }
  const yamlStr = yaml.dump(frontmatter, { lineWidth: -1, noRefs: true }).trim();
  return `---\n${yamlStr}\n---\n\n${skill.promptTemplate}`;
}

function validateKind(v: unknown): 'tool' | 'prompt' | 'composite' | undefined {
  if (typeof v === 'string' && ['tool', 'prompt', 'composite'].includes(v)) {
    return v as 'tool' | 'prompt' | 'composite';
  }
  return undefined;
}

function extractAllowedTools(fields: Record<string, unknown>): string[] | undefined {
  const raw = fields['allowed-tools'] ?? fields['allowed_tools'];
  if (typeof raw === 'string') return raw.split(/\s+/).filter(Boolean);
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  return undefined;
}

function extractMetadata(fields: Record<string, unknown>): Record<string, unknown> {
  const known = new Set([
    'name',
    'description',
    'kind',
    'version',
    'license',
    'compatibility',
    'model',
    'effort',
    'context',
    'agent',
    'user-invocable',
    'user_invocable',
    'disable-model-invocation',
    'disable_model_invocation',
    'argument-hint',
    'argument_hint',
    'arguments',
    'when_to_use',
    'when-to-use',
    'allowed-tools',
    'allowed_tools',
  ]);
  const meta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!known.has(key) && value !== undefined && value !== null) {
      meta[key] = value;
    }
  }
  return Object.keys(meta).length > 0 ? meta : {};
}
