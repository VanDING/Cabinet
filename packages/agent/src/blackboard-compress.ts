/**
 * Token-budget-aware snapshot compression for Blackboard system-prompt injection.
 */

function estimateTokens(text: string): number {
  // Same heuristic as ContextMonitor: CJK / 2 + other / 4
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (
      (cp >= 0x4e00 && cp <= 0x9fff) ||
      (cp >= 0x3400 && cp <= 0x4dbf) ||
      (cp >= 0x20000 && cp <= 0x2a6df) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0x3040 && cp <= 0x309f) ||
      (cp >= 0x30a0 && cp <= 0x30ff) ||
      (cp >= 0xac00 && cp <= 0xd7af)
    ) {
      cjk++;
    } else {
      other++;
    }
  }
  return Math.ceil(cjk / 2 + other / 4);
}

export interface CompressOptions {
  budget: number;
  maxEntryLength?: number;
  priorityTopics?: string[];
}

/**
 * Compress a snapshot string to fit within a token budget.
 * Strategy:
 *   1. Truncate individual entries to maxEntryLength
 *   2. Keep only priority topics if specified
 *   3. Drop oldest entries until under budget
 */
export function compressSnapshot(snapshot: string, options: CompressOptions): string {
  const { budget, maxEntryLength = 200 } = options;

  let lines = snapshot.split('\n');

  // Strategy 1: truncate long lines
  lines = lines.map((line) => {
    if (line.length > maxEntryLength && line.startsWith('- [')) {
      return line.slice(0, maxEntryLength) + '…';
    }
    return line;
  });

  // Strategy 2: if still over budget, drop oldest entries per topic
  const tokens = estimateTokens(lines.join('\n'));
  if (tokens <= budget) {
    return lines.join('\n');
  }

  // Collect entries per topic
  const topicBlocks: Map<string, string[]> = new Map();
  let currentTopic: string | null = null;
  for (const line of lines) {
    if (line.startsWith('## ')) {
      currentTopic = line.slice(3);
      topicBlocks.set(currentTopic, [line]);
    } else if (currentTopic) {
      topicBlocks.get(currentTopic)!.push(line);
    }
  }

  // Drop entries from non-priority topics first
  const priority = new Set(options.priorityTopics ?? ['discoveries', 'project']);
  const orderedTopics = Array.from(topicBlocks.keys()).sort((a, b) => {
    const pa = priority.has(a) ? 1 : 0;
    const pb = priority.has(b) ? 1 : 0;
    return pb - pa; // priority first
  });

  const resultLines: string[] = [];
  let remainingBudget = budget;

  for (const topic of orderedTopics) {
    const block = topicBlocks.get(topic)!;
    // Try to keep the topic header + most recent entries
    const header = block[0]!;
    const entries = block.slice(1);

    // Keep dropping oldest entries until under budget
    let kept = entries;
    while (true) {
      const candidate = [header, ...kept].join('\n');
      const t = estimateTokens(candidate);
      if (t <= remainingBudget || kept.length === 0) {
        if (t <= remainingBudget) {
          resultLines.push(header, ...kept);
          remainingBudget -= t;
        }
        break;
      }
      kept = kept.slice(1);
    }
  }

  return resultLines.join('\n').trim();
}

export function injectBlackboardSnapshot(
  snapshot: string,
  systemPrompt: string,
  budgetTokens: number,
): string {
  const estimated = estimateTokens(snapshot);

  if (estimated <= budgetTokens) {
    return systemPrompt + '\n\n[Shared Context]\n' + snapshot;
  }

  const compressed = compressSnapshot(snapshot, {
    budget: budgetTokens,
    priorityTopics: ['discoveries', 'project'],
  });
  return systemPrompt + '\n\n[Shared Context (compressed)]\n' + compressed;
}
