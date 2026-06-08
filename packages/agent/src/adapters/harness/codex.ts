//
// Codex (OpenAI) HarnessRuntime — OpenAI function-calling format adapter.
//
// Codex (OpenAI's CLI coding agent) expects:
//   - English prompts with function-calling format
//   - OpenAI-compatible tool definitions
//   - JSON-structured outputs
//
// This harness:
//   1. Converts Cabinet prompts to Codex-friendly format
//   2. Injects HarnessSkill for Cabinet protocol awareness
//   3. Parses Codex output format
//

import type { ExternalTask, AgentCapability } from '../types.js';
import type { HarnessContext, AgentTaskMetrics } from '../harness-runtime.js';
import { BaseCliRuntime } from './base-cli.js';

// ── CodexRuntime ────────────────────────────────────────────────

export class CodexRuntime extends BaseCliRuntime {
  readonly harnessId = 'codex';

  protected getDefaultCommand(): string {
    return 'codex';
  }

  protected buildArgs(_task: ExternalTask): string[] {
    return [...(this.config.args ?? [])];
  }

  async install(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.execSimple('npm', ['install', '-g', '@openai/codex-cli']);
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  // ── Prompt Conversion ─────────────────────────────────────────
  //
  // Codex uses OpenAI's function-calling conventions.
  // Prompts are structured with clear system/user/assistant roles.

  convertPrompt(task: ExternalTask, context?: HarnessContext): string {
    const slot = task.slot;
    const parts: string[] = [];

    // System-level: inject Cabinet skill
    parts.push(this.injectSkill());
    parts.push('');
    parts.push('---');
    parts.push('');

    // User-level: the actual task
    const input = typeof task.input === 'string' ? task.input : JSON.stringify(task.input, null, 2);
    parts.push(input);
    parts.push('');

    // Context
    if (slot.project?.name) {
      parts.push('## Context');
      parts.push(`Project: ${slot.project.name}`);
      parts.push(`Tech: ${slot.project.tech_stack ?? 'unspecified'}`);
      if (context?.workspacePath) {
        parts.push(`Workspace: ${context.workspacePath}`);
      }
      parts.push('');
    }

    // Related information
    if (slot.memories?.length || slot.files?.length) {
      parts.push('## Background');
      for (const m of slot.memories ?? []) {
        parts.push(`- ${m}`);
      }
      for (const f of slot.files ?? []) {
        parts.push(`- File: ${f}`);
      }
      parts.push('');
    }

    // Output protocol
    parts.push('## Required Output Format');
    parts.push('');
    parts.push('During execution, report findings:');
    parts.push('```');
    parts.push('===CABINET_DISCOVERY===');
    parts.push('{"type": "finding", "summary": "description"}');
    parts.push('===END_DISCOVERY===');
    parts.push('```');
    parts.push('');
    parts.push('Final deliverable:');
    parts.push('```');
    parts.push('===CABINET_DELIVERABLE===');
    parts.push('<result>');
    parts.push('===END_DELIVERABLE===');
    parts.push('```');

    return parts.join('\n');
  }

  // ── Output Parsing ────────────────────────────────────────────

  extractMetrics(stdout: string, stderr: string): AgentTaskMetrics {
    const combined = stdout + '\n' + stderr;
    const metrics: AgentTaskMetrics = {};

    // OpenAI format: "usage": {"prompt_tokens": 100, "completion_tokens": 50}
    const usageMatch = combined.match(/"prompt_tokens":\s*(\d+)[^}]*"completion_tokens":\s*(\d+)/);
    if (usageMatch?.[1] && usageMatch?.[2]) {
      metrics.tokensUsed = parseInt(usageMatch[1], 10) + parseInt(usageMatch[2], 10);
    }

    // Model info: "model": "gpt-5"
    const modelMatch = combined.match(/"model":\s*"([^"]+)"/);
    if (modelMatch) {
      metrics.model = modelMatch[1];
    }

    // Tool calls count
    const toolMatches = combined.match(/"name":\s*"[^"]+"/g);
    if (toolMatches) {
      metrics.toolCalls = toolMatches.length;
    }

    // Duration
    const durMatch = combined.match(
      /(?:duration|elapsed|completed in)[^0-9]*(\d+\.?\d*)\s*(s|sec)/i,
    );
    if (durMatch?.[1]) {
      metrics.durationMs = Math.round(parseFloat(durMatch[1]) * 1000);
    }

    return metrics;
  }

  injectSkill(): string {
    return [
      '# Cabinet Agent Protocol (Codex Edition)',
      '',
      'You are an external agent in the **Cabinet AI orchestration framework**, running via Codex (OpenAI).',
      '',
      '## Your Role',
      '- Execute the task described below using your available tools.',
      '- Report intermediate findings using the discovery marker format.',
      '- Submit your final deliverable using the deliverable marker format.',
      '',
      '## Output Format',
      `- Discoveries: \`===CABINET_DISCOVERY===\\n{JSON}\\n===END_DISCOVERY===\``,
      `- Deliverable: \`===CABINET_DELIVERABLE===\\n<content>\\n===END_DELIVERABLE===\``,
      '',
      '## Available Context',
      'The task includes project context, memories, and file references from Cabinet.',
      'Use these to understand the broader project goals.',
      '',
      '## Constraints',
      '- Work within the provided working directory.',
      '- Respect the security level and retry limits.',
      '- Flag any ambiguities before proceeding.',
    ].join('\n');
  }

  async discoverSessions?(): Promise<string[]> {
    return [];
  }

  getCapabilities(): AgentCapability[] {
    return this.capabilities.length > 0
      ? this.capabilities
      : [
          { name: 'code_generation', description: 'Generate and edit code using OpenAI models' },
          { name: 'file_operations', description: 'Read, write, and manage files' },
          { name: 'shell_execution', description: 'Execute shell commands' },
          { name: 'analysis', description: 'Analyze code and provide insights' },
        ];
  }
}
