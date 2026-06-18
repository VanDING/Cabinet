/**
 * Sensitive file path detection — checks if a file path references system
 * files that should never be read or modified by agents.
 *
 * Extracted from safety.ts to keep each module focused on one concern.
 */

/** Check if a file path matches known sensitive system files. */
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
