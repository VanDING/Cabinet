export interface Finding {
  type: 'fact' | 'risk' | 'opportunity' | 'assumption';
  detail: string;
  evidence: string;
  severity?: 'high' | 'medium' | 'low';
}

export interface AgentDecision {
  decision: string;
  rationale: string;
}

export interface AgentOutput {
  summary: string;
  findings: Finding[];
  decisions: AgentDecision[];
  openQuestions: string[];
  confidence: number;
  suggestedNextSteps: string[];
}

export interface PipelineStepContext {
  role: string;
  summary: string;
  findings: Finding[];
  decisions: AgentDecision[];
}

export interface PipelineContext {
  originalRequest: string;
  steps: PipelineStepContext[];
}
