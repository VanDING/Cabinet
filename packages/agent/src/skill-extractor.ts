import { join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import type { LLMGateway } from '@cabinet/gateway';
import type { AgentSessionSummary } from './agent-loop.js';

export interface ExtractedSkill {
  name: string;
  description: string;
  triggerPatterns: string[];
  steps: string[];
  requiredTools: string[];
}

/** Quality score breakdown for an extracted skill. */
export interface SkillQualityScore {
  total: number;
  hasToolNames: number;
  hasValidationStep: number;
  stepCountOk: number;
  lengthOk: number;
  hasFilePaths: number;
  llmConfidence: number;
}

/** Configuration for skill extraction thresholds and quality gates. */
export interface SkillExtractorConfig {
  minToolCalls: number;
  minTotalSteps: number;
  requireSuccess: boolean;
  minContentLength: number;
  /** Per-kind overrides. Key is skill kind (e.g. 'workflow'). */
  kindOverrides?: Record<string, Partial<SkillExtractorConfig>>;
  /** Quality score thresholds for tiered save behaviour. */
  qualityThresholds?: {
    auto: number; // score >= this → save to auto/
    review: number; // score >= this → save to review/
    // score < review → discard
  };
}

export const DEFAULT_CONFIG: SkillExtractorConfig = {
  minToolCalls: 5,
  minTotalSteps: 10,
  requireSuccess: true,
  minContentLength: 100,
  qualityThresholds: {
    auto: 0.8,
    review: 0.5,
  },
};

const AUTO_SKILL_DIR = join(homedir(), '.cabinet', 'skills', 'auto');
const REVIEW_SKILL_DIR = join(homedir(), '.cabinet', 'skills', 'review');

function resolveConfig(config: SkillExtractorConfig, kind?: string): SkillExtractorConfig {
  const base = { ...config };
  if (kind && config.kindOverrides?.[kind]) {
    const override = config.kindOverrides[kind]!;
    return {
      ...base,
      ...override,
      qualityThresholds: override.qualityThresholds ?? base.qualityThresholds,
    };
  }
  return base;
}

/**
 * Automatically extracts reusable skills from successful agent sessions.
 *
 * Trigger: configurable thresholds (default toolCalls >= 5 && success && totalSteps >= 10)
 */
export class SkillExtractor {
  private config: SkillExtractorConfig;

  constructor(
    private readonly gateway: LLMGateway | null,
    config?: Partial<SkillExtractorConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Update configuration at runtime. */
  setConfig(patch: Partial<SkillExtractorConfig>): void {
    this.config = { ...this.config, ...patch };
  }

  getConfig(): SkillExtractorConfig {
    return { ...this.config };
  }

  async extract(summary: AgentSessionSummary, kind?: string): Promise<ExtractedSkill | null> {
    if (!this.gateway) return null;

    const cfg = resolveConfig(this.config, kind);

    if (
      summary.toolCalls.total < cfg.minToolCalls ||
      (cfg.requireSuccess && !summary.success) ||
      summary.totalSteps < cfg.minTotalSteps
    ) {
      return null;
    }

    const history = summary.toolCallHistory ?? [];
    if (history.length === 0) return null;

    const uniqueTools = [...new Set(history.map((tc) => tc.name))];

    const prompt = [
      'Analyze the following agent execution and extract a reusable skill workflow.',
      '',
      'Task outcome:',
      `Success: ${summary.success}`,
      `Steps: ${summary.totalSteps}`,
      `Tools used: ${uniqueTools.join(', ')}`,
      '',
      'Tool call sequence:',
      ...history.map((tc, i) => `${i + 1}. ${tc.name}(${JSON.stringify(tc.args)})`),
      '',
      'Respond with ONLY a JSON object:',
      '{',
      '  "name": "Short descriptive name",',
      '  "description": "What this skill does in one sentence",',
      '  "triggerPatterns": ["pattern1", "pattern2"],',
      '  "steps": ["step 1", "step 2", "step 3"],',
      '  "requiredTools": ["tool1", "tool2"],',
      '  "confidence": 0.85',
      '}',
    ].join('\n');

    try {
      const response = await this.gateway.generateText({
        model: 'claude-haiku-4-5',
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 400,
        temperature: 0.2,
      });
      const match = response.content.match(/\{[\s\S]*\}/);
      if (!match) return null;
      const parsed = JSON.parse(match[0]);
      return {
        name: String(parsed.name ?? 'Untitled Skill'),
        description: String(parsed.description ?? ''),
        triggerPatterns: Array.isArray(parsed.triggerPatterns)
          ? parsed.triggerPatterns.map(String)
          : [],
        steps: Array.isArray(parsed.steps) ? parsed.steps.map(String) : [],
        requiredTools: Array.isArray(parsed.requiredTools)
          ? parsed.requiredTools.map(String)
          : uniqueTools,
      };
    } catch {
      return null;
    }
  }

  /**
   * Compute a quality score for an extracted skill.
   * Returns a number 0–1 and a breakdown.
   */
  scoreSkillQuality(skill: ExtractedSkill, llmConfidence = 0.5): SkillQualityScore {
    const stepsLower = skill.steps.map((s) => s.toLowerCase());
    const fullText = `${skill.name} ${skill.description} ${stepsLower.join(' ')}`;

    // Steps contain specific tool call names? (+20%)
    const hasToolNames = skill.requiredTools.length > 0 &&
      skill.requiredTools.some((t) => stepsLower.some((s) => s.includes(t.toLowerCase())))
      ? 0.2
      : 0;

    // Steps contain validation/check words? (+15%)
    const checkWords = ['check', 'verify', 'validate', 'test', 'review', 'confirm', 'ensure'];
    const hasValidationStep = stepsLower.some((s) => checkWords.some((w) => s.includes(w)))
      ? 0.15
      : 0;

    // Step count reasonable (3–20)? (+10%)
    const stepCount = skill.steps.length;
    const stepCountOk = stepCount >= 3 && stepCount <= 20 ? 0.1 : 0;

    // Total length > 200 chars? (+15%)
    const lengthOk = fullText.length > 200 ? 0.15 : 0;

    // Contains file path references? (+15%)
    const pathPattern = /[\w/-]+\.[a-z]{1,6}/i;
    const hasFilePaths = pathPattern.test(fullText) ? 0.15 : 0;

    // LLM self-reported confidence (+25%)
    const llmScore = Math.max(0, Math.min(1, llmConfidence)) * 0.25;

    return {
      total: hasToolNames + hasValidationStep + stepCountOk + lengthOk + hasFilePaths + llmScore,
      hasToolNames,
      hasValidationStep,
      stepCountOk,
      lengthOk,
      hasFilePaths,
      llmConfidence: llmScore,
    };
  }

  /**
   * Save extracted skill to the appropriate directory based on quality score.
   *
   * - score >= auto (0.8)   → ~/.cabinet/skills/auto/
   * - score >= review (0.5) → ~/.cabinet/skills/review/
   * - score < review        → discard (returns null)
   */
  save(skill: ExtractedSkill, quality: SkillQualityScore): string | null {
    const thresholds = this.config.qualityThresholds ?? DEFAULT_CONFIG.qualityThresholds!;

    if (quality.total < thresholds.review) {
      return null; // discard low-quality extraction
    }

    const isAuto = quality.total >= thresholds.auto;
    const dir = isAuto ? AUTO_SKILL_DIR : REVIEW_SKILL_DIR;

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const slug = skill.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 40);
    const fileName = `${slug}-${Date.now()}.md`;
    const filePath = join(dir, fileName);

    const frontmatter = [
      '---',
      `name: "${skill.name}"`,
      `trigger: [${skill.triggerPatterns.map((p) => `"${p}"`).join(', ')}]`,
      `tools: [${skill.requiredTools.map((t) => `"${t}"`).join(', ')}]`,
      `quality: ${quality.total.toFixed(2)}`,
      `tier: ${isAuto ? 'auto' : 'review'}`,
      `exposure: prompt`,
      '---',
      '',
      `# ${skill.name}`,
      '',
      skill.description,
      '',
      '## Steps',
      ...skill.steps.map((s, i) => `${i + 1}. ${s}`),
      '',
    ].join('\n');

    writeFileSync(filePath, frontmatter, 'utf-8');
    return filePath;
  }
}
