//
// OpenCode HarnessRuntime — SQLite session + Markdown output adapter.
//
// OpenCode uses:
//   - A SQLite database for session persistence
//   - Markdown-based output format
//   - CLI interface (opencode) similar to Claude Code but with different flags
//
// This harness:
//   1. Converts Cabinet prompts to OpenCode's expected format
//   2. Injects HarnessSkill for Cabinet protocol awareness
//   3. Can discover/resume OpenCode sessions from SQLite DB
//

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ExternalTask, AgentCapability } from '../types.js';
import type { HarnessContext, AgentTaskMetrics } from '../harness-runtime.js';
import { BaseCliRuntime } from './base-cli.js';

// OpenCode session directory
const OPENCODE_DIR = join(homedir(), '.opencode');

// ── OpenCodeRuntime ──────────────────────────────────────────────

export class OpenCodeRuntime extends BaseCliRuntime {
  readonly harnessId = 'opencode';

  protected getDefaultCommand(): string {
    return 'opencode';
  }

  protected buildArgs(_task: ExternalTask): string[] {
    return [...(this.config.args ?? [])];
  }

  async detect(): Promise<boolean> {
    const baseResult = await super.detect();
    if (baseResult) return true;
    // Also check if the opencode directory exists (pre-installed but not on PATH)
    return existsSync(OPENCODE_DIR);
  }

  async install(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.execSimple('npm', ['install', '-g', 'opencode']);
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  // ── Prompt Conversion ─────────────────────────────────────────
  //
  // OpenCode accepts natural language prompts with Markdown formatting.

  convertPrompt(task: ExternalTask, context?: HarnessContext): string {
    const slot = task.slot;
    const parts: string[] = [];

    // Inject protocol
    parts.push(this.injectSkill());
    parts.push('');
    parts.push('---');
    parts.push('');

    // Task
    const input = typeof task.input === 'string' ? task.input : JSON.stringify(task.input, null, 2);
    parts.push('## Task');
    parts.push(input);
    parts.push('');

    // Context
    if (slot.project?.name) {
      parts.push('## Project');
      parts.push(`- Name: ${slot.project.name}`);
      parts.push(`- Stack: ${slot.project.tech_stack ?? 'unspecified'}`);
      if (context?.workspacePath) parts.push(`- Workspace: ${context.workspacePath}`);
      parts.push('');
    }

    if (slot.memories?.length) {
      parts.push('## Memories');
      for (const m of slot.memories) parts.push(`- ${m}`);
      parts.push('');
    }

    if (slot.files?.length) {
      parts.push('## Files');
      for (const f of slot.files) parts.push(`- ${f}`);
      parts.push('');
    }

    // Output protocol
    parts.push('## Output Format');
    parts.push(`- Findings: \`===CABINET_DISCOVERY===\\n{JSON}\\n===END_DISCOVERY===\``);
    parts.push(`- Final: \`===CABINET_DELIVERABLE===\\n<result>\\n===END_DELIVERABLE===\``);
    parts.push('');
    parts.push('Complete the task using your tools. Report findings as you go.');

    return parts.join('\n');
  }

  // ── Output Parsing ────────────────────────────────────────────

  extractMetrics(stdout: string, stderr: string): AgentTaskMetrics {
    const combined = stdout + '\n' + stderr;
    const metrics: AgentTaskMetrics = {};

    const tokenMatch = combined.match(/(\d[\d_,]*)\s*tokens?\s*(?:used|consumed)/i);
    if (tokenMatch?.[1]) {
      metrics.tokensUsed = parseInt(tokenMatch[1].replace(/[_,]/g, ''), 10);
    }

    const modelMatch = combined.match(/model:?\s*([a-zA-Z][\w.-]+)/i);
    if (modelMatch) {
      metrics.model = modelMatch[1];
    }

    const durMatch = combined.match(/(\d+\.?\d*)\s*(?:seconds?|s)\s*(?:elapsed|duration|total)/i);
    if (durMatch?.[1]) {
      metrics.durationMs = Math.round(parseFloat(durMatch[1]) * 1000);
    }

    return metrics;
  }

  injectSkill(): string {
    return [
      '# Cabinet Agent Protocol (OpenCode Edition)',
      '',
      'You are running inside the **Cabinet AI orchestration framework** as an OpenCode agent.',
      '',
      '## Protocol',
      'Cabinet dispatches tasks to you with project context and background information.',
      'Your responses are parsed by Cabinet and routed back to the user.',
      '',
      '## Output Format',
      `- Report intermediate findings: \`===CABINET_DISCOVERY===\\n{"type":"...","summary":"..."}\\n===END_DISCOVERY===\``,
      `- Submit final deliverable: \`===CABINET_DELIVERABLE===\\n<content>\\n===END_DELIVERABLE===\``,
      '',
      '## Guidelines',
      '- Use the working directory for all file operations.',
      '- Report progress with discovery markers.',
      '- Respect security and retry constraints from the task configuration.',
      '- Read files before modifying them.',
    ].join('\n');
  }

  async discoverSessions(): Promise<string[]> {
    const sessions: string[] = [];
    try {
      const dbPath = join(OPENCODE_DIR, 'sessions.db');
      if (!existsSync(dbPath)) return sessions;
      // OpenCode stores sessions in a SQLite database
      // For now, just report if the DB exists
      sessions.push(dbPath);
    } catch {
      /* best effort */
    }
    return sessions;
  }

  getCapabilities(): AgentCapability[] {
    return this.capabilities.length > 0
      ? this.capabilities
      : [
          { name: 'code_generation', description: 'Generate and edit code' },
          { name: 'file_operations', description: 'Read, write, and manage files' },
          { name: 'shell_execution', description: 'Execute shell commands' },
        ];
  }
}
