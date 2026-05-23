import { memo } from 'react';

export interface AgentTask {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'done' | 'error';
  startTime?: number;
  endTime?: number;
}

interface Props {
  tasks: AgentTask[];
  isDark?: boolean;
}

export const TaskPanel = memo(function TaskPanel({ tasks, isDark }: Props) {
  if (tasks.length === 0) return null;

  const running = tasks.filter((t) => t.status === 'running').length;
  const done = tasks.filter((t) => t.status === 'done').length;
  const errors = tasks.filter((t) => t.status === 'error').length;

  const bgClass = isDark ? 'bg-gray-800/90' : 'bg-white/90';
  const borderClass = isDark ? 'border-gray-700' : 'border-gray-200';
  const textClass = isDark ? 'text-gray-200' : 'text-gray-800';
  const subtextClass = isDark ? 'text-gray-400' : 'text-gray-500';

  return (
    <div className={`mb-2 rounded-lg border ${borderClass} ${bgClass} p-2 shadow-sm backdrop-blur-sm`}>
      <div className="mb-1.5 flex items-center justify-between">
        <span className={`text-[10px] font-semibold uppercase tracking-wider ${subtextClass}`}>
          Tasks
        </span>
        <span className={`text-[10px] ${subtextClass}`}>
          {done}<span className="text-green-500">✓</span>
          {running > 0 && <span> · {running}<span className="text-blue-500">⟳</span></span>}
          {errors > 0 && <span> · {errors}<span className="text-red-500">✕</span></span>}
        </span>
      </div>
      <div className="space-y-1">
        {tasks.map((task) => (
          <div key={task.id} className="flex items-center gap-2">
            <span className="flex-shrink-0 text-[10px]">
              {task.status === 'done' && <span className="text-green-500">✅</span>}
              {task.status === 'running' && <span className="text-blue-500">⟳</span>}
              {task.status === 'error' && <span className="text-red-500">✕</span>}
              {task.status === 'pending' && <span className="text-gray-400">○</span>}
            </span>
            <span
              className={`truncate text-[10px] ${
                task.status === 'done'
                  ? `${subtextClass} line-through opacity-60`
                  : task.status === 'error'
                    ? 'text-red-600 dark:text-red-400'
                    : textClass
              }`}
            >
              {task.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
});
