import { memo, useState } from 'react';

export interface AgentTask {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'done' | 'error';
  startTime?: number;
  endTime?: number;
}

export interface SemanticTask {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'done' | 'error';
  steps?: number;
}

interface Props {
  tasks?: AgentTask[];
  semanticTasks?: SemanticTask[];
}

const cardClasses =
  'mb-2 rounded-lg border border-border bg-surface-primary/90 p-2 shadow-xs backdrop-blur-xs';
const subtextClasses = 'text-content-tertiary';
const textClasses = 'text-content-primary';

export const TaskPanel = memo(function TaskPanel({ tasks, semanticTasks }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const displaySemantic = semanticTasks && semanticTasks.length > 0;
  const activeTasks = displaySemantic ? semanticTasks : tasks;
  if (!activeTasks || activeTasks.length === 0) return null;

  const running = activeTasks.filter((t) => t.status === 'running').length;
  const done = activeTasks.filter((t) => t.status === 'done').length;
  const errors = activeTasks.filter((t) => t.status === 'error').length;

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className={cardClasses}>
      <div className="mb-1.5 flex items-center justify-between">
        <span className={`text-[10px] font-semibold uppercase tracking-wider ${subtextClasses}`}>
          {displaySemantic ? '任务进度' : 'Tasks'}
        </span>
        <span className={`text-[10px] ${subtextClasses}`}>
          {done}
          <span className="text-intent-success">✓</span>
          {running > 0 && (
            <span>
              {' '}
              · {running}
              <span className="text-accent">⟳</span>
            </span>
          )}
          {errors > 0 && (
            <span>
              {' '}
              · {errors}
              <span className="text-intent-danger">✕</span>
            </span>
          )}
        </span>
      </div>
      <div className="space-y-1">
        {activeTasks.map((task) => {
          const isExpanded = expanded.has(task.id);
          const isSemantic = displaySemantic;
          const title = isSemantic ? (task as SemanticTask).title : (task as AgentTask).name;
          const steps = isSemantic ? (task as SemanticTask).steps : undefined;

          return (
            <div key={task.id} className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-[10px]">
                  {task.status === 'done' && <span className="text-intent-success">✅</span>}
                  {task.status === 'running' && <span className="text-accent">⟳</span>}
                  {task.status === 'error' && <span className="text-intent-danger">✕</span>}
                  {task.status === 'pending' && <span className="text-content-tertiary">○</span>}
                </span>
                <span
                  className={`truncate text-[10px] ${
                    task.status === 'done'
                      ? `${subtextClasses} line-through opacity-60`
                      : task.status === 'error'
                        ? 'text-intent-danger'
                        : textClasses
                  }`}
                >
                  {title}
                </span>
                {steps !== undefined && steps > 0 && (
                  <span className={`ml-auto text-[10px] ${subtextClasses}`}>{steps}步</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
