import { describe, it, expect } from 'vitest';
import { PolicyEngine } from '../policy-engine.js';

describe('PolicyEngine', () => {
  describe('evaluateAdjustment', () => {
    it('allows critical notifications', () => {
      const engine = new PolicyEngine();
      const action = {
        type: 'notify_captain' as const,
        severity: 'critical' as const,
        description: 'test',
        details: {},
        requiresCaptainApproval: false,
        applied: true,
        timestamp: new Date().toISOString(),
      };
      expect(engine.evaluateAdjustment(action)).toEqual(action);
    });

    it('blocks L3-equivalent auto-approved actions', () => {
      const engine = new PolicyEngine();
      const action = {
        type: 'trigger_reconsolidation' as const,
        severity: 'warning' as const,
        description: 'test',
        details: {},
        requiresCaptainApproval: false,
        applied: true,
        timestamp: new Date().toISOString(),
      };
      expect(engine.evaluateAdjustment(action)).toBeNull();
    });

    it('blocks model_swap when budget is critical', () => {
      const engine = new PolicyEngine();
      const action = {
        type: 'model_swap' as const,
        severity: 'warning' as const,
        description: 'test',
        details: { budgetUsage: 0.95 },
        requiresCaptainApproval: false,
        applied: true,
        timestamp: new Date().toISOString(),
      };
      expect(engine.evaluateAdjustment(action)).toBeNull();
    });

    it('allows model_swap when budget is healthy', () => {
      const engine = new PolicyEngine();
      const action = {
        type: 'model_swap' as const,
        severity: 'info' as const,
        description: 'test',
        details: { budgetUsage: 0.5 },
        requiresCaptainApproval: false,
        applied: true,
        timestamp: new Date().toISOString(),
      };
      expect(engine.evaluateAdjustment(action)).toEqual(action);
    });

    it('blocks external agent elevated actions', () => {
      const engine = new PolicyEngine();
      const action = {
        type: 'context_budget_reduce' as const,
        severity: 'warning' as const,
        description: 'test',
        details: { agentType: 'external_cli' },
        requiresCaptainApproval: false,
        applied: true,
        timestamp: new Date().toISOString(),
      };
      expect(engine.evaluateAdjustment(action)).toBeNull();
    });

    it('unsets applied for significant actions without reasoning', () => {
      const engine = new PolicyEngine();
      const action = {
        type: 'temperature_adjust' as const,
        severity: 'warning' as const,
        description: 'test',
        details: {},
        requiresCaptainApproval: false,
        applied: true,
        timestamp: new Date().toISOString(),
      };
      const result = engine.evaluateAdjustment(action);
      expect(result).not.toBeNull();
      expect(result!.applied).toBe(false);
    });
  });

  describe('arbitrate', () => {
    it('s4 wins when relevance is high and quality_first applies', () => {
      const engine = new PolicyEngine();
      const s3Action = {
        type: 'context_budget_reduce' as const,
        severity: 'warning' as const,
        description: 'Reduce budget',
        details: {},
        requiresCaptainApproval: false,
        applied: false,
        timestamp: new Date().toISOString(),
      };
      const s4Insight = { relevance: 0.9, text: 'Deeper analysis needed' };
      const result = engine.arbitrate(s3Action, s4Insight);
      expect(result.resolution).toBe('s4_wins');
    });

    it('s3 wins when action is strong and s4 is weak', () => {
      const engine = new PolicyEngine();
      const s3Action = {
        type: 'context_budget_reduce' as const,
        severity: 'critical' as const,
        description: 'Critical budget cut needed',
        details: {},
        requiresCaptainApproval: false,
        applied: false,
        timestamp: new Date().toISOString(),
      };
      const s4Insight = { relevance: 0.2, text: 'Minor observation' };
      const result = engine.arbitrate(s3Action, s4Insight);
      expect(result.resolution).toBe('s3_wins');
    });

    it('compromise when scores are close', () => {
      const engine = new PolicyEngine();
      const s3Action = {
        type: 'temperature_adjust' as const,
        severity: 'warning' as const,
        description: 'Minor adjustment',
        details: {},
        requiresCaptainApproval: false,
        applied: false,
        timestamp: new Date().toISOString(),
      };
      const s4Insight = { relevance: 0.3, text: 'Moderate insight' };
      const result = engine.arbitrate(s3Action, s4Insight);
      expect(result.resolution).toBe('compromise');
    });

    it('respects s3_favors profile bias', () => {
      const engine = new PolicyEngine(undefined, { conflictResolution: 's3_favors' });
      const s3Action = {
        type: 'context_budget_reduce' as const,
        severity: 'warning' as const,
        description: 'Reduce budget',
        details: {},
        requiresCaptainApproval: false,
        applied: false,
        timestamp: new Date().toISOString(),
      };
      const s4Insight = { relevance: 0.85, text: 'Deeper analysis needed' };
      const result = engine.arbitrate(s3Action, s4Insight);
      // With s3_favors bias, even high-relevance s4 may not win
      expect(['s3_wins', 'compromise']).toContain(result.resolution);
    });
  });

  describe('checkDecision', () => {
    it('blocks L3 auto-approved decisions', () => {
      const engine = new PolicyEngine();
      const decision = {
        id: 'd1',
        projectId: 'p1',
        type: 'general' as const,
        level: 'L3' as const,
        status: 'approved' as const,
        title: 'test',
        description: 'test',
        options: [],
        createdAt: new Date(),
        captainId: 'system',
      };
      const result = engine.checkDecision(decision as any);
      expect(result.allowed).toBe(false);
    });

    it('allows L1 auto-approved decisions', () => {
      const engine = new PolicyEngine();
      const decision = {
        id: 'd1',
        projectId: 'p1',
        type: 'general' as const,
        level: 'L1' as const,
        status: 'approved' as const,
        title: 'test',
        description: 'test',
        options: [],
        createdAt: new Date(),
        captainId: 'system',
      };
      const result = engine.checkDecision(decision as any);
      expect(result.allowed).toBe(true);
    });
  });

  describe('MissionProfile', () => {
    it('defaults to medium for all fields', () => {
      const engine = new PolicyEngine();
      expect(engine.getProfile()).toEqual({
        riskTolerance: 'medium',
        costSensitivity: 'medium',
        conflictResolution: 'balance',
      });
    });

    it('accepts partial profile updates', () => {
      const engine = new PolicyEngine();
      engine.setProfile({ riskTolerance: 'high' });
      expect(engine.getProfile().riskTolerance).toBe('high');
      expect(engine.getProfile().costSensitivity).toBe('medium');
    });
  });
});
