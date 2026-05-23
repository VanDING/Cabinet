export type TaskStatus = 'pending' | 'running' | 'done' | 'error';

export interface AgentTask {
  id: string;
  name: string;
  status: TaskStatus;
  startTime?: number;
  endTime?: number;
}

export class TaskTracker {
  private tasks: AgentTask[] = [];

  addTask(name: string): string {
    const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.tasks.push({ id, name, status: 'running', startTime: Date.now() });
    return id;
  }

  completeTask(id: string, success = true) {
    const task = this.tasks.find((t) => t.id === id);
    if (task) {
      task.status = success ? 'done' : 'error';
      task.endTime = Date.now();
    }
  }

  getTasks(): AgentTask[] {
    return [...this.tasks];
  }

  clear() {
    this.tasks = [];
  }
}
