import { useState } from 'react';
import type { StructuredOutput, TaskListData, TaskItem } from '@cabinet/types';

export interface TaskCardProps {
  output: StructuredOutput;
  onConfirm?: (outputId: string, tasks: TaskItem[]) => void;
  onAdjust?: (outputId: string) => void;
  onAddTask?: (outputId: string) => void;
  onToggleTask?: (outputId: string, taskId: string) => void;
}

function getData(output: StructuredOutput): TaskListData {
  return output.data as unknown as TaskListData;
}

const statusIcons: Record<string, string> = {
  pending: '☐',
  running: '🔄',
  done: '✅',
};

const statusClasses: Record<string, string> = {
  pending: 'text-content-tertiary',
  running: 'text-accent',
  done: 'text-intent-success line-through',
};

export function TaskCard({
  output,
  onConfirm,
  onAdjust,
  onAddTask,
  onToggleTask,
}: TaskCardProps) {
  const data = getData(output);
  const isConfirmed = output.status !== 'proposed';

  return (
    <div className="my-3 rounded-lg border border-border bg-surface-primary p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-content-primary">📅 {data.title}</span>
        {isConfirmed ? (
          <span className="rounded bg-intent-success-muted px-2 py-0.5 text-xs text-intent-success">
            ✅ Confirmed
          </span>
        ) : (
          <span className="rounded bg-accent-muted px-2 py-0.5 text-xs text-accent">
            {data.tasks.length} tasks
          </span>
        )}
      </div>

      <div className="divide-y divide-border-subtle">
        {data.tasks.map((task) => (
          <div
            key={task.id}
            className="flex items-center justify-between py-1.5 first:pt-0 last:pb-0"
          >
            <div className="flex items-center gap-2">
              {onToggleTask && !isConfirmed ? (
                <button
                  onClick={() => onToggleTask(output.id, task.id)}
                  className="text-sm hover:opacity-80"
                >
                  {statusIcons[task.status]}
                </button>
              ) : (
                <span className="text-sm">{statusIcons[task.status]}</span>
              )}
              <span className={`text-xs ${statusClasses[task.status] ?? ''}`}>
                {task.title}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-content-tertiary">
              <span>{task.assignee}</span>
              {task.dueBy && <span>📋 {task.dueBy}</span>}
            </div>
          </div>
        ))}
      </div>

      {!isConfirmed && (
        <div className="mt-3 flex gap-2">
          {onConfirm && (
            <button
              onClick={() => onConfirm(output.id, data.tasks)}
              className="rounded bg-intent-success px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
            >
              ✅ Confirm Plan
            </button>
          )}
          {onAdjust && (
            <button
              onClick={() => onAdjust(output.id)}
              className="rounded border border-border px-3 py-1.5 text-xs text-content-secondary hover:bg-surface-elevated"
            >
              🕐 Adjust Timing
            </button>
          )}
          {onAddTask && (
            <button
              onClick={() => onAddTask(output.id)}
              className="rounded px-3 py-1.5 text-xs text-content-tertiary hover:text-content-secondary"
            >
              ＋ Add Task
            </button>
          )}
        </div>
      )}
    </div>
  );
}
