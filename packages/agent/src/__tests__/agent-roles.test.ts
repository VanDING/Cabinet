import { describe, it, expect } from 'vitest';
import { AgentRoleRegistry } from '../agent-roles.js';

describe('AgentRoleRegistry.registerExternalAgent', () => {
  it('registers a CLI agent', () => {
    const registry = new AgentRoleRegistry();
    const result = registry.registerExternalAgent({
      protocol: 'cli',
      name: 'external_cli:claude',
      description: 'Claude Code CLI agent',
      identity: 'You are Claude Code.',
      command: 'claude',
      args: ['--print'],
    });
    expect(result).toBe(true);
    const role = registry.get('external_cli:claude');
    expect(role).toBeDefined();
    expect(role!.external).toBeDefined();
    expect(role!.external!.protocol).toBe('cli');
    expect(role!.external!.command).toBe('claude');
  });

  it('upserts existing agent with latest external config', () => {
    const registry = new AgentRoleRegistry();

    registry.registerExternalAgent({
      protocol: 'cli',
      name: 'external_cli:claude',
      description: 'Claude Code CLI agent',
      identity: 'You are Claude Code.',
      command: 'claude',
      args: ['--print'],
    });

    const result = registry.registerExternalAgent({
      protocol: 'cli',
      name: 'external_cli:claude',
      description: 'Claude Code CLI agent',
      identity: 'You are Claude Code.',
      command: 'claude',
      args: ['--print', '--verbose'],
    });

    expect(result).toBe(true);
    const role = registry.get('external_cli:claude');
    expect(role!.external!.args).toContain('--verbose');
  });

  it('registers an A2A agent', () => {
    const registry = new AgentRoleRegistry();
    const result = registry.registerExternalAgent({
      protocol: 'a2a',
      name: 'external_a2a:my-agent',
      description: 'Test A2A agent',
      identity: 'You are a test agent.',
      baseUrl: 'http://localhost:4000',
    });
    expect(result).toBe(true);
    const role = registry.get('external_a2a:my-agent');
    expect(role!.external!.protocol).toBe('a2a');
    expect(role!.external!.baseUrl).toBe('http://localhost:4000');
  });
});
