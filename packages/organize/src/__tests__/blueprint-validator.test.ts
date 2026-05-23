import { describe, it, expect } from 'vitest';
import { validateBlueprint, detectCircularDependencies } from '../blueprint-validator.js';
import type { Blueprint, BlueprintAgent, BlueprintWorkflowStep } from '@cabinet/types';

describe('validateBlueprint', () => {
  it('passes a valid complete blueprint', () => {
    const bp: Blueprint = {
      meta: { goal: 'Test goal' },
      agents: [
        { action: 'use_existing', name: 'secretary' },
        { action: 'create_new', name: 'NewAgent', prompt: 'Do work' },
      ],
      workflow: {
        steps: [
          { id: 's1', type: 'aiAgent', agent: 'secretary', input: { from: 'trigger' } },
          { id: 's2', type: 'humanApproval', agent: 'captain', input: { from: 's1' } },
        ],
      },
      authorization: {
        rules: [{ node_id: 's2', level: 'L2', description: 'Captain approval needed' }],
      },
      harness: { gates: [{ node_id: 's1', criteria: 'Pass' }] },
    };
    const result = validateBlueprint(bp, new Set(['secretary']));
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('detects missing agent (use_existing not in registry)', () => {
    const bp: Blueprint = {
      agents: [{ action: 'use_existing', name: 'GhostAgent' }],
      workflow: { steps: [] },
    };
    const result = validateBlueprint(bp);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.type === 'missing_agent')).toBe(true);
  });

  it('newly created agents satisfy use_existing references', () => {
    const bp: Blueprint = {
      agents: [
        { action: 'create_new', name: 'CreatedAgent' },
        { action: 'use_existing', name: 'CreatedAgent' },
      ],
      workflow: { steps: [] },
    };
    const result = validateBlueprint(bp);
    expect(result.issues.filter((i) => i.type === 'missing_agent')).toHaveLength(0);
  });

  it('detects missing step input reference', () => {
    const bp: Blueprint = {
      workflow: {
        steps: [{ id: 's1', input: { from: 'nonexistent' } }],
      },
    };
    const result = validateBlueprint(bp);
    expect(result.issues.some((i) => i.type === 'missing_step')).toBe(true);
  });

  it('detects invalid condition trueBranch', () => {
    const bp: Blueprint = {
      workflow: {
        steps: [{
          id: 's1',
          condition: { trueBranch: 'ghost', falseBranch: 'also_ghost', expression: 'true' },
        }],
      },
    };
    const result = validateBlueprint(bp);
    expect(result.issues.filter((i) => i.type === 'invalid_branch')).toHaveLength(2);
  });

  it('detects missing authorization for humanApproval without default', () => {
    const bp: Blueprint = {
      workflow: {
        steps: [
          { id: 's1', type: 'humanApproval' },
        ],
      },
    };
    const result = validateBlueprint(bp);
    expect(result.issues.some((i) => i.type === 'missing_auth')).toBe(true);
  });

  it('default authorization rule covers all humanApproval steps', () => {
    const bp: Blueprint = {
      workflow: {
        steps: [
          { id: 's1', type: 'humanApproval' },
        ],
      },
      authorization: {
        rules: [{ default: 'L2', description: 'Default auth' }],
      },
    };
    const result = validateBlueprint(bp);
    expect(result.issues.filter((i) => i.type === 'missing_auth')).toHaveLength(0);
  });

  it('detects invalid harness gate reference', () => {
    const bp: Blueprint = {
      workflow: { steps: [{ id: 's1' }] },
      harness: { gates: [{ node_id: 'ghost_gate', criteria: 'Pass' }] },
    };
    const result = validateBlueprint(bp);
    expect(result.issues.some((i) => i.type === 'invalid_gate')).toBe(true);
  });

  it('detects parallel children pointing to missing steps', () => {
    const bp: Blueprint = {
      workflow: {
        steps: [{ id: 's1', children: ['ghost_child'] }],
      },
    };
    const result = validateBlueprint(bp);
    expect(result.issues.some((i) => i.type === 'missing_step')).toBe(true);
  });

  it('empty blueprint is valid', () => {
    const result = validateBlueprint({});
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('detects circular dependency', () => {
    const bp: Blueprint = {
      workflow: {
        steps: [
          { id: 'a', input: { from: 'c' } },
          { id: 'b', input: { from: 'a' } },
          { id: 'c', input: { from: 'b' } },
        ],
      },
    };
    const result = validateBlueprint(bp);
    expect(result.issues.some((i) => i.type === 'circular_dependency')).toBe(true);
  });
});

describe('detectCircularDependencies', () => {
  it('returns empty for acyclic graph', () => {
    const steps: BlueprintWorkflowStep[] = [
      { id: 'a', input: { from: 'b' } },
      { id: 'b' },
    ];
    expect(detectCircularDependencies(steps)).toHaveLength(0);
  });

  it('detects simple cycle', () => {
    const steps: BlueprintWorkflowStep[] = [
      { id: 'a', input: { from: 'b' } },
      { id: 'b', input: { from: 'a' } },
    ];
    const cycles = detectCircularDependencies(steps);
    expect(cycles.length).toBeGreaterThan(0);
  });
});
