import { SkillRegistry, type SkillEntry } from './skill-registry.js';

/** Parsed SKILL.md content. */
export interface ParsedSkill {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string[];
  body: string;
}

/**
 * Parse an Anthropic-standard SKILL.md file (YAML frontmatter + Markdown body).
 * https://github.com/anthropics/skills
 */
export function parseSkillMarkdown(content: string): ParsedSkill | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;

  const frontmatter = match[1]!;
  const body = match[2]!.trim();

  const fields = parseYamlFrontmatter(frontmatter);

  const name = fields['name'] ?? '';
  const description = fields['description'] ?? '';
  if (!name || !description) return null;

  return {
    name,
    description,
    license: fields['license'],
    compatibility: fields['compatibility'],
    metadata: fields['metadata'] ? parseSubFields(fields['metadata']!) : undefined,
    allowedTools: fields['allowed-tools']
      ? fields['allowed-tools']!.split(/\s+/).filter(Boolean)
      : undefined,
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
): { id: string; name: string } | null {
  const parsed = parseSkillMarkdown(content);
  if (!parsed) return null;

  const id = `skill_${Date.now()}`;
  const entry: SkillEntry = {
    id,
    name: parsed.name,
    description: parsed.description,
    kind: 'prompt',
    promptTemplate: parsed.body,
    inputSchema: {},
    outputSchema: {},
    version: 1,
    status: 'active',
  };

  registry.register(entry);
  return { id, name: parsed.name };
}

/**
 * Export a Cabinet Skill to SKILL.md format string.
 */
export function exportSkillToMarkdown(skill: SkillEntry): string {
  const lines: string[] = ['---'];
  lines.push(`name: ${skill.name}`);
  lines.push(`description: ${skill.description}`);
  lines.push('---');
  lines.push('');
  lines.push(skill.promptTemplate);
  return lines.join('\n');
}

/** Minimal YAML frontmatter parser (no external dependency). */
function parseYamlFrontmatter(yaml: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = yaml.split('\n');
  let currentKey = '';
  let currentValue = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx !== -1 && !trimmed.startsWith(' ') && !trimmed.startsWith('\t')) {
      // New key
      if (currentKey) {
        result[currentKey] = currentValue.trim();
      }
      currentKey = trimmed.slice(0, colonIdx).trim();
      currentValue = trimmed.slice(colonIdx + 1).trim();
    } else if (currentKey) {
      // Continuation of previous value
      currentValue += '\n' + trimmed;
    }
  }
  if (currentKey) {
    result[currentKey] = currentValue.trim();
  }
  return result;
}

function parseSubFields(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pairs = value.split(',').map((s) => s.trim());
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq !== -1) {
      result[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
    }
  }
  return result;
}
