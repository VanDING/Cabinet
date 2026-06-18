/**
 * Shell command risk assessment — categorizes commands by their danger level.
 *
 * Extracted from safety.ts to keep each module focused on one concern.
 */

export interface CommandRiskAssessment {
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  reason: string;
  blockedPatterns?: string[];
}

/** Assess a shell command string and return its risk level. */
export function assessCommandRisk(command: string): CommandRiskAssessment {
  const lower = command.toLowerCase();
  const blockedPatterns: string[] = [];

  // ── Critical: destructive patterns ──
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

  // ── High: dangerous but sometimes legitimate ──
  if (/\brm\s+.*-rf\b/.test(lower)) return { riskLevel: 'high', reason: 'Recursive deletion' };
  if (/\bchmod\s+.*\/etc\//.test(lower))
    return { riskLevel: 'high', reason: 'Modifying system files' };
  if (/\bcat\b.*(id_rsa|id_ed25519|id_ecdsa)/.test(lower))
    return { riskLevel: 'high', reason: 'Accessing SSH keys' };
  if (/\bfind\b.*-name\s*id_rsa/.test(lower))
    return { riskLevel: 'high', reason: 'Searching for SSH keys' };

  // ── Medium: side-effect operations ──
  if (/\bnpm\s+(install|ci)/.test(lower))
    return { riskLevel: 'medium', reason: 'Package installation' };
  if (/\b(git\s+clone|curl|wget)\b/.test(lower))
    return { riskLevel: 'medium', reason: 'Network download' };
  if (/\bdocker\s+(run|exec)/.test(lower))
    return { riskLevel: 'medium', reason: 'Docker execution' };

  // ── Low: read-only commands ──
  if (
    /^(\s*(ls|cat|pwd|echo|ps|top|df|du|head|tail|grep|find|git\s+(status|log|diff|show))\b)/.test(
      lower,
    )
  ) {
    return { riskLevel: 'low', reason: 'Read-only inspection command' };
  }

  return { riskLevel: 'medium', reason: 'Unclassified command' };
}
