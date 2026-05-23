import type { EntityMemory } from '@cabinet/memory';

export interface CaptainPreferenceProfile {
  riskTolerance: 'low' | 'medium' | 'high';
  costSensitivity: 'low' | 'medium' | 'high';
  timeUrgency: 'relaxed' | 'moderate' | 'urgent';
  preferredDecisionStyle: 'consensus' | 'directive' | 'analytical';
  commonRejectionReasons: string[];
  domainPreferences: Record<string, string>;
  confidence: number;
}

export type PreferenceAnalysisCallback = (
  captainId: string,
  decisionHistory: Array<{
    title: string;
    action: string;
    chosenOptionId?: string;
    timestamp: string;
  }>,
  existingPreferences: Record<string, unknown>,
) => Promise<CaptainPreferenceProfile>;

export class PreferenceLearner {
  constructor(
    private readonly entity: EntityMemory,
    private readonly analyzeCallback: PreferenceAnalysisCallback,
  ) {}

  async learnFromDecisions(captainId: string): Promise<CaptainPreferenceProfile> {
    const existing = this.entity.getPreferences(captainId);
    const existingPrefs = existing?.preferences ?? {};
    const history =
      (existingPrefs.decisionHistory as Array<{
        title: string;
        action: string;
        chosenOptionId?: string;
        timestamp: string;
      }>) ?? [];

    if (history.length < 5) return PreferenceLearner.defaultProfile();

    const lastAnalyzed = existingPrefs.lastPreferenceAnalysis as string | undefined;
    if (lastAnalyzed) {
      const elapsed = Date.now() - new Date(lastAnalyzed).getTime();
      if (elapsed < 24 * 60 * 60 * 1000) {
        return (
          (existingPrefs.preferenceProfile as CaptainPreferenceProfile) ??
          PreferenceLearner.defaultProfile()
        );
      }
    }

    const profile = await this.analyzeCallback(captainId, history, existingPrefs);

    this.entity.setPreferences(captainId, existing?.name ?? 'Captain', {
      ...existingPrefs,
      preferenceProfile: profile,
      lastPreferenceAnalysis: new Date().toISOString(),
    });

    return profile;
  }

  static defaultProfile(): CaptainPreferenceProfile {
    return {
      riskTolerance: 'medium',
      costSensitivity: 'medium',
      timeUrgency: 'moderate',
      preferredDecisionStyle: 'analytical',
      commonRejectionReasons: [],
      domainPreferences: {},
      confidence: 0,
    };
  }
}
