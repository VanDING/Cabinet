export interface AgentHandoff {
  from: string;
  task: string;
  summary: string;
  findings: Array<{
    type: string;
    detail: string;
    severity?: 'high' | 'medium' | 'low';
  }>;
  decisions: Array<{ decision: string; rationale: string }>;
  openQuestions: string[];
  confidence: number;
  rawOutput: string;
}

export function buildHandoffFromResult(
  from: string,
  task: string,
  rawOutput: string,
  structuredOutput?: {
    summary?: string;
    findings?: Array<{ type: string; detail: string; severity?: 'high' | 'medium' | 'low' }>;
    decisions?: Array<{ decision: string; rationale: string }>;
    openQuestions?: string[];
    confidence?: number;
  } | null,
): AgentHandoff {
  return {
    from,
    task,
    summary: structuredOutput?.summary ?? rawOutput.slice(0, 200),
    findings: structuredOutput?.findings ?? [],
    decisions: structuredOutput?.decisions ?? [],
    openQuestions: structuredOutput?.openQuestions ?? [],
    confidence: structuredOutput?.confidence ?? 0.5,
    rawOutput,
  };
}

export function buildSimpleHandoff(from: string, task: string, rawOutput: string): AgentHandoff {
  let confidence = 0.5;
  try {
    const match = rawOutput.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (typeof parsed.confidence === 'number') confidence = Math.max(0, Math.min(1, parsed.confidence));
    }
  } catch { /* ignore parse errors */ }

  return {
    from,
    task,
    summary: rawOutput.slice(0, 200),
    findings: [],
    decisions: [],
    openQuestions: [],
    confidence,
    rawOutput,
  };
}
