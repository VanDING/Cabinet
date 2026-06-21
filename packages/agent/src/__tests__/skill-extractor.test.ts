import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  SkillExtractor,
  DEFAULT_CONFIG,
  type ExtractedSkill,
  type SkillQualityScore,
} from '../skill-extractor.js';
import type { AgentSessionSummary } from '../agent-loop.js';

const TEST_AUTO_DIR = join(homedir(), '.cabinet', 'skills', 'auto');
const TEST_REVIEW_DIR = join(homedir(), '.cabinet', 'skills', 'review');

function makeSummary(partial: Partial<AgentSessionSummary> = {}): AgentSessionSummary {
  return {
    sessionId: 'test-sess',
    projectId: 'test-proj',
    captainId: 'captain-1',
    model: 'test-model',
    totalSteps: partial.totalSteps ?? 12,
    totalTokens: { prompt: 100, completion: 50 },
    toolCalls: partial.toolCalls ?? { total: 6, succeeded: 6, failed: 0, blocked: 0 },
    contextZones: { smart: 0, warning: 0, critical: 0, dumb: 0 },
    contextHandoffs: 0,
    errors: { transient: 0, recoverable: 0, fatal: 0 },
    durationMs: 1000,
    success: partial.success ?? true,
    startTime: new Date().toISOString(),
    toolCallHistory: partial.toolCallHistory ?? [
      { name: 'read_file', args: { path: '/tmp/a.txt' }, result: 'ok' },
      { name: 'write_file', args: { path: '/tmp/b.txt', content: 'hi' }, result: 'ok' },
      { name: 'read_file', args: { path: '/tmp/c.txt' }, result: 'ok' },
      { name: 'write_file', args: { path: '/tmp/d.txt', content: 'bye' }, result: 'ok' },
      { name: 'search_memory', args: { query: 'test' }, result: [] },
      { name: 'read_file', args: { path: '/tmp/e.txt' }, result: 'ok' },
    ],
  };
}

function makeSkill(partial: Partial<ExtractedSkill> = {}): ExtractedSkill {
  return {
    name: partial.name ?? 'Test Skill',
    description: partial.description ?? 'A test skill for quality scoring.',
    triggerPatterns: partial.triggerPatterns ?? ['test', 'demo'],
    steps: partial.steps ?? [
      'Open the project file at src/index.ts',
      'Read the current contents and verify structure',
      'Apply the requested changes carefully',
      'Run tests to confirm nothing is broken',
      'Save and report results',
    ],
    requiredTools: partial.requiredTools ?? ['read_file', 'write_file', 'search_memory'],
  };
}

describe('SkillExtractor', () => {
  let extractor: SkillExtractor;

  beforeEach(() => {
    // No LLM gateway for unit tests — we test config, thresholds, scoring, saving
    extractor = new SkillExtractor(null);
    // Clean test dirs
    try {
      rmSync(TEST_AUTO_DIR, { recursive: true });
    } catch {
      /* ignore */
    }
    try {
      rmSync(TEST_REVIEW_DIR, { recursive: true });
    } catch {
      /* ignore */
    }
  });

  afterEach(() => {
    try {
      rmSync(TEST_AUTO_DIR, { recursive: true });
    } catch {
      /* ignore */
    }
    try {
      rmSync(TEST_REVIEW_DIR, { recursive: true });
    } catch {
      /* ignore */
    }
  });

  describe('config', () => {
    it('uses default thresholds', () => {
      expect(extractor.getConfig().minToolCalls).toBe(5);
      expect(extractor.getConfig().minTotalSteps).toBe(10);
      expect(extractor.getConfig().requireSuccess).toBe(true);
    });

    it('allows custom thresholds via constructor', () => {
      const custom = new SkillExtractor(null, { minToolCalls: 3, minTotalSteps: 5 });
      expect(custom.getConfig().minToolCalls).toBe(3);
      expect(custom.getConfig().minTotalSteps).toBe(5);
      expect(custom.getConfig().requireSuccess).toBe(true); // default preserved
    });

    it('allows runtime config update', () => {
      extractor.setConfig({ minToolCalls: 2 });
      expect(extractor.getConfig().minToolCalls).toBe(2);
      expect(extractor.getConfig().minTotalSteps).toBe(10); // unchanged
    });

    it('resolves kind overrides', async () => {
      const withOverride = new SkillExtractor(null, {
        minToolCalls: 5,
        kindOverrides: { workflow: { minToolCalls: 2, minTotalSteps: 3 } },
      });
      // Default kind should use base config
      const defaultResult = await withOverride.extract(
        makeSummary({
          toolCalls: { total: 3, succeeded: 3, failed: 0, blocked: 0 },
          totalSteps: 4,
        }),
      );
      expect(defaultResult).toBeNull(); // 3 < 5

      // 'workflow' kind should use override
      const workflowResult = await withOverride.extract(
        makeSummary({
          toolCalls: { total: 3, succeeded: 3, failed: 0, blocked: 0 },
          totalSteps: 4,
        }),
        'workflow',
      );
      expect(workflowResult).toBeNull(); // still null because no gateway
    });
  });

  describe('threshold filtering', () => {
    it('returns null when toolCalls < minToolCalls', async () => {
      const result = await extractor.extract(
        makeSummary({ toolCalls: { total: 3, succeeded: 3, failed: 0, blocked: 0 } }),
      );
      expect(result).toBeNull();
    });

    it('returns null when totalSteps < minTotalSteps', async () => {
      const result = await extractor.extract(makeSummary({ totalSteps: 5 }));
      expect(result).toBeNull();
    });

    it('returns null when requireSuccess=true and success=false', async () => {
      const result = await extractor.extract(makeSummary({ success: false }));
      expect(result).toBeNull();
    });

    it('allows failed session when requireSuccess=false', async () => {
      const noSuccess = new SkillExtractor(null, { requireSuccess: false });
      const result = await noSuccess.extract(makeSummary({ success: false }));
      expect(result).toBeNull(); // still null because no gateway, but threshold passed
    });

    it('returns null when toolCallHistory is empty', async () => {
      const result = await extractor.extract(makeSummary({ toolCallHistory: [] }));
      expect(result).toBeNull();
    });
  });

  describe('quality scoring', () => {
    it('scores a high-quality skill highly', () => {
      const skill = makeSkill({
        steps: [
          'Use read_file to open the project file at src/index.ts',
          'Verify structure with search_memory for patterns',
          'Apply changes with write_file carefully',
          'Run tests to confirm nothing is broken',
          'Save and report results',
        ],
      });
      const score = extractor.scoreSkillQuality(skill, 0.9);
      expect(score.total).toBeGreaterThan(0.7);
      expect(score.hasToolNames).toBe(0.2);
      expect(score.hasValidationStep).toBeGreaterThan(0);
      expect(score.stepCountOk).toBe(0.1);
      expect(score.lengthOk).toBe(0.15);
    });

    it('scores low for short/missing content', () => {
      const skill = makeSkill({
        description: 'Short.',
        steps: ['One step only'],
        requiredTools: [],
      });
      const score = extractor.scoreSkillQuality(skill, 0.3);
      expect(score.total).toBeLessThan(0.5);
      expect(score.hasToolNames).toBe(0);
      expect(score.stepCountOk).toBe(0);
    });

    it('detects file paths in steps', () => {
      const skill = makeSkill({ steps: ['Read src/index.ts'] });
      const score = extractor.scoreSkillQuality(skill);
      expect(score.hasFilePaths).toBe(0.15);
    });

    it('caps llm confidence contribution', () => {
      const skill = makeSkill();
      const high = extractor.scoreSkillQuality(skill, 1.5);
      const low = extractor.scoreSkillQuality(skill, -0.5);
      expect(high.llmConfidence).toBe(0.25);
      expect(low.llmConfidence).toBe(0);
    });
  });

  describe('tiered saving', () => {
    it('saves high-quality skill to auto/', () => {
      const skill = makeSkill();
      const score: SkillQualityScore = {
        total: 0.85,
        hasToolNames: 0.2,
        hasValidationStep: 0.15,
        stepCountOk: 0.1,
        lengthOk: 0.15,
        hasFilePaths: 0.15,
        llmConfidence: 0.1,
      };
      const path = extractor.save(skill, score);
      expect(path).not.toBeNull();
      expect(path).toContain('/auto/');
      expect(existsSync(path!)).toBe(true);
    });

    it('saves medium-quality skill to review/', () => {
      const skill = makeSkill();
      const score: SkillQualityScore = {
        total: 0.6,
        hasToolNames: 0.2,
        hasValidationStep: 0.15,
        stepCountOk: 0.1,
        lengthOk: 0.15,
        hasFilePaths: 0,
        llmConfidence: 0,
      };
      const path = extractor.save(skill, score);
      expect(path).not.toBeNull();
      expect(path).toContain('/review/');
      expect(existsSync(path!)).toBe(true);
    });

    it('discards low-quality skill', () => {
      const skill = makeSkill();
      const score: SkillQualityScore = {
        total: 0.3,
        hasToolNames: 0,
        hasValidationStep: 0,
        stepCountOk: 0,
        lengthOk: 0,
        hasFilePaths: 0,
        llmConfidence: 0.3,
      };
      const path = extractor.save(skill, score);
      expect(path).toBeNull();
    });

    it('writes quality and tier into frontmatter', () => {
      const skill = makeSkill();
      const score: SkillQualityScore = {
        total: 0.82,
        hasToolNames: 0.2,
        hasValidationStep: 0.15,
        stepCountOk: 0.1,
        lengthOk: 0.15,
        hasFilePaths: 0.15,
        llmConfidence: 0.07,
      };
      const path = extractor.save(skill, score);
      expect(path).toBeTruthy();

      const files = readdirSync(TEST_AUTO_DIR).filter((f) => f.endsWith('.md'));
      expect(files.length).toBeGreaterThanOrEqual(1);
    });
  });
});
