// ── SKILL.md standard fields ──

export interface ParsedSkill {
  name: string;
  description: string;
  kind?: 'tool' | 'prompt' | 'composite';
  version?: number;
  license?: string;
  compatibility?: string;
  model?: string;
  effort?: string;
  context?: string;
  agent?: string;
  userInvocable?: boolean;
  disableModelInvocation?: boolean;
  argumentHint?: string;
  arguments?: string | string[];
  whenToUse?: string;
  allowedTools?: string[];
  metadata?: Record<string, unknown>;
  body: string;
}
