//
// Claude Code HarnessRuntime — Anthropic tool-use format adapter.
//
// Claude Code (the official Anthropic CLI) expects:
//   - Natural-language English prompts (not Cabinet's Chinese format)
//   - Tool-use via Anthropic's tool-use protocol
//   - Session management via --resume or --continue
//   - Output with structured JSON blocks
//
// This harness:
//   1. Converts Cabinet's Chinese prompt to Claude Code-friendly English
//   2. Injects HarnessSkill to teach Claude Code about Cabinet protocol
//   3. Parses Claude Code's output format (JSON blocks + file references)
//   4. Discovers active Claude Code sessions for resume
//

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ExternalTask, AgentCapability } from '../types.js';
import type { HarnessContext, AgentTaskMetrics } from '../harness-runtime.js';
import { BaseCliRuntime } from './base-cli.js';

// Claude Code session directory
const CLAUDE_SESSIONS_DIR = join(homedir(), '.claude', 'projects');

// ── ClaudeCodeRuntime ────────────────────────────────────────────

export class ClaudeCodeRuntime extends BaseCliRuntime {
  readonly harnessId = 'claude-code';

  protected getDefaultCommand(): string {
    return 'claude';
  }

  protected buildArgs(task: ExternalTask): string[] {
    const args = [...(this.config.args ?? [])];

    // Add print mode for non-interactive execution
    if (!args.includes('--print') && !args.includes('-p')) {
      args.push('--print');
    }

    // Add working directory
    if (task.configuration.working_directory) {
      args.push('--cwd', task.configuration.working_directory);
    }

    return args;
  }

  async install(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.execSimple('npm', ['install', '-g', '@anthropic-ai/claude-code']);
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  // ── Prompt Conversion ──────────────────────────────────────────
  //
  // Claude Code expects English, structured prompts that leverage
  // its tool-use capabilities. This converts Cabinet's Chinese format
  // to Claude Code's expected format.

  convertPrompt(task: ExternalTask, context?: HarnessContext): string {
    const slot = task.slot;
    const parts: string[] = [];

    // Inject harness skill first so Claude Code understands Cabinet protocol
    parts.push(this.injectSkill());
    parts.push('');
    parts.push('---');
    parts.push('');

    // Task description
    parts.push('## Task');
    const input = typeof task.input === 'string' ? task.input : JSON.stringify(task.input, null, 2);
    parts.push(input);
    parts.push('');

    // Project context
    if (slot.project?.name) {
      parts.push('## Project Context');
      parts.push(`- Project: ${slot.project.name}`);
      parts.push(`- Tech Stack: ${slot.project.tech_stack ?? 'unspecified'}`);
      if (slot.project.goals?.length) {
        parts.push(`- Goals: ${slot.project.goals.join(', ')}`);
      }
      parts.push('');
    }

    // Working directory context
    if (context?.workspacePath) {
      parts.push(`Working directory: ${context.workspacePath}`);
      parts.push('');
    }

    // Relevant memories
    if (slot.memories?.length) {
      parts.push('## Relevant Context');
      for (const m of slot.memories) {
        parts.push(`- ${m}`);
      }
      parts.push('');
    }

    // Relevant files
    if (slot.files?.length) {
      parts.push('## Related Files');
      for (const f of slot.files) {
        parts.push(`- ${f}`);
      }
      parts.push('');
    }

    // Security constraints
    parts.push('## Constraints');
    parts.push(`- Security Level: ${slot.security.level}`);
    parts.push(`- Max Retries: ${slot.security.maxRetries}`);
    if (slot.preferences) {
      parts.push(`- Risk Tolerance: ${slot.preferences.riskTolerance ?? 'moderate'}`);
      parts.push(`- Decision Style: ${slot.preferences.preferredDecisionStyle ?? 'autonomous'}`);
    }
    parts.push('');

    // Output protocol (use Cabinet markers for backward compat parsing)
    parts.push('## Output Protocol');
    parts.push('During execution, report intermediate findings using:');
    parts.push('```');
    parts.push('===CABINET_DISCOVERY===');
    parts.push('{"type": "<finding_type>", "summary": "<brief description>"}');
    parts.push('===END_DISCOVERY===');
    parts.push('```');
    parts.push('');
    parts.push('When the task is complete, wrap your final deliverable in:');
    parts.push('```');
    parts.push('===CABINET_DELIVERABLE===');
    parts.push('<final code, report, or result>');
    parts.push('===END_DELIVERABLE===');
    parts.push('```');
    parts.push('');
    parts.push(
      'Use your available tools (Read, Write, Edit, Bash, Glob, Grep) to complete this task.',
    );
    parts.push('If you need clarification, state your question clearly before proceeding.');

    return parts.join('\n');
  }

  // ── Metrics Extraction ─────────────────────────────────────────
  //
  // Claude Code outputs token/model info in its stderr/log output.
  // This attempts to parse those details.

  extractMetrics(stdout: string, stderr: string): AgentTaskMetrics {
    const combined = stdout + '\n' + stderr;
    const metrics: AgentTaskMetrics = {};

    // Try to find token usage: "tokens: 1234 input + 567 output"
    const tokenMatch = combined.match(
      /tokens?:\s*(\d[\d_,]*)\s*(?:input|prompt)?\s*\+\s*(\d[\d_,]*)\s*(?:output|completion)?/i,
    );
    if (tokenMatch?.[1] && tokenMatch?.[2]) {
      metrics.tokensUsed =
        parseInt(tokenMatch[1].replace(/[_,]/g, ''), 10) +
        parseInt(tokenMatch[2].replace(/[_,]/g, ''), 10);
    }

    // Try to find model info: "model: claude-sonnet-4-6" or "Using model claude-opus-4-8"
    const modelMatch = combined.match(/model:?\s*(claude[- ][\w.-]+)/i);
    if (modelMatch) {
      metrics.model = modelMatch[1];
    }

    // Try to find duration: "completed in 12.3s" or "duration: 45s"
    const durationMatch = combined.match(
      /(?:completed|duration|elapsed)[^0-9]*(\d+\.?\d*)\s*(s|sec|second)/i,
    );
    if (durationMatch?.[1]) {
      metrics.durationMs = Math.round(parseFloat(durationMatch[1]) * 1000);
    }

    // Count tool calls from output
    const toolMatches = combined.match(/tool_use|using tool|Running:\s*\w/g);
    if (toolMatches) {
      metrics.toolCalls = toolMatches.length;
    }

    return metrics;
  }

  // ── Skill Injection ────────────────────────────────────────────

  injectSkill(): string {
    return [
      '# Cabinet Agent Protocol',
      '',
      'You are running as an external agent within the **Cabinet AI orchestration framework**.',
      '',
      '## How Cabinet Works',
      '- Cabinet dispatches tasks to you with project context, memories, and file references.',
      '- Your output is parsed by Cabinet and routed back to the main conversation.',
      '- You have access to your full tool set (Read, Write, Edit, Bash, Glob, Grep).',
      '',
      '## Communication Protocol',
      `- Report intermediate findings: wrap JSON in \`===CABINET_DISCOVERY===\\n{...}\\n===END_DISCOVERY===\``,
      `- Submit final deliverable: wrap in \`===CABINET_DELIVERABLE===\\n...\\n===END_DELIVERABLE===\``,
      '',
      '## Best Practices',
      '- Read files before editing them.',
      '- Use the working directory provided in the task for all file operations.',
      '- Report progress regularly using the discovery marker.',
      '- If the task is ambiguous, state your interpretation and proceed.',
      '- Do not modify files outside the working directory unless explicitly instructed.',
      '',
      '## Context Slot',
      'The task includes a "slot" with project info, memories, and preferences.',
      'Use this context to tailor your approach — it represents what Cabinet knows about the current project.',
    ].join('\n');
  }

  // ── Session Discovery ──────────────────────────────────────────
  //
  // Claude Code stores sessions as JSONL files. This discovers active sessions.

  async discoverSessions(): Promise<string[]> {
    const sessions: string[] = [];
    try {
      if (!existsSync(CLAUDE_SESSIONS_DIR)) return sessions;
      const { readdirSync } = await import('node:fs');
      const entries = readdirSync(CLAUDE_SESSIONS_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          // Check if there are recent sessions (within last 24h)
          try {
            const files = readdirSync(join(CLAUDE_SESSIONS_DIR, entry.name));
            const recentSession = files.find((f) => f.startsWith('agent-') && f.endsWith('.jsonl'));
            if (recentSession) {
              sessions.push(`${entry.name}/${recentSession}`);
            }
          } catch {
            /* skip unreadable */
          }
        }
      }
    } catch {
      /* best effort */
    }
    return sessions;
  }

  getCapabilities(): AgentCapability[] {
    return this.capabilities.length > 0
      ? this.capabilities
      : [
          { name: 'code_generation', description: 'Generate and edit code files' },
          { name: 'file_operations', description: 'Read, write, and manage files' },
          { name: 'shell_execution', description: 'Execute shell commands' },
          { name: 'code_review', description: 'Review and analyze code' },
          { name: 'refactoring', description: 'Refactor and improve existing code' },
        ];
  }
}
