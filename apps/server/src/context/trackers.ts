// File and Task trackers — extracted from context.ts (Phase 1.2 split).

export interface RecentFileEntry {
  path: string;
  operation: 'read' | 'write' | 'edit' | 'delete' | 'move' | 'copy';
  timestamp: string;
}

export class FileAccessTracker {
  private entries = new Map<string, RecentFileEntry[]>();
  private maxEntries = 100;

  record(sessionId: string, path: string, operation: RecentFileEntry['operation']): void {
    if (!this.entries.has(sessionId)) {
      this.entries.set(sessionId, []);
    }
    const list = this.entries.get(sessionId)!;
    list.push({ path, operation, timestamp: new Date().toISOString() });
    if (list.length > this.maxEntries) {
      list.splice(0, list.length - this.maxEntries);
    }
  }

  getRecent(sessionId: string, limit = 20): RecentFileEntry[] {
    const list = this.entries.get(sessionId);
    if (!list) return [];
    return list.slice(-limit).reverse();
  }

  clear(sessionId: string): void {
    this.entries.delete(sessionId);
  }
}

export class TaskTracker {
  private tasks: Array<{
    id: string;
    name: string;
    agentName?: string;
    description?: string;
    status: string;
    startTime: number;
    endTime?: number;
  }> = [];

  addTask(name: string, agentName?: string, description?: string): string {
    const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.tasks.push({ id, name, agentName, description, status: 'running', startTime: Date.now() });
    return id;
  }

  completeTask(id: string, success = true) {
    const task = this.tasks.find((t) => t.id === id);
    if (task) {
      task.status = success ? 'done' : 'error';
      task.endTime = Date.now();
    }
  }

  getTask(id: string) {
    return this.tasks.find((t) => t.id === id) ?? null;
  }

  listActive() {
    return this.tasks.filter((t) => t.status === 'running');
  }
}
