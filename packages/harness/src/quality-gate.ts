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

    const hasHypothesis = /假设|Hypothesis|hypothesis/i.test(output);
    const hasEvidence = /证据|Evidence|evidence|支持/i.test(output);
    const hasImpact = /影响|Impact|impact|后果|风险/i.test(output);

    if (!hasHypothesis) {
      missing.push('hypothesis');
      score -= 0.33;
    }
    if (!hasEvidence) {
      missing.push('evidence');
      score -= 0.34;
    }
    if (!hasImpact) {
      missing.push('impact');
      score -= 0.33;
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
