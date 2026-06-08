//
// Generic CLI HarnessRuntime — fallback for unrecognized CLI agents.
//
// Mirrors the original CliAdapter behavior: Cabinet internal prompt format
// with ===CABINET_DELIVERABLE=== markers. Used when no specific harness
// (Claude Code, Codex, OpenCode) is detected.
//

import type { ExternalTask } from '../types.js';
import type { HarnessContext, AgentTaskMetrics } from '../harness-runtime.js';
import { BaseCliRuntime } from './base-cli.js';

// ── GenericCliRuntime ─────────────────────────────────────────────

export class GenericCliRuntime extends BaseCliRuntime {
  readonly harnessId = 'generic';

  protected getDefaultCommand(): string {
    return this.agentId;
  }

  protected buildArgs(_task: ExternalTask): string[] {
    return this.config.args ?? [];
  }

  convertPrompt(task: ExternalTask, _context?: HarnessContext): string {
    const slot = task.slot;
    const lines: string[] = [
      `## 任务`,
      typeof task.input === 'string' ? task.input : JSON.stringify(task.input, null, 2),
      '',
    ];

    if (slot.project?.name) {
      lines.push(
        `## 项目上下文`,
        `- 项目: ${slot.project.name}`,
        `- 技术栈: ${slot.project.tech_stack ?? '未指定'}`,
        `- 目标: ${slot.project.goals?.join(', ') ?? '未指定'}`,
        '',
      );
    }

    if (slot.memories?.length) {
      lines.push('## 相关记忆', ...slot.memories.map((m) => `- ${m}`), '');
    }

    if (slot.files?.length) {
      lines.push('## 最近文件', ...slot.files.map((f) => `- ${f}`), '');
    }

    if (slot.preferences) {
      lines.push(
        '## Captain 偏好',
        `- 风险容忍度: ${slot.preferences.riskTolerance ?? '未指定'}`,
        `- 决策风格: ${slot.preferences.preferredDecisionStyle ?? '未指定'}`,
        '',
      );
    }

    lines.push(
      '## 安全约束',
      `- 安全级别: ${slot.security.level}`,
      `- 最大重试次数: ${slot.security.maxRetries}`,
      '',
      '## 输出协议（严格遵守）',
      '执行过程中如有中间发现，用分隔符标记：',
      `===CABINET_DISCOVERY===`,
      `{"type": "...", "summary": "..."}`,
      `===END_DISCOVERY===`,
      '',
      '任务完成时，用分隔符标记最终交付物：',
      `===CABINET_DELIVERABLE===`,
      '<最终代码/报告/结果>',
      `===END_DELIVERABLE===`,
    );

    return lines.join('\n');
  }

  extractMetrics(_stdout: string, _stderr: string): AgentTaskMetrics {
    // Generic harness can't extract detailed metrics
    return {
      tokensUsed: undefined,
      contextWindowPercent: undefined,
      model: undefined,
      toolCalls: undefined,
      steps: undefined,
      durationMs: undefined,
    };
  }

  injectSkill(): string {
    return [
      '## Cabinet 协议',
      '你正在 Cabinet AI 编排框架中运行。',
      '',
      '### 输出格式',
      `- 中间发现: 用 \`===CABINET_DISCOVERY===\\n{...}\\n===END_DISCOVERY===\` 包裹`,
      `- 最终交付: 用 \`===CABINET_DELIVERABLE===\\n...\\n===END_DELIVERABLE===\` 包裹`,
      '',
      '### Context Slot',
      '如果任务包含 context slot，你可以读取其中的文件、记忆、偏好等信息。',
      '完成后的交付物会通过 slot 回传到 Cabinet 主系统。',
      '',
      '### 约束',
      '- 不要修改 slot_write_url 指向的文件',
      '- 所有文件操作在工作目录内进行',
      '- 超时后任务会自动取消',
    ].join('\n');
  }
}
