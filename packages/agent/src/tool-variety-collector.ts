export interface ToolVarietySnapshot {
  sessionId: string;
  exposedTools: number;
  usedTools: number;
  uniqueToolsPerStepAvg: number;
  gapRatio: number; // exposed / used
  topTools: [string, number][]; // top 5 by usage count
}

export function collectToolVariety(
  sessionId: string,
  toolCallHistory: { name: string }[],
  totalExposedTools: number,
): ToolVarietySnapshot {
  const usedNames = new Set(toolCallHistory.map((tc) => tc.name));
  const freq = new Map<string, number>();
  for (const tc of toolCallHistory) {
    freq.set(tc.name, (freq.get(tc.name) ?? 0) + 1);
  }
  return {
    sessionId,
    exposedTools: totalExposedTools,
    usedTools: usedNames.size,
    uniqueToolsPerStepAvg: toolCallHistory.length > 0 ? usedNames.size / toolCallHistory.length : 0,
    gapRatio: usedNames.size > 0 ? totalExposedTools / usedNames.size : Infinity,
    topTools: [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
  };
}
