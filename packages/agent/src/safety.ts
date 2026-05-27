import { DelegationTier } from '@cabinet/types';

export type SafetyTier = 'cache' | 'auto' | 'whitelist' | 'ai_classifier' | 'delegation_block';

export interface SafetyCheck {
  tier: SafetyTier;
  allowed: boolean;
  /** Human-readable explanation for the user. */
  reason?: string;
  /** The delegation tier that blocked this. Only set when tier = 'delegation_block'. */
  blockedByTier?: DelegationTier;
}

// ── Tool categorization ──────────────────────────────────────

/** Pure read tools — always safe at any tier. */
const READ_ONLY_TOOLS = new Set([
  'query_decisions',
  'get_decision',
  'get_status',
  'get_recent_events',
  'get_project_context',
  'get_captain_preferences',
  'recall',
  'search_memory',
  'list_workflows',
  'list_agents',
  'read_file',
  'list_directory',
  'glob',
  'grep',
  'file_info',
  'recent_files',
  'watch_file',
  'workspace_symbol',
  'go_to_definition',
  'find_references',
  'diagnostics',
  'web_fetch',
  'list_scheduled_tasks',
  'search_documents',
]);

/** Light write tools — reversible, no cost, no destruction. */
const LIGHT_WRITE_TOOLS = new Set([
  'remember',
  'write_memory',
  'add_milestone',
  'update_project_summary',
  'set_captain_preferences',
  'publish_notification',
  'register_agent',
  'make_directory',
]);

/** Moderate tools — create/update records, no destruction, low cost. */
const MODERATE_TOOLS = new Set([
  'create_decision',
  'create_workflow',
  'update_workflow',
  'create_employee',
  'write_file',
  'edit_file',
  'apply_patch',
  'move_file',
  'copy_file',
  'http_request',
  'schedule_task',
  'cancel_scheduled_task',
  'index_document',
  'index_project',
  'evaluate',
  'execute_command',
]);

/** Heavy tools — cost money (LLM calls). */
const COST_TOOLS = new Set(['run_workflow', 'start_meeting']);

/** Destructive tools — irreversible changes. */
const DESTRUCTIVE_TOOLS = new Set([
  'delete_workflow',
  'delete_file',
  'modify_config',
  'approve_decision',
  'reject_decision',
  'clear_index',
]);

// ── Tier definitions ─────────────────────────────────────────
// At each tier, which tool categories are blocked (require Captain confirmation)?

/** T0: Only pure reads are allowed. Everything else is blocked. */
const T0_BLOCKED = new Set([
  ...LIGHT_WRITE_TOOLS,
  ...MODERATE_TOOLS,
  ...COST_TOOLS,
  ...DESTRUCTIVE_TOOLS,
]);

/** T1: Light writes and moderate tools auto; cost and destructive blocked. */
const T1_BLOCKED = new Set([...COST_TOOLS, ...DESTRUCTIVE_TOOLS]);

/** T2: Only destructive tools blocked. */
const T2_BLOCKED = new Set([...DESTRUCTIVE_TOOLS]);

/** T3: Nothing blocked. */
const T3_BLOCKED: Set<string> = new Set();

const TIER_BLOCKLISTS: Record<DelegationTier, Set<string>> = {
  [DelegationTier.CaptainReview]: T0_BLOCKED,
  [DelegationTier.StrategicGuard]: T1_BLOCKED,
  [DelegationTier.TrustedMode]: T2_BLOCKED,
  [DelegationTier.FullAutonomy]: T3_BLOCKED,
};

const TIER_LABELS: Record<DelegationTier, string> = {
  [DelegationTier.CaptainReview]: 'T0 — Captain Review',
  [DelegationTier.StrategicGuard]: 'T1 — Strategic Guard',
  [DelegationTier.TrustedMode]: 'T2 — Trusted Mode',
  [DelegationTier.FullAutonomy]: 'T3 — Full Autonomy',
};

// ── Prefix-based tool classification for MCP / Skill tools ──

type ToolCategory = 'read_only' | 'light_write' | 'moderate' | 'cost' | 'destructive';

function resolveEffectiveCategory(toolName: string): ToolCategory {
  if (READ_ONLY_TOOLS.has(toolName)) return 'read_only';
  if (LIGHT_WRITE_TOOLS.has(toolName)) return 'light_write';
  if (MODERATE_TOOLS.has(toolName)) return 'moderate';
  if (COST_TOOLS.has(toolName)) return 'cost';
  if (DESTRUCTIVE_TOOLS.has(toolName)) return 'destructive';

  // MCP tools run external processes — treat as moderate (blocked at T0)
  if (toolName.startsWith('mcp__')) return 'moderate';

  // Skill tools can trigger arbitrary actions — treat as moderate
  if (toolName.startsWith('use_skill__') || toolName === 'use_skill') return 'moderate';

  // Unknown tools — conservative: treat as light_write (blocked at T0 only)
  return 'light_write';
}

// ── Sensitive path detection ─────────────────────────────────

export function isSensitivePath(filePath: string): boolean {
  const normalized = filePath.toLowerCase();
  if (normalized.includes('/etc/passwd')) return true;
  if (normalized.includes('/etc/shadow')) return true;
  if (normalized.includes('/etc/ssh/sshd_config')) return true;
  if (normalized.includes('.ssh/id_rsa')) return true;
  if (normalized.includes('.ssh/id_ed25519')) return true;
  if (normalized.includes('.ssh/id_ecdsa')) return true;
  if (normalized.includes('.ssh/authorized_keys')) return true;
  if (normalized.includes('.gnupg')) return true;
  if (normalized.includes('.aws/credentials') || normalized.includes('.aws\\credentials'))
    return true;
  if (normalized.endsWith('.env')) return true;
  return false;
}

// ── Command risk assessment ──────────────────────────────────

export interface CommandRiskAssessment {
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  reason: string;
  blockedPatterns?: string[];
}

export function assessCommandRisk(command: string): CommandRiskAssessment {
  const lower = command.toLowerCase();
  const blockedPatterns: string[] = [];

  if (/\brm\s+-rf\s+\//.test(lower)) blockedPatterns.push('rm -rf /');
  if (/\bdd\s+if=/.test(lower)) blockedPatterns.push('dd');
  if (/:\s*\(\)\s*\{/.test(lower)) blockedPatterns.push('fork bomb');
  if (/>\s*\/dev\/sda/.test(lower)) blockedPatterns.push('raw device write');
  if (/\bmkfs\./.test(lower)) blockedPatterns.push('mkfs');
  if (/(curl|wget|fetch).*\|.*(sh|bash|zsh|fish)/.test(lower))
    blockedPatterns.push('pipe to shell');

  if (blockedPatterns.length > 0) {
    return {
      riskLevel: 'critical',
      reason: `Dangerous command detected: ${blockedPatterns.join(', ')}`,
      blockedPatterns,
    };
  }

  if (/\brm\s+.*-rf\b/.test(lower)) return { riskLevel: 'high', reason: 'Recursive deletion' };
  if (/\bchmod\s+.*\/etc\//.test(lower))
    return { riskLevel: 'high', reason: 'Modifying system files' };
  if (/\bcat\b.*(id_rsa|id_ed25519|id_ecdsa)/.test(lower))
    return { riskLevel: 'high', reason: 'Accessing SSH keys' };
  if (/\bfind\b.*-name\s*id_rsa/.test(lower))
    return { riskLevel: 'high', reason: 'Searching for SSH keys' };

  if (/\bnpm\s+(install|ci)/.test(lower))
    return { riskLevel: 'medium', reason: 'Package installation' };
  if (/\b(git\s+clone|curl|wget)\b/.test(lower))
    return { riskLevel: 'medium', reason: 'Network download' };
  if (/\bdocker\s+(run|exec)/.test(lower))
    return { riskLevel: 'medium', reason: 'Docker execution' };

  if (
    /^(\s*(ls|cat|pwd|echo|ps|top|df|du|head|tail|grep|find|git\s+(status|log|diff|show))\b)/.test(
      lower,
    )
  ) {
    return { riskLevel: 'low', reason: 'Read-only inspection command' };
  }

  return { riskLevel: 'medium', reason: 'Unclassified command' };
}

// ── SafetyChecker ────────────────────────────────────────────

export class SafetyChecker {
  private tier: DelegationTier;
  private readonly whitelist: Set<string>;

  constructor(tier: DelegationTier = DelegationTier.StrategicGuard) {
    this.tier = tier;
    this.whitelist = new Set(READ_ONLY_TOOLS);
  }

  /** Update the delegation tier at runtime. */
  setTier(tier: DelegationTier): void {
    this.tier = tier;
  }

  /** Get current tier. */
  getTier(): DelegationTier {
    return this.tier;
  }

  check(toolName: string, _args: Record<string, unknown>): SafetyCheck {
    const filePath = _args.filePath as string | undefined;
    if (filePath && isSensitivePath(filePath)) {
      const fileCheck = this.checkFileAccess(filePath);
      if (!fileCheck.allowed) return fileCheck;
    }

    if (READ_ONLY_TOOLS.has(toolName)) {
      return { tier: 'cache', allowed: true };
    }

    // Resolve the effective category for this tool
    const effectiveCategory = resolveEffectiveCategory(toolName);

    // Check if blocked by current delegation tier
    const blocked = TIER_BLOCKLISTS[this.tier];
    if (effectiveCategory !== 'read_only' && blocked.has(toolName)) {
      return {
        tier: 'delegation_block',
        allowed: false,
        blockedByTier: this.tier,
        reason: [
          `Tool '${toolName}' requires Captain confirmation at ${TIER_LABELS[this.tier]}.`,
          this.tier === DelegationTier.CaptainReview
            ? 'All write operations are blocked in Captain Review mode.'
            : this.tier === DelegationTier.StrategicGuard
              ? 'Cost-incurring and destructive operations require confirmation in Strategic Guard mode.'
              : this.tier === DelegationTier.TrustedMode
                ? 'Destructive operations require confirmation in Trusted Mode.'
                : '',
        ]
          .filter(Boolean)
          .join(' '),
      };
    }

    // For MCP/Skill tools not in any explicit set, apply prefix-based gating
    if (effectiveCategory === 'moderate') {
      // MODERATE tools are blocked at T0 (CaptainReview)
      if (this.tier === DelegationTier.CaptainReview) {
        return {
          tier: 'delegation_block',
          allowed: false,
          blockedByTier: this.tier,
          reason: `Tool '${toolName}' (MCP or Skill) requires Captain confirmation at ${TIER_LABELS[this.tier]}. External tools and skills are blocked in Captain Review mode.`,
        };
      }
    } else if (effectiveCategory === 'destructive') {
      // DESTRUCTIVE tools blocked at T0, T1, T2 — allowed at T3
      if (this.tier !== DelegationTier.FullAutonomy) {
        return {
          tier: 'delegation_block',
          allowed: false,
          blockedByTier: this.tier,
          reason: `Tool '${toolName}' requires Captain confirmation at ${TIER_LABELS[this.tier]}. Destructive operations are blocked.`,
        };
      }
    }

    if (toolName === 'execute_command' && _args.command) {
      const assessment = assessCommandRisk(String(_args.command));
      if (assessment.riskLevel === 'critical') {
        return {
          tier: 'delegation_block',
          allowed: false,
          blockedByTier: this.tier,
          reason: `Command blocked: ${assessment.reason}`,
        };
      }
      if (
        assessment.riskLevel === 'high' &&
        (this.tier === DelegationTier.CaptainReview || this.tier === DelegationTier.StrategicGuard)
      ) {
        return {
          tier: 'delegation_block',
          allowed: false,
          blockedByTier: this.tier,
          reason: `High-risk command requires T2+: ${assessment.reason}`,
        };
      }
      if (assessment.riskLevel === 'medium' && this.tier === DelegationTier.CaptainReview) {
        return {
          tier: 'delegation_block',
          allowed: false,
          blockedByTier: this.tier,
          reason: `Medium-risk command requires T1+: ${assessment.reason}`,
        };
      }
    }

    return { tier: 'auto', allowed: true };
  }

  checkFileAccess(filePath: string): SafetyCheck {
    if (!isSensitivePath(filePath)) {
      return { tier: 'auto', allowed: true };
    }
    if (this.tier === DelegationTier.CaptainReview || this.tier === DelegationTier.StrategicGuard) {
      return {
        tier: 'delegation_block',
        allowed: false,
        blockedByTier: this.tier,
        reason: `Access to sensitive path '${filePath}' requires Trusted Mode (T2) or higher.`,
      };
    }
    return {
      tier: 'ai_classifier',
      allowed: true,
      reason: `Sensitive path access allowed at ${TIER_LABELS[this.tier]} -- audit logged.`,
    };
  }

  /** Quick check: would this tool be blocked at the current tier? */
  isBlocked(toolName: string): boolean {
    if (READ_ONLY_TOOLS.has(toolName)) return false;
    const category = resolveEffectiveCategory(toolName);
    if (category === 'read_only') return false;
    if (category === 'moderate' && this.tier === DelegationTier.CaptainReview) return true;
    if (category === 'destructive') return true;
    return TIER_BLOCKLISTS[this.tier].has(toolName);
  }

  /** Get all tools currently blocked at this tier (for UI display). */
  getBlockedTools(): string[] {
    return [...TIER_BLOCKLISTS[this.tier]];
  }

  /** Get a human-readable description of the current tier. */
  getTierDescription(): string {
    switch (this.tier) {
      case DelegationTier.CaptainReview:
        return 'Every write operation and decision requires your confirmation. Recommended for initial setup and audit periods.';
      case DelegationTier.StrategicGuard:
        return 'Low-risk operations are automatic. Cost-incurring actions (meetings, workflow runs) and destructive changes require confirmation.';
      case DelegationTier.TrustedMode:
        return 'Most operations are automatic. Only destructive changes (deletion, decision rejection) require confirmation.';
      case DelegationTier.FullAutonomy:
        return 'Full autonomy. The budget cap is the only gate. A daily summary will keep you informed.';
    }
  }
}
