import { useState } from 'react';

export type SubAgentStatus = 'running' | 'completed' | 'error';

export interface SubAgentActivity {
  agentName: string;
  status: SubAgentStatus;
  taskDescription: string;
  thinking?: string[];
  toolCalls?: { name: string; args: Record<string, unknown>; result?: unknown }[];
  result?: string;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
}

export interface SubAgentCardProps {
  activity: SubAgentActivity;
  visibility?: 'detailed' | 'summary' | 'hidden';
  onToggle?: () => void;
}

const statusConfig: Record<
  SubAgentStatus,
  { label: string; border: string; bg: string; icon: string }
> = {
  running: {
    label: '运行中',
    border: 'border-blue-300',
    bg: 'bg-blue-50',
    icon: '●',
  },
  completed: {
    label: '已完成',
    border: 'border-green-300',
    bg: 'bg-green-50',
    icon: '✓',
  },
  error: {
    label: '出错',
    border: 'border-red-300',
    bg: 'bg-red-50',
    icon: '✕',
  },
};

export function SubAgentCard({ activity, visibility = 'detailed', onToggle }: SubAgentCardProps) {
  const [expanded, setExpanded] = useState(
    activity.status === 'running' || activity.status === 'error',
  );
  const [toolCallsExpanded, setToolCallsExpanded] = useState(false);

  if (visibility === 'hidden') return null;

  const config = statusConfig[activity.status];
  const isRunning = activity.status === 'running';

  const handleToggle = () => {
    setExpanded((prev) => !prev);
    onToggle?.();
  };

  return (
    <div
      className={`mt-2 rounded-lg border ${config.border} ${config.bg} dark:border-opacity-30 p-3 transition-all`}
    >
      {/* Header */}
      <button onClick={handleToggle} className="flex w-full items-center justify-between text-left">
        <div className="flex items-center gap-2">
          <span
            className={`text-sm ${isRunning ? 'animate-pulse text-blue-600' : activity.status === 'error' ? 'text-red-600' : 'text-green-600'}`}
          >
            {config.icon}
          </span>
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
            {activity.agentName}
          </span>
          <span className="rounded px-1.5 py-0.5 text-xs text-gray-500 dark:text-gray-400">
            {config.label}
          </span>
        </div>
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {expanded ? '收起' : '展开'}
        </span>
      </button>

      {/* Summary line */}
      {!expanded && activity.result && visibility !== 'summary' && (
        <p className="mt-1 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">
          {activity.result.slice(0, 200)}
          {activity.result.length > 200 ? '…' : ''}
        </p>
      )}

      {/* Expanded content */}
      {expanded && visibility === 'detailed' && (
        <div className="mt-2 space-y-2">
          {activity.thinking && activity.thinking.length > 0 && (
            <div>
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400">思考过程</div>
              <div className="mt-1 max-h-40 overflow-y-auto rounded border border-gray-200 bg-white p-2 whitespace-pre-wrap dark:border-gray-700 dark:bg-gray-900">
                <p className="text-xs text-gray-600 dark:text-gray-300">
                  {activity.thinking.join('')}
                </p>
              </div>
            </div>
          )}

          {activity.toolCalls && activity.toolCalls.length > 0 && (
            <div className="mt-2">
              <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-400">
                <button
                  onClick={() => setToolCallsExpanded(!toolCallsExpanded)}
                  className="inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  <span>{toolCallsExpanded ? '▼' : '▶'}</span>
                  工具调用 ({activity.toolCalls.length})
                </button>
                {!toolCallsExpanded &&
                  activity.toolCalls.slice(0, 4).map((tc, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-800"
                    >
                      <span className="font-mono text-gray-700 dark:text-gray-300">{tc.name}</span>
                    </span>
                  ))}
                {!toolCallsExpanded && activity.toolCalls.length > 4 && (
                  <span className="text-gray-400">+{activity.toolCalls.length - 4}</span>
                )}
              </div>
              {toolCallsExpanded && (
                <div className="mt-1 space-y-1 rounded border border-gray-200 bg-gray-50 p-2 dark:border-gray-700 dark:bg-gray-800/60">
                  {activity.toolCalls.map((tc, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <span className="mt-0.5 font-mono text-gray-700 dark:text-gray-300">
                        {tc.name}
                      </span>
                      <span className="truncate text-gray-500 dark:text-gray-400">
                        {Object.entries(tc.args)
                          .map(([k, v]) => `${k}=${String(v).slice(0, 40)}`)
                          .join(', ')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activity.result && (
            <div>
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400">结果</div>
              <p className="mt-1 max-h-40 overflow-y-auto text-xs whitespace-pre-wrap text-gray-700 dark:text-gray-300">
                {activity.result}
              </p>
            </div>
          )}

          {activity.error && (
            <div>
              <div className="text-xs font-medium text-red-500">错误</div>
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">{activity.error}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
