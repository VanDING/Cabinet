import type { StructuredOutput, TaskListData, TaskItem } from '@cabinet/types';
import { Card, CardContent, CardFooter } from
  '../../../apps/desktop/src/components/ui/card.js';
import { Button } from
  '../../../apps/desktop/src/components/ui/button.js';

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

const statusIcons: Record<string, string> = { pending: '☐', running: '🔄', done: '✅' };
const statusClasses: Record<string, string> = {
  pending: 'text-content-tertiary', running: 'text-accent', done: 'text-intent-success line-through',
};

export function TaskCard({ output, onConfirm, onAdjust, onAddTask, onToggleTask }: TaskCardProps) {
  const data = getData(output);
  const isConfirmed = output.status !== 'proposed';

  return (
    <Card className="my-3">
      <CardContent>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-content-primary text-sm font-semibold">📅 {data.title}</span>
          {isConfirmed ? (
            <span className="bg-[var(--intent-success-muted)] text-[var(--intent-success)] rounded px-2 py-0.5 text-xs">
              ✅ Confirmed
            </span>
          ) : (
            <span className="bg-[var(--accent-muted)] text-[var(--accent)] rounded px-2 py-0.5 text-xs">
              {data.tasks.length} tasks
            </span>
          )}
        </div>

        <div className="divide-border-subtle divide-y">
          {data.tasks.map((task) => (
            <div key={task.id} className="flex items-center justify-between py-1.5 first:pt-0 last:pb-0">
              <div className="flex items-center gap-2">
                {onToggleTask && !isConfirmed ? (
                  <button onClick={() => onToggleTask(output.id, task.id)}
                          className="text-sm hover:opacity-80">{statusIcons[task.status]}</button>
                ) : (
                  <span className="text-sm">{statusIcons[task.status]}</span>
                )}
                <span className={`text-xs ${statusClasses[task.status] ?? ''}`}>{task.title}</span>
              </div>
              <div className="text-content-tertiary flex items-center gap-2 text-xs">
                <span>{task.assignee}</span>
                {task.dueBy && <span>📋 {task.dueBy}</span>}
              </div>
            </div>
          ))}
        </div>

        {!isConfirmed && (
          <CardFooter className="flex gap-2 px-0 pt-3">
            {onConfirm && <Button onClick={() => onConfirm(output.id, data.tasks)}>✅ Confirm Plan</Button>}
            {onAdjust && <Button variant="outline" onClick={() => onAdjust(output.id)}>🕐 Adjust Timing</Button>}
            {onAddTask && <Button variant="ghost" onClick={() => onAddTask(output.id)}>＋ Add Task</Button>}
          </CardFooter>
        )}
      </CardContent>
    </Card>
  );
}
