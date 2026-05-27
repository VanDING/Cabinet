// ── Blueprint — OrganizeAgent output types ──

export interface BlueprintIssue {
  node: string;
  type:
    | 'missing_agent'
    | 'missing_step'
    | 'invalid_branch'
    | 'missing_auth'
    | 'invalid_gate'
    | 'circular_dependency';
  detail: string;
}

export interface BlueprintAgent {
  action: 'use_existing' | 'create_new';
  name: string;
  prompt?: string;
}

export interface BlueprintWorkflowStep {
  id: string;
  name?: string;
  type?: string;
  agent?: string;
  input?: { from: string };
  condition?: { trueBranch?: string; falseBranch?: string; expression?: string };
  children?: string[];
}

export interface BlueprintAuthorizationRule {
  node_id?: string;
  level?: string;
  description?: string;
  default?: string;
}

export interface BlueprintHarnessGate {
  node_id: string;
  criteria?: string;
  evaluator?: string;
}

export interface Blueprint {
  meta?: { goal?: string };
  agents?: BlueprintAgent[];
  workflow?: { steps?: BlueprintWorkflowStep[] };
  harness?: { gates?: BlueprintHarnessGate[] };
  authorization?: { rules?: BlueprintAuthorizationRule[] };
}

export interface BlueprintValidationResult {
  valid: boolean;
  issues: BlueprintIssue[];
}
