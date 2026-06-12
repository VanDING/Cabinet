import { broadcast } from '../ws/handler.js';
import type { CuratorDeps, CuratorTimers, EnqueueCuratorTask } from './curator-types.js';

export interface CuratorTaskFns {
  runCuratorConsolidation: (sessionId: string, transcript: string) => Promise<void>;
  runCuratorPatternExtraction: () => Promise<void>;
}

export function createTimerSetup(
  deps: CuratorDeps,
  tasks: CuratorTaskFns,
  enqueue: EnqueueCuratorTask,
) {
  const { logger, sessionManager } = deps;

  return function setupTimers(): CuratorTimers {
    // Curator self-nudge: runs every 4 hours
    const curatorNudge = setInterval(
      async () => {
        if (!deps.gateway) return;
        try {
          const sessions = sessionManager.list();
          for (const s of sessions) {
            if (s.messages.length > 0) {
              const messages = s.messages.map((m) => `${m.role}: ${m.content}`).join('\n');
              if (messages.length > 200) {
                await enqueue(() => tasks.runCuratorConsolidation(s.id, messages), 'nudge', 'low');
              }
            }
          }
        } catch (e) {
          logger.warn('Curator nudge failed', { error: (e as Error).message });
          broadcast('background_error', { task: 'curator_nudge', error: (e as Error).message });
        }
      },
      4 * 60 * 60 * 1000,
    );
    curatorNudge.unref();
    logger.info('Curator self-nudge scheduled (4h)');

    // Curator cross-session pattern extraction: runs every 6 hours
    const curatorPattern = setInterval(
      async () => {
        if (!deps.gateway) return;
        try {
          await enqueue(() => tasks.runCuratorPatternExtraction(), 'pattern', 'low');
        } catch (e) {
          logger.warn('Curator pattern extraction failed', { error: (e as Error).message });
          broadcast('background_error', { task: 'curator_pattern', error: (e as Error).message });
        }
      },
      6 * 60 * 60 * 1000,
    );
    curatorPattern.unref();
    logger.info('Curator pattern extraction scheduled (6h)');

    // Subconscious loop: via Curator queue every hour
    const subconscious = setInterval(
      () => {
        enqueue(
          async () => {
            await deps.subconsciousLoop.tick();
            logger.info('Curator: subconscious loop tick completed');
          },
          'subconscious',
          'low',
        );
      },
      60 * 60 * 1000,
    );
    subconscious.unref();
    logger.info('Curator: subconscious loop scheduled (1h)');

    // Harness analysis: via Curator queue every 3 hours
    const harnessAnalyst = setInterval(
      () => {
        enqueue(
          async () => {
            const insight = await deps.harnessAnalyst.analyze();
            if (insight) {
              logger.info('Curator: harness analysis generated insight');
              broadcast('subconscious_insight', {
                text: insight,
                relevance: 0.9,
                relatedEntities: [],
                timestamp: new Date().toISOString(),
              });
            }
          },
          'harness_analysis',
          'low',
        );
      },
      3 * 60 * 60 * 1000,
    );
    harnessAnalyst.unref();
    logger.info('Curator: harness analyst scheduled (3h)');

    return { curatorNudge, curatorPattern, subconscious, harnessAnalyst };
  };
}
