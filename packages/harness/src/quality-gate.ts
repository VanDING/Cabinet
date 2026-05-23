export interface QualityResult {
  passed: boolean;
  score: number; // 0.0 - 1.0
  missing: string[]; // missing sections
  feedback: string;
}

export class QualityGate {
  checkHEI(output: string): QualityResult {
    const missing: string[] = [];
    let score = 1.0;

    // Full match: clear section / structured claim
    const hasHypothesis = /假设|Hypothesis|hypothesis|主张|论点/i.test(output);
    const hasEvidence = /证据|Evidence|evidence|支持|数据|来源/i.test(output);
    const hasImpact = /影响|Impact|impact|后果|风险|结果|outcome/i.test(output);
    // Partial match: keyword mentioned but not in structured format
    const partialHypothesis = /认为|建议|recommend|propose/i.test(output);
    const partialEvidence = /根据|according|based on|例如|e\.g\./i.test(output);
    const partialImpact = /可能|might|may|could lead|导致/i.test(output);

    if (!hasHypothesis && !partialHypothesis) {
      missing.push('hypothesis');
      score -= 0.33;
    } else if (!hasHypothesis && partialHypothesis) {
      score -= 0.17; // partial credit
    }
    if (!hasEvidence && !partialEvidence) {
      missing.push('evidence');
      score -= 0.34;
    } else if (!hasEvidence && partialEvidence) {
      score -= 0.17;
    }
    if (!hasImpact && !partialImpact) {
      missing.push('impact');
      score -= 0.33;
    } else if (!hasImpact && partialImpact) {
      score -= 0.17;
    }

    return {
      passed: missing.length === 0,
      score: Math.max(0, Math.round(score * 100) / 100),
      missing,
      feedback:
        missing.length > 0
          ? `HEI check failed. Missing: ${missing.join(', ')}`
          : 'HEI format check passed.',
    };
  }
}
