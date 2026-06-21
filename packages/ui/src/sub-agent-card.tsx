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
    label: 'Running',
    border: 'border-accent',
    bg: 'bg-accent-muted',
    icon: '●',
  },
  completed: {
    label: 'Completed',
    border: 'border-intent-success',
    bg: 'bg-intent-success-muted',
    icon: '✓',
  },
  error: {
    label: 'Error',
    border: 'border-intent-danger',
    bg: 'bg-intent-danger-muted',
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
    <div className={`mt-2 rounded-lg border ${config.border} ${config.bg} p-3 transition-all`}>
      {/* Header */}
      <button onClick={handleToggle} className="flex w-full items-center justify-between text-left">
        <div className="flex items-center gap-2">
          <span
            className={`text-sm ${isRunning ? 'text-accent animate-pulse' : activity.status === 'error' ? 'text-intent-danger' : 'text-intent-success'}`}
          >
            {config.icon}
          </span>
          <span className="text-content-primary text-sm font-medium">{activity.agentName}</span>
          <span className="text-content-tertiary rounded-sm px-1.5 py-0.5 text-xs">
            {config.label}
          </span>
        </div>
        <span className="text-content-tertiary text-xs">{expanded ? 'Collapse' : 'Expand'}</span>
      </button>

      {/* Summary line */}
      {!expanded && activity.result && visibility !== 'summary' && (
        <p className="text-content-tertiary mt-1 line-clamp-2 text-xs">
          {activity.result.slice(0, 200)}
          {activity.result.length > 200 ? '…' : ''}
        </p>
      )}

      {/* Expanded content */}
      {expanded && visibility === 'detailed' && (
        <div className="mt-2 space-y-2">
          {activity.thinking && activity.thinking.length > 0 && (
            <div>
              <div className="text-content-tertiary text-xs font-medium">Thinking process</div>
              <div className="border-border bg-surface-primary mt-1 max-h-40 overflow-y-auto rounded-sm border p-2 whitespace-pre-wrap">
                <p className="text-content-secondary text-xs">{activity.thinking.join('')}</p>
              </div>
            </div>
          )}

          {activity.toolCalls && activity.toolCalls.length > 0 && (
            <div className="mt-2">
              <div className="text-content-tertiary flex flex-wrap items-center gap-1.5 text-[10px]">
                <button
                  onClick={() => setToolCallsExpanded(!toolCallsExpanded)}
                  className="hover:bg-surface-muted inline-flex items-center gap-1 rounded-sm px-1 py-0.5 transition-colors"
                >
                  <span>{toolCallsExpanded ? '▼' : '▶'}</span>
                  Tool calls ({activity.toolCalls.length})
                </button>
                {!toolCallsExpanded &&
                  activity.toolCalls.slice(0, 4).map((tc, i) => (
                    <span
                      key={i}
                      className="bg-surface-muted inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5"
                    >
                      <span className="text-content-secondary font-mono">{tc.name}</span>
                    </span>
                  ))}
                {!toolCallsExpanded && activity.toolCalls.length > 4 && (
                  <span className="text-content-tertiary">+{activity.toolCalls.length - 4}</span>
                )}
              </div>
              {toolCallsExpanded && (
                <div className="border-border bg-surface-elevated mt-1 space-y-1 rounded-sm border p-2">
                  {activity.toolCalls.map((tc, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <span className="text-content-secondary mt-0.5 font-mono">{tc.name}</span>
                      <span className="text-content-tertiary truncate">
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
              <div className="text-content-tertiary text-xs font-medium">Result</div>
              <p className="text-content-secondary mt-1 max-h-40 overflow-y-auto text-xs whitespace-pre-wrap">
                {activity.result}
              </p>
            </div>
          )}

          {activity.error && (
            <div>
              <div className="text-intent-danger text-xs font-medium">Error</div>
              <p className="text-intent-danger mt-1 text-xs">{activity.error}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
