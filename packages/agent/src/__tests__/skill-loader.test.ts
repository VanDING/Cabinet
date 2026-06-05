import { describe, it, expect } from 'vitest';
import {
  parseSkillMarkdown,
  exportSkillToMarkdown,
  importSkillFromMarkdown,
} from '../skill-loader.js';
import { SkillRegistry } from '../skill-registry.js';

describe('parseSkillMarkdown', () => {
  it('parses a minimal valid SKILL.md', () => {
    const content = `---
name: my-skill
description: A test skill
---
This is the body content.`;

    const result = parseSkillMarkdown(content);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('my-skill');
    expect(result!.description).toBe('A test skill');
    expect(result!.body).toBe('This is the body content.');
    expect(result!.kind).toBeUndefined();
  });

  it('returns null for content without frontmatter', () => {
    const result = parseSkillMarkdown('Just some text without frontmatter.');
    expect(result).toBeNull();
  });

  it('returns null for empty content', () => {
    const result = parseSkillMarkdown('');
    expect(result).toBeNull();
  });

  it('returns null for invalid YAML frontmatter', () => {
    const content = `---
{{ invalid: yaml: syntax
---
body`;
    const result = parseSkillMarkdown(content);
    expect(result).toBeNull();
  });

  it('returns null when name and description are both missing', () => {
    const content = `---
version: 1
---
body`;
    const result = parseSkillMarkdown(content);
    expect(result).toBeNull();
  });

  it('parses kind field with valid values', () => {
    const content = `---
name: tool-skill
description: desc
kind: tool
---
body`;
    const result = parseSkillMarkdown(content);
    expect(result!.kind).toBe('tool');
  });

  it('rejects invalid kind values', () => {
    const content = `---
name: s
description: d
kind: invalid
---
body`;
    const result = parseSkillMarkdown(content);
    expect(result!.kind).toBeUndefined();
  });

  it('parses all supported metadata fields', () => {
    const content = `---
name: full-skill
description: A fully specified skill
kind: prompt
version: 2
license: MIT
compatibility: ">=1.0"
model: claude-sonnet-4-6
effort: medium
context: project
agent: builder
user-invocable: true
disable-model-invocation: false
argument-hint: "some args"
arguments:
  - arg1
  - arg2
when_to_use: When you need to build things
allowed-tools: read_file write_file
custom_meta: extra_value
---
The prompt template body.`;

    const result = parseSkillMarkdown(content);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('full-skill');
    expect(result!.version).toBe(2);
    expect(result!.license).toBe('MIT');
    expect(result!.compatibility).toBe('>=1.0');
    expect(result!.model).toBe('claude-sonnet-4-6');
    expect(result!.effort).toBe('medium');
    expect(result!.context).toBe('project');
    expect(result!.agent).toBe('builder');
    expect(result!.userInvocable).toBe(true);
    expect(result!.disableModelInvocation).toBe(false);
    expect(result!.argumentHint).toBe('some args');
    expect(result!.arguments).toEqual(['arg1', 'arg2']);
    expect(result!.whenToUse).toBe('When you need to build things');
    expect(result!.allowedTools).toEqual(['read_file', 'write_file']);
    expect(result!.metadata).toEqual({ custom_meta: 'extra_value' });
  });

  it('handles snake_case field aliases', () => {
    const content = `---
name: snake-skill
description: desc
user_invocable: false
disable_model_invocation: true
argument_hint: hint_text
---
body`;

    const result = parseSkillMarkdown(content);
    expect(result!.userInvocable).toBe(false);
    expect(result!.disableModelInvocation).toBe(true);
    expect(result!.argumentHint).toBe('hint_text');
  });
});

describe('exportSkillToMarkdown', () => {
  it('exports a skill entry to SKILL.md format', () => {
    const result = exportSkillToMarkdown({
      id: 'skill_123',
      name: 'export-test',
      description: 'Test export',
      kind: 'prompt',
      promptTemplate: 'You are a helpful assistant.',
      inputSchema: {},
      outputSchema: {},
      version: 1,
      status: 'active',
    });

    expect(result).toContain('---');
    expect(result).toContain('name: export-test');
    expect(result).toContain('description: Test export');
    expect(result).toContain('kind: prompt');
    expect(result).toContain('version: 1');
    expect(result).toContain('---');
    expect(result).toContain('You are a helpful assistant.');
  });

  it('includes metadata fields in export', () => {
    const result = exportSkillToMarkdown({
      id: 'skill_456',
      name: 'meta-test',
      description: 'With metadata',
      kind: 'tool',
      promptTemplate: 'Do the thing.',
      inputSchema: {},
      outputSchema: {},
      version: 3,
      status: 'active',
      metadata: {
        license: 'Apache-2.0',
        model: 'claude-opus-4-8',
        effort: 'high',
      },
    });

    expect(result).toContain('license: Apache-2.0');
    expect(result).toContain('model: claude-opus-4-8');
    expect(result).toContain('effort: high');
  });

  it('omits null/undefined/empty metadata values', () => {
    const result = exportSkillToMarkdown({
      id: 'skill_789',
      name: 'clean-export',
      description: 'Clean',
      kind: 'composite',
      promptTemplate: 'Composite body.',
      inputSchema: {},
      outputSchema: {},
      version: 1,
      status: 'active',
      metadata: {
        license: null,
        model: undefined,
        effort: '',
        keep: 'value',
      },
    });

    // Should keep 'keep' but skip null/undefined/empty
    expect(result).toContain('keep: value');
    // YAML dump of null → 'null', undefined is skipped
    // empty string: YAML dump of '' → "''" (empty string literal)
    // The filter checks value !== '' in the code, so effort='' is filtered
    // But license=null would have value !== null → true, so it stays
    // Actually let me check: the code does `if (value !== undefined && value !== null && value !== '')`
    // So null IS filtered, undefined IS filtered, '' IS filtered
    expect(result).not.toContain('license');
    expect(result).not.toContain('model:');
    expect(result).not.toContain('effort:');
  });
});

describe('importSkillFromMarkdown', () => {
  it('imports valid markdown into a registry', () => {
    const registry = new SkillRegistry();
    const content = `---
name: import-test
description: Imported skill
kind: prompt
---
Test body.`;

    const result = importSkillFromMarkdown(content, registry);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('import-test');
    expect(result!.id).toMatch(/^skill_\d+$/);
  });

  it('returns null for invalid markdown', () => {
    const registry = new SkillRegistry();
    const result = importSkillFromMarkdown('not valid markdown', registry);
    expect(result).toBeNull();
  });

  it('stores referencesPath and scriptsPath when provided', () => {
    const registry = new SkillRegistry();
    // Spy on register to verify it's called with the right paths
    const origRegister = registry.register.bind(registry);
    let capturedEntry: any = null;
    registry.register = (entry) => {
      capturedEntry = entry;
      return origRegister(entry);
    };

    const content = `---
name: ref-test
description: With references
---
body`;

    const result = importSkillFromMarkdown(content, registry, {
      referencesPath: '/refs/skill-refs.md',
      scriptsPath: '/scripts/skill-scripts/',
    });
    expect(result).not.toBeNull();
    expect(capturedEntry).not.toBeNull();
    expect(capturedEntry.referencesPath).toBe('/refs/skill-refs.md');
    expect(capturedEntry.scriptsPath).toBe('/scripts/skill-scripts/');
  });
});
