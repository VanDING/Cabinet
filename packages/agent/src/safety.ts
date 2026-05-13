export type SafetyTier = 'cache' | 'auto' | 'whitelist' | 'ai_classifier';

export interface SafetyCheck {
  tier: SafetyTier;
  allowed: boolean;
  reason?: string;
}

const SAFE_TOOLS = new Set([
  'read_file', 'list_directory', 'search_code',
  'query_decisions', 'get_status', 'list_workflows',
]);

const DANGEROUS_TOOLS = new Set([
  'delete_file', 'execute_command', 'modify_config',
  'send_notification', 'approve_decision',
]);

export class SafetyChecker {
  private readonly whitelist: Set<string>;

  constructor(additionalSafeTools: string[] = []) {
    this.whitelist = new Set([...SAFE_TOOLS, ...additionalSafeTools]);
  }

  check(toolName: string, _args: Record<string, unknown>): SafetyCheck {
    // Tier 1: Cache — known safe tools, immediate pass
    if (this.whitelist.has(toolName)) {
      return { tier: 'cache', allowed: true };
    }

    // Tier 4 (pre-check): AI Classifier — known dangerous tools, escalate
    if (DANGEROUS_TOOLS.has(toolName)) {
      return {
        tier: 'ai_classifier',
        allowed: false,
        reason: `Tool '${toolName}' requires AI classifier review. Use teach-back confirmation.`,
      };
    }

    // Tier 2: Auto — default allow for unknown but not explicitly dangerous tools
    return { tier: 'auto', allowed: true };
  }

  addToWhitelist(toolName: string): void {
    this.whitelist.add(toolName);
  }

  isDangerous(toolName: string): boolean {
    return DANGEROUS_TOOLS.has(toolName);
  }

  isWhitelisted(toolName: string): boolean {
    return this.whitelist.has(toolName);
  }
}
