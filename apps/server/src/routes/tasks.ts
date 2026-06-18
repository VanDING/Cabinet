import { Hono } from 'hono';
import { getServerContext } from '../context.js';

export const tasksRouter = new Hono();

tasksRouter.get('/kanban', (c) => {
  const { db, logger } = getServerContext();
  const projectId = c.req.query('projectId');

  try {
    interface TaskRow {
      id: string;
      title: string;
      status: string;
      priority: string;
      agent_id: string;
      task_type: string;
      created_at: string;
    }

    let rows: TaskRow[];
    if (projectId) {
      rows = db
        .prepare(
          'SELECT id, title, status, priority, agent_id, task_type, created_at FROM agent_task_queue WHERE project_id = ? ORDER BY created_at DESC',
        )
        .all(projectId) as TaskRow[];
    } else {
      rows = db
        .prepare(
          'SELECT id, title, status, priority, agent_id, task_type, created_at FROM agent_task_queue ORDER BY created_at DESC LIMIT 50',
        )
        .all() as TaskRow[];
    }

    const kanban: Record<string, TaskRow[]> = {
      todo: [],
      in_progress: [],
      in_review: [],
      done: [],
    };

    const STATUS_MAP: Record<string, string> = {
      queued: 'todo',
      running: 'in_progress',
      completed: 'done',
      failed: 'done',
      review: 'in_review',
    };

    for (const row of rows) {
      const col = STATUS_MAP[row.status] ?? 'todo';
      if (kanban[col]) {
        kanban[col].push(row);
      }
    }

    return c.json({ kanban });
  } catch (err) {
    logger?.warn('Failed to load kanban tasks', { error: (err as Error).message });
    return c.json({ kanban: { todo: [], in_progress: [], in_review: [], done: [] } });
  }
});
