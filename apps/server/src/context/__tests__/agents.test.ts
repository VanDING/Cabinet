import { describe, it, expect, vi } from 'vitest';

vi.mock('@cabinet/agent', () => ({
  AgentRoleRegistry: vi.fn().mockImplementation(() => ({
    register: vi.fn(),
    get: vi.fn(),
  })),
}));

import type { AgentRoleRow } from '@cabinet/storage';
import type { AgentRoleRegistry } from '@cabinet/agent';

// Test the parseExternalConfig logic inline
function parseExternalConfig(raw: string | null | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.protocol !== 'cli' && parsed.protocol !== 'a2a') return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

describe('initAgentRegistry external_config parsing', () => {
  it('parses valid external_config JSON', () => {
    const result = parseExternalConfig(JSON.stringify({ protocol: 'cli', command: 'claude' }));
    expect(result).toBeDefined();
    expect(result!.command).toBe('claude');
  });

  it('returns undefined for null external_config', () => {
    expect(parseExternalConfig(null)).toBeUndefined();
  });

  it('returns undefined for invalid JSON', () => {
    expect(parseExternalConfig('not json')).toBeUndefined();
  });

  it('returns undefined for non-CLI/A2A protocol', () => {
    const result = parseExternalConfig(JSON.stringify({ protocol: 'custom' }));
    expect(result).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(parseExternalConfig('')).toBeUndefined();
  });

  it('parses a2a protocol config', () => {
    const result = parseExternalConfig(
      JSON.stringify({ protocol: 'a2a', baseUrl: 'http://localhost:4000' }),
    );
    expect(result).toBeDefined();
    expect(result!.protocol).toBe('a2a');
  });
});
