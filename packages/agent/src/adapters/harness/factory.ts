//
// HarnessRuntimeFactory — creates the correct HarnessRuntime for a given harnessId.
//
// Maps harness IDs to their runtime implementations:
//   claude-code → ClaudeCodeRuntime
//   codex       → CodexRuntime
//   opencode    → OpenCodeRuntime
//   a2a         → A2AHarnessRuntime
//   generic     → GenericCliRuntime (fallback)
//
// Auto-detection: when harnessId is not explicitly specified, the factory
// inspects the agent's command name to guess the harness.
//

import type { HarnessRuntime, HarnessConfig } from '../harness-runtime.js';
import type { AgentCapability } from '../types.js';
import { ClaudeCodeRuntime } from './claude-code.js';
import { CodexRuntime } from './codex.js';
import { OpenCodeRuntime } from './opencode.js';
import { A2AHarnessRuntime } from './a2a.js';
import { GenericCliRuntime } from './generic.js';

// ── Harness ID constants ──────────────────────────────────────────

export const HARNESS_IDS = {
  CLAUDE_CODE: 'claude-code',
  CODEX: 'codex',
  OPENCODE: 'opencode',
  A2A: 'a2a',
  GENERIC: 'generic',
} as const;

export type HarnessId = (typeof HARNESS_IDS)[keyof typeof HARNESS_IDS];

// ── Command-to-harness mapping for auto-detection ─────────────────

let _customHarnessMap: Record<string, HarnessId> = {};

const COMMAND_HARNESS_MAP: Record<string, HarnessId> = {
  claude: 'claude-code',
  'claude-code': 'claude-code',
  codex: 'codex',
  'codex-cli': 'codex',
  opencode: 'opencode',
  'qwen-code': 'generic',
  gemini: 'generic',
  'cursor-agent': 'generic',
  kimi: 'generic',
  'kiro-cli': 'generic',
};

/** Register additional command-to-harness mappings at runtime. */
export function registerHarnessMapping(command: string, harnessId: HarnessId): void {
  _customHarnessMap[command.toLowerCase()] = harnessId;
}

/** Load custom harness mappings from a plain object (e.g. config file). */
export function loadHarnessMappings(mappings: Record<string, HarnessId>): void {
  _customHarnessMap = { ..._customHarnessMap, ...mappings };
}

// ── Logger type ──────────────────────────────────────────────────

type Logger = {
  info: (msg: string, ctx?: unknown) => void;
  warn: (msg: string, ctx?: unknown) => void;
};

// ── Factory ──────────────────────────────────────────────────────

export class HarnessRuntimeFactory {
  /**
   * Create a HarnessRuntime for the given harness config.
   *
   * @param agentId - The Cabinet agent ID (e.g., 'external_cli:claude')
   * @param config - Harness configuration (command, args, baseUrl, etc.)
   * @param capabilities - Known agent capabilities
   * @param logger - Optional logger
   */
  static create(
    agentId: string,
    config: HarnessConfig,
    capabilities: AgentCapability[] = [],
    logger?: Logger,
  ): HarnessRuntime {
    const harnessId = HarnessRuntimeFactory.resolveHarnessId(config);

    switch (harnessId) {
      case 'claude-code':
        return new ClaudeCodeRuntime(agentId, { ...config, harnessId }, capabilities, logger);
      case 'codex':
        return new CodexRuntime(agentId, { ...config, harnessId }, capabilities, logger);
      case 'opencode':
        return new OpenCodeRuntime(agentId, { ...config, harnessId }, capabilities, logger);
      case 'a2a':
        return new A2AHarnessRuntime(agentId, { ...config, harnessId }, logger);
      case 'generic':
      default:
        return new GenericCliRuntime(agentId, { ...config, harnessId }, capabilities, logger);
    }
  }

  /**
   * Resolve the harness ID from config.
   * If harnessId is explicitly set and not 'generic', use it.
   * Otherwise, auto-detect from the command name.
   */
  static resolveHarnessId(config: HarnessConfig): HarnessId {
    // Explicit harness ID takes priority (unless it's 'generic' which means "auto-detect")
    if (config.harnessId && config.harnessId !== 'generic') {
      return config.harnessId as HarnessId;
    }

    // Auto-detect from command name
    if (config.command) {
      const baseCommand = config.command.split('/').pop()?.split('\\').pop() ?? config.command;
      const lower = baseCommand.toLowerCase();
      const mapped = _customHarnessMap[lower] ?? COMMAND_HARNESS_MAP[lower];
      if (mapped) return mapped;
    }

    // A2A protocol
    if (config.baseUrl) {
      return 'a2a';
    }

    return 'generic';
  }

  /**
   * Auto-detect harness ID from an agent command string alone.
   * Useful for AutoDiscoverer before full config is available.
   */
  static detectFromCommand(command: string): HarnessId {
    const base = command.split('/').pop()?.split('\\').pop() ?? command;
    const lower = base.toLowerCase();
    return _customHarnessMap[lower] ?? COMMAND_HARNESS_MAP[lower] ?? 'generic';
  }

  /**
   * Check if a given harness ID represents a known/specific harness
   * (as opposed to 'generic' fallback).
   */
  static isKnownHarness(harnessId: string): boolean {
    return harnessId === 'claude-code' || harnessId === 'codex' || harnessId === 'opencode' || harnessId === 'a2a';
  }
}
