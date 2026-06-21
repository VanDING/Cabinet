export const DANGEROUS_PATTERNS = [
  { pattern: /\brm\s+-rf\s+\//, name: 'rm -rf /' },
  { pattern: /\bdd\s+if=/, name: 'dd' },
  { pattern: /:\s*\(\)\s*\{/, name: 'fork bomb pattern' },
  { pattern: />\s*\/dev\/sda/, name: 'raw device write' },
  { pattern: /\bmkfs\./, name: 'mkfs' },
  { pattern: /\/etc\/passwd|\/etc\/shadow/, name: 'sensitive system file' },
  { pattern: /~\/\.ssh|\/root\/\.ssh/, name: 'SSH key access' },
  { pattern: /(curl|wget|fetch).*\|.*(sh|bash|zsh|fish)/, name: 'pipe to shell' },
  { pattern: /\bpowershell\b.*-encodedcommand/, name: 'encoded powershell' },
  {
    pattern: />>?\s*(~\/\.bashrc|~\/\.zshrc|~\/\.profile|~\/\.bash_profile)/,
    name: 'shell persistence',
  },
  { pattern: /\becho\b.*>>?\s*(~\/\.bashrc|~\/\.zshrc|~\/\.profile)/, name: 'shell persistence' },
  { pattern: /\bcat\b.*(id_rsa|id_ed25519|id_ecdsa)/, name: 'SSH key exfil' },
  { pattern: /\bfind\b.*-name\s*id_rsa/, name: 'SSH key search' },
] as const;

export function detectDangerousCommand(command: string): string | null {
  const lower = command.toLowerCase();
  for (const { pattern, name } of DANGEROUS_PATTERNS) {
    if (pattern.test(lower)) return name;
  }
  return null;
}
