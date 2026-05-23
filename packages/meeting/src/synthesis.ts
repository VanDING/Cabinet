import type { AdvisorFinding, ReviewIssue } from './protocol.js';

export interface SynthesisInput {
  topic: string;
  findings: AdvisorFinding[];
  synthesisText: string;
  reviewIssues: ReviewIssue[];
}

export function generateSynthesis(input: SynthesisInput): string {
  const { topic, findings, synthesisText, reviewIssues } = input;

  let result = `## Analysis: ${topic}\n\n`;
  if (synthesisText) result += `**Synthesis:** ${synthesisText}\n\n`;

  if (findings.length > 0) {
    const confidences = findings.map((f) => f.confidence);
    const avgConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;
    const minorityThreshold = avgConfidence - 0.3;

    result += `### Perspectives\n`;
    for (const f of findings) {
      const isMinority = f.confidence < minorityThreshold && findings.length > 2;
      result += `- **${f.perspective}** (confidence: ${f.confidence})${isMinority ? ' ⚠ MINORITY' : ''}: ${f.claim}\n`;
    }

    const minorityOpinions = findings.filter((f) => f.confidence < minorityThreshold);
    if (minorityOpinions.length > 0 && findings.length > 2) {
      result += `\n### Minority Report\n`;
      for (const m of minorityOpinions) {
        result += `- **${m.perspective}**: confidence ${m.confidence} (avg: ${avgConfidence.toFixed(2)}) — this perspective significantly diverges from consensus. Rationale: ${m.evidence}\n`;
      }
    }
  }

  if (reviewIssues.length > 0) {
    result += `\n### Reviewer Notes\n`;
    for (const i of reviewIssues) {
      result += `- [${i.severity}] ${i.detail}\n`;
    }
  }

  return result;
}
