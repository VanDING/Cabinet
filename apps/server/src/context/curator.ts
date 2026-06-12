/**
 * Curator subsystem — background knowledge consolidation, session briefs,
 * pattern extraction, and preference learning. Extracted from context.ts
 * to keep getServerContext() under the 500-line limit.
 */
import { createCuratorLoop } from './curator-loop.js';
import { createCuratorTasks } from './curator-tasks.js';
import { createTimerSetup } from './curator-timers.js';
import { createSessionWiring } from './curator-session.js';
import type { CuratorDeps, CuratorSubsystem, EnqueueCuratorTask } from './curator-types.js';

export type { CuratorDeps, CuratorSubsystem, CuratorTimers } from './curator-types.js';

export function setupCuratorSubsystem(deps: CuratorDeps): CuratorSubsystem {
  const { logger } = deps;

  // ── Curator dual-queue priority concurrency control ──

  let curatorBusy = false;
  const highPriorityQueue: Array<{ task: () => Promise<void>; label: string }> = [];
  const lowPriorityQueue: Array<{ task: () => Promise<void>; label: string }> = [];

  const enqueueCuratorTask: EnqueueCuratorTask = async (task, label, priority = 'low') => {
    if (curatorBusy) {
      const queue = priority === 'high' ? highPriorityQueue : lowPriorityQueue;
      const existingIdx = queue.findIndex((t) => t.label === label);
      if (existingIdx !== -1) {
        queue[existingIdx] = { task, label };
      } else {
        queue.push({ task, label });
      }
      return;
    }
    curatorBusy = true;
    try {
      await task();
    } finally {
      curatorBusy = false;
      const next = highPriorityQueue.shift() ?? lowPriorityQueue.shift();
      if (next) {
        enqueueCuratorTask(next.task, next.label, priority).catch((e) =>
          logger.warn('Curator queued task failed', {
            label: next.label,
            error: (e as Error).message,
          }),
        );
      }
    }
  };

  // ── Task, timer, and session wiring factories ──

  const createLoop = () =>
    createCuratorLoop(deps as unknown as Parameters<typeof createCuratorLoop>[0]);
  const tasks = createCuratorTasks(deps, createLoop, enqueueCuratorTask);
  const setupTimers = createTimerSetup(deps, tasks, enqueueCuratorTask);
  const wireSessionCallbacks = createSessionWiring(
    deps,
    tasks.runCuratorConsolidation,
    tasks.runCuratorBrief,
    enqueueCuratorTask,
  );

  // Wire immediately
  wireSessionCallbacks();

  return { setupTimers, handleDecisionUpdate: tasks.handleDecisionUpdate };
}
