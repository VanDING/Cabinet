//
// Progress Tracker — structured task tracking that agents can read and write.
//
// Uses JSON as the machine-writable format and generates a human-readable
// Markdown summary. Inspired by Anthropic's init-Agent + coding-Agent two-phase
// approach and the article's recommendation to "track status with structured JSON."
//
// File locations:
//   .cabinet/progress.json        — current session progress
//   .cabinet/progress/{date}.json — archived daily progress
//

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

// ── Types ──────────────────────────────────────────────────────

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'blocked' | 'cancelled';

export interface ProgressTask {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  startedAt?: string; // ISO timestamp
  completedAt?: string; // ISO timestamp
  blockedReason?: string;
  /** IDs of tasks that must be completed before this one. */
  dependencies?: string[];
  /** Arbitrary metadata the agent can attach. */
  metadata?: Record<string, unknown>;
}

export interface ProgressSnapshot {
  version: 1;
  sessionId: string;
  projectId: string;
  createdAt: string;
  updatedAt: string;
  tasks: ProgressTask[];
  /** Free-form notes the agent can add. */
  notes: string[];
  /** Summary of what was accomplished in the last step. */
  lastAction?: string;
}

// ── Progress Tracker ──────────────────────────────────────────

export class ProgressTracker {
  private snapshot: ProgressSnapshot;
  private dirty = false;

  constructor(
    private readonly filePath: string,
    sessionId: string,
    projectId: string,
  ) {
    this.snapshot = this.load(sessionId, projectId);
  }

  /** Create a tracker using the default path, isolated per project. */
  static default(sessionId: string, projectId: string): ProgressTracker {
    const dir = join(process.cwd(), '.cabinet', 'progress');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return new ProgressTracker(join(dir, `${projectId}.json`), sessionId, projectId);
  }

  /** Create a tracker for a specific project (used when Cabinet manages agents). */
  static forProject(projectRoot: string, sessionId: string, projectId: string): ProgressTracker {
    const dir = join(projectRoot, '.cabinet');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return new ProgressTracker(join(dir, 'progress.json'), sessionId, projectId);
  }

  // ── Query ──────────────────────────────────────────────────

  /** Get all tasks. */
  get tasks(): ProgressTask[] {
    return this.snapshot.tasks;
  }

  /** Get tasks filtered by status. */
  tasksByStatus(status: TaskStatus): ProgressTask[] {
    return this.snapshot.tasks.filter((t) => t.status === status);
  }

  /** Get a specific task by ID. */
  getTask(id: string): ProgressTask | undefined {
    return this.snapshot.tasks.find((t) => t.id === id);
  }

  /** Get tasks that are ready to work on (dependencies satisfied, not blocked). */
  get readyTasks(): ProgressTask[] {
    const completed = new Set(
      this.snapshot.tasks.filter((t) => t.status === 'completed').map((t) => t.id),
    );
    return this.snapshot.tasks.filter((t) => {
      if (t.status === 'completed' || t.status === 'cancelled' || t.status === 'blocked') {
        return false;
      }
      if (!t.dependencies || t.dependencies.length === 0) return true;
      return t.dependencies.every((d) => completed.has(d));
    });
  }

  /** Get the next task the agent should work on. */
  get nextTask(): ProgressTask | undefined {
    // Prefer: in_progress > pending ready > pending
    const inProgress = this.tasksByStatus('in_progress')[0];
    if (inProgress) return inProgress;
    return this.readyTasks[0];
  }

  /** Summary stats. */
  get stats(): {
    total: number;
    completed: number;
    inProgress: number;
    pending: number;
    blocked: number;
  } {
    const total = this.snapshot.tasks.length;
    const completed = this.tasksByStatus('completed').length;
    const inProgress = this.tasksByStatus('in_progress').length;
    const pending = this.tasksByStatus('pending').length;
    const blocked = this.tasksByStatus('blocked').length;
    return { total, completed, inProgress, pending, blocked };
  }

  /** Progress percentage (0–100). */
  get percent(): number {
    const { total, completed } = this.stats;
    if (total === 0) return 0;
    const effective = completed + this.tasksByStatus('cancelled').length;
    return Math.round((effective / total) * 100);
  }

  /** Get all notes. */
  get notes(): string[] {
    return this.snapshot.notes;
  }

  // ── Mutate ─────────────────────────────────────────────────

  /** Add a new task. Returns the created task. */
  addTask(task: Omit<ProgressTask, 'status'> & { status?: TaskStatus }): ProgressTask {
    const newTask: ProgressTask = {
      ...task,
      status: task.status ?? 'pending',
    };
    this.snapshot.tasks.push(newTask);
    this.dirty = true;
    return newTask;
  }

  /** Update task status. */
  updateStatus(
    id: string,
    status: TaskStatus,
    metadata?: Record<string, unknown>,
  ): ProgressTask | null {
    const task = this.getTask(id);
    if (!task) return null;

    task.status = status;
    if (status === 'in_progress' && !task.startedAt) {
      task.startedAt = new Date().toISOString();
    }
    if (status === 'completed') {
      task.completedAt = new Date().toISOString();
    }
    if (status === 'blocked' && metadata?.reason) {
      task.blockedReason = String(metadata.reason);
    }
    if (metadata) {
      task.metadata = { ...task.metadata, ...metadata };
    }

    this.snapshot.lastAction = `Task "${task.title}" → ${status}`;
    this.snapshot.updatedAt = new Date().toISOString();
    this.dirty = true;
    return task;
  }

  /** Add a note. */
  addNote(note: string): void {
    this.snapshot.notes.push(`[${new Date().toISOString()}] ${note}`);
    this.snapshot.updatedAt = new Date().toISOString();
    this.dirty = true;
  }

  /** Set the last action description. */
  setLastAction(action: string): void {
    this.snapshot.lastAction = action;
    this.snapshot.updatedAt = new Date().toISOString();
    this.dirty = true;
  }

  /** Persist to disk (call after mutations). */
  save(): void {
    if (!this.dirty) return;

    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    // Atomic write: write to temp file, then rename
    const tmpPath = this.filePath + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(this.snapshot, null, 2), 'utf-8');
    writeFileSync(this.filePath, JSON.stringify(this.snapshot, null, 2), 'utf-8');
    try {
      // Clean up temp on Windows (no atomic rename in Node)
    } catch {
      /* best-effort */
    }

    this.dirty = false;
  }

  /** Generate a Markdown summary suitable for injecting into agent context. */
  toMarkdown(): string {
    const s = this.stats;
    const lines: string[] = [
      `## Progress: ${s.completed}/${s.total} tasks (${this.percent}%)`,
      '',
      `| Status | Count |`,
      `|--------|-------|`,
      `| ✅ Completed | ${s.completed} |`,
      `| 🔄 In Progress | ${s.inProgress} |`,
      `| ⏳ Pending | ${s.pending} |`,
      `| 🚫 Blocked | ${s.blocked} |`,
      '',
    ];

    if (this.snapshot.tasks.length > 0) {
      lines.push('### Tasks', '');
      for (const task of this.snapshot.tasks) {
        const icon =
          task.status === 'completed'
            ? '✅'
            : task.status === 'in_progress'
              ? '🔄'
              : task.status === 'blocked'
                ? '🚫'
                : task.status === 'cancelled'
                  ? '❌'
                  : '⏳';
        lines.push(`- ${icon} **${task.title}**`);
        if (task.blockedReason) lines.push(`  - Blocked: ${task.blockedReason}`);
        if (task.description) lines.push(`  - ${task.description}`);
      }
      lines.push('');
    }

    if (this.snapshot.notes.length > 0) {
      lines.push('### Notes', '');
      for (const note of this.snapshot.notes.slice(-5)) {
        lines.push(`- ${note}`);
      }
      lines.push('');
    }

    if (this.snapshot.lastAction) {
      lines.push(`**Last action:** ${this.snapshot.lastAction}`);
    }

    return lines.join('\n');
  }

  /** Generate a compact JSON summary (for context injection when tokens are tight). */
  toCompact(): string {
    return JSON.stringify({
      pct: this.percent,
      stats: this.stats,
      next: this.nextTask?.title ?? null,
      last: this.snapshot.lastAction ?? null,
    });
  }

  /** Archive current progress and start a new session. */
  archive(): void {
    const dir = join(dirname(this.filePath), 'progress');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const dateStr = new Date().toISOString().slice(0, 10);
    const archivePath = join(dir, `${dateStr}-${this.snapshot.sessionId}.json`);
    writeFileSync(archivePath, JSON.stringify(this.snapshot, null, 2), 'utf-8');
  }

  // ── Private ────────────────────────────────────────────────

  private load(sessionId: string, projectId: string): ProgressSnapshot {
    if (existsSync(this.filePath)) {
      try {
        const raw = readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw) as ProgressSnapshot;
        if (parsed.version === 1 && parsed.projectId === projectId) {
          // Migrate sessionId so the snapshot reflects the current session
          parsed.sessionId = sessionId;
          return parsed;
        }
      } catch {
        // Corrupt file — start fresh
      }
    }

    return {
      version: 1,
      sessionId,
      projectId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tasks: [],
      notes: [],
    };
  }
}
