import { describe, it, expect } from 'vitest';
import { SafetyChecker } from '../safety.js';
import { DelegationTier } from '@cabinet/types';

describe('SafetyChecker MCP risk resolver', () => {
  it('blocks destructive MCP tools at T0 and T1', () => {
    const checker = new SafetyChecker(DelegationTier.CaptainReview); // T0
    checker.setMcpRiskResolver(() => 'destructive');

    const result = checker.check('mcp__delete_something', {});
    expect(result.allowed).toBe(false);
    expect(result.tier).toBe('delegation_block');
  });

  it('blocks mutation MCP tools at T0', () => {
    const checker = new SafetyChecker(DelegationTier.CaptainReview); // T0
    checker.setMcpRiskResolver(() => 'mutation');

    const result = checker.check('mcp__write_something', {});
    expect(result.allowed).toBe(false);
  });

  it('allows readonly MCP tools at T0', () => {
    const checker = new SafetyChecker(DelegationTier.CaptainReview); // T0
    checker.setMcpRiskResolver(() => 'readonly');

    const result = checker.check('mcp__read_something', {});
    expect(result.allowed).toBe(true);
  });

  it('allows destructive MCP tools at T3', () => {
    const checker = new SafetyChecker(DelegationTier.FullAutonomy); // T3
    checker.setMcpRiskResolver(() => 'destructive');

    const result = checker.check('mcp__delete_something', {});
    expect(result.allowed).toBe(true);
  });

  it('falls back to moderate for unannotated MCP tools', () => {
    const checker = new SafetyChecker(DelegationTier.CaptainReview); // T0
    checker.setMcpRiskResolver(() => undefined);

    const result = checker.check('mcp__unknown', {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('MCP');
  });
});
