// Feedback store — route learning with in-memory cache + SQLite persistence.
// Extracted from agents.ts.

import { getServerContext } from '../../../context.js';
import type { FeedbackStore } from '@cabinet/secretary';

export const routeFeedbackStore: {
  message: string;
  routedAgent: string;
  correct: boolean;
  timestamp: Date;
  previousRoute?: string;
}[] = [];
export let feedbackStoreLoaded = false;

export function loadFeedbackStore(): void {
  if (feedbackStoreLoaded) return;
  try {
    const ctx = getServerContext();
    const rows = ctx.routeFeedbackRepo.findAll();
    for (const row of rows) {
      routeFeedbackStore.push({
        message: row.message,
        routedAgent: row.routed_agent,
        correct: row.correct === 1,
        timestamp: new Date(row.timestamp),
        previousRoute: row.previous_route ?? undefined,
      });
    }
  } catch {
    /* best-effort: use empty cache if DB unavailable */
  }
  feedbackStoreLoaded = true;
}

export const feedbackStore: FeedbackStore = {
  async store(feedback) {
    loadFeedbackStore();
    routeFeedbackStore.push(feedback);
    if (routeFeedbackStore.length > 5000) {
      routeFeedbackStore.shift();
    }
    // Persist to DB (fire-and-forget)
    try {
      const ctx = getServerContext();
      ctx.routeFeedbackRepo.insert({
        message: feedback.message,
        routed_agent: feedback.routedAgent,
        correct: feedback.correct,
        previous_route: feedback.previousRoute,
      });
    } catch {
      /* best-effort persist */
    }
  },
  async query(previousRoute, correct, limit = 10) {
    loadFeedbackStore();
    const matches = routeFeedbackStore
      .filter((f) => f.previousRoute === previousRoute && f.correct === correct)
      .reduce(
        (acc, f) => {
          acc[f.routedAgent] = (acc[f.routedAgent] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );
    return Object.entries(matches)
      .map(([targetAgent, count]) => ({ targetAgent, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  },
};
