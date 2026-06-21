import { describe, it, expect } from 'vitest';
import { assemblePrompt } from '../prompt-assembler.js';
import { ToolExecutor } from '../tool-executor.js';

describe('assemblePrompt', () => {
  function makeExecutor(tools: { name: string; description: string }[]) {
    const ex = new ToolExecutor();
    for (const t of tools) {
      ex.register({ name: t.name, description: t.description, execute: async () => null });
    }
    return ex;
  }

  it('includes shared rules, identity, and tools', () => {
    const result = assemblePrompt({
      modules: { identity: 'You are a test agent.' },
      toolExecutor: makeExecutor([
        { name: 'read', description: 'Read a file' },
        { name: 'write', description: 'Write a file' },
      ]),
    });

    expect(result).toContain('Hard Constraints');
    expect(result).toContain('You are a test agent.');
    expect(result).toContain('## Available Tools');
    expect(result).toContain('- read: Read a file');
    expect(result).toContain('- write: Write a file');
  });

  it('includes optional workflow section', () => {
    const result = assemblePrompt({
      modules: {
        identity: 'You are a test agent.',
        workflow: '## Routing\nRoute to X for Y.',
      },
      toolExecutor: makeExecutor([]),
    });

    expect(result).toContain('## Routing');
    expect(result).toContain('Route to X for Y.');
  });

  it('includes dynamic context when provided', () => {
    const result = assemblePrompt({
      modules: { identity: 'Test.' },
      toolExecutor: makeExecutor([]),
      dynamicContext: 'Project: Alpha\nCaptain: dotty',
    });

    expect(result).toContain('Project: Alpha');
    expect(result).toContain('Captain: dotty');
  });

  it('module order: shared → identity → tools → workflow → context', () => {
    const result = assemblePrompt({
      modules: {
        identity: 'IDENTITY_MARKER',
        workflow: 'WORKFLOW_MARKER',
      },
      toolExecutor: makeExecutor([{ name: 'test', description: 'Test tool' }]),
      dynamicContext: 'CONTEXT_MARKER',
    });

    const idxShared = result.indexOf('Hard Constraints');
    const idxIdentity = result.indexOf('IDENTITY_MARKER');
    const idxTools = result.indexOf('## Available Tools');
    const idxWorkflow = result.indexOf('WORKFLOW_MARKER');
    const idxContext = result.indexOf('CONTEXT_MARKER');

    expect(idxShared).toBeLessThan(idxIdentity);
    expect(idxIdentity).toBeLessThan(idxTools);
    expect(idxTools).toBeLessThan(idxWorkflow);
    expect(idxWorkflow).toBeLessThan(idxContext);
  });

  it('does not include workflow or context when absent', () => {
    const result = assemblePrompt({
      modules: { identity: 'Test.' },
      toolExecutor: makeExecutor([]),
    });

    expect(result).not.toMatch(/WORKFLOW_MARKER/);
    expect(result).not.toMatch(/CONTEXT_MARKER/);
  });
});
