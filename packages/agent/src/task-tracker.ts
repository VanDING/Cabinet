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

// ── Semantic Task Tracker ──────────────────────────────────────

export interface SemanticTask {
  id: string;
  title: string;
  status: TaskStatus;
  steps: number;
  toolCallIds: string[];
  startTime?: number;
  endTime?: number;
}

/** Heuristic tool name → semantic category mapping. */
function categorizeTool(toolName: string): string {
  const name = toolName.toLowerCase().replace(/[-_]/g, '');
  const readTools = new Set([
    'readfile', 'read_file', 'fileinfo', 'file_info', 'listdirectory',
    'list_directory', 'glob', 'grep', 'searchfiles', 'searchfiles',
    'searchcontent', 'search_content', 'recentfiles', 'recent_files',
  ]);
  const writeTools = new Set([
    'writefile', 'write_file', 'editfile', 'edit_file', 'applypatch',
    'apply_patch', 'deletefile', 'delete_file', 'movefile', 'move_file',
    'copyfile', 'copy_file', 'makedirectory', 'make_directory',
  ]);
  const verifyTools = new Set(['test', 'lint', 'build', 'check', 'ci']);
  const fetchTools = new Set(['webfetch', 'web_fetch', 'httprequest', 'http_request']);

  if (readTools.has(name)) return 'analysis';
  if (writeTools.has(name)) return 'modification';
  if (fetchTools.has(name)) return 'external';
  if (name === 'execcommand' || name === 'exec_command') {
    // execCommand category depends on command content — caller must override
    return 'command';
  }
  return 'mixed';
}

/** Human-readable titles for categories. */
const CATEGORY_TITLES: Record<string, string | undefined> = {
  analysis: '分析代码结构',
  modification: '修改代码',
  verification: '运行验证',
  command: '执行命令',
  external: '获取外部信息',
  mixed: '综合处理',
};

export class SemanticTaskTracker {
  private tasks: SemanticTask[] = [];
  private currentCategory = '';

  private createId(): string {
    return `st_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  }

  /** Register a tool call. Returns the (possibly new) semantic task. */
  addToolCall(toolCallId: string, toolName: string, commandHint?: string): SemanticTask {
    let category = categorizeTool(toolName);
    if (category === 'command' && commandHint) {
      const lower = commandHint.toLowerCase();
      if (/(test|lint|build|check|verify)/.test(lower)) {
        category = 'verification';
      }
    }

    const needNewTask =
      this.tasks.length === 0 ||
      this.tasks[this.tasks.length - 1]!.status !== 'running' ||
      (this.currentCategory !== '' && this.currentCategory !== category && category !== 'mixed');

    if (needNewTask) {
      this.currentCategory = category;
      const newTask: SemanticTask = {
        id: this.createId(),
        title: (CATEGORY_TITLES[category] ?? CATEGORY_TITLES.mixed ?? '综合处理') as string,
        status: 'running',
        steps: 0,
        toolCallIds: [toolCallId],
        startTime: Date.now(),
      };
      this.tasks.push(newTask);
      return newTask;
    }

    const task = this.tasks[this.tasks.length - 1]!;
    task.toolCallIds.push(toolCallId);
    return task;
  }

  /** Mark the current task as completed when a step finishes. */
  completeCurrentStep() {
    const task = this.tasks[this.tasks.length - 1];
    if (task && task.status === 'running') {
      task.steps += 1;
    }
  }

  /** Finalize all running tasks (call when stream ends). */
  finalizeAll(success = true) {
    for (const task of this.tasks) {
      if (task.status === 'running') {
        task.status = success ? 'done' : 'error';
        task.endTime = Date.now();
      }
    }
  }

  getTasks(): SemanticTask[] {
    return [...this.tasks];
  }

  clear() {
    this.tasks = [];
    this.currentCategory = '';
  }
}
