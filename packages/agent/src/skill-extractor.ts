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

const AUTO_SKILL_DIR = join(homedir(), '.cabinet', 'skills', 'auto');

/**
 * Automatically extracts reusable skills from successful agent sessions.
 *
 * Trigger: toolCalls.total >= 5 && success && totalSteps >= 10
 */
export class SkillExtractor {
  constructor(private readonly gateway: LLMGateway | null) {}

  async extract(summary: AgentSessionSummary): Promise<ExtractedSkill | null> {
    if (!this.gateway) return null;
    if (summary.toolCalls.total < 5 || !summary.success || summary.totalSteps < 10) {
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
      '  "requiredTools": ["tool1", "tool2"]',
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
        triggerPatterns: Array.isArray(parsed.triggerPatterns) ? parsed.triggerPatterns.map(String) : [],
        steps: Array.isArray(parsed.steps) ? parsed.steps.map(String) : [],
        requiredTools: Array.isArray(parsed.requiredTools) ? parsed.requiredTools.map(String) : uniqueTools,
      };
    } catch {
      return null;
    }
  }

  /** Save extracted skill as a Markdown file to ~/.cabinet/skills/auto/. */
  save(skill: ExtractedSkill): string {
    if (!existsSync(AUTO_SKILL_DIR)) {
      mkdirSync(AUTO_SKILL_DIR, { recursive: true });
    }
    const slug = skill.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
    const fileName = `${slug}-${Date.now()}.md`;
    const filePath = join(AUTO_SKILL_DIR, fileName);

    const frontmatter = [
      '---',
      `name: "${skill.name}"`,
      `trigger: [${skill.triggerPatterns.map((p) => `"${p}"`).join(', ')}]`,
      `tools: [${skill.requiredTools.map((t) => `"${t}"`).join(', ')}]`,
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
