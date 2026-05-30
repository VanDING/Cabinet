import { useState } from 'react';

export interface WorkflowRunData {
  runId: string;
  status: string;
  steps?: Array<{ nodeId: string; type: string; output: string }>;
}

interface Props {
  data: WorkflowRunData;
}

export function WorkflowRunCard({ data }: Props) {
  const [expanded, setExpanded] = useState(true);
  const { runId, status, steps = [] } = data;

  const statusColor =
    status === 'completed'
      ? 'text-intent-success'
      : status === 'failed'
        ? 'text-intent-danger'
        : status === 'running'
          ? 'text-accent'
          : 'text-intent-warning';

  const statusBg =
    status === 'completed'
      ? 'bg-intent-success-muted'
      : status === 'failed'
        ? 'bg-intent-danger-muted'
        : status === 'running'
          ? 'bg-accent-muted'
          : 'bg-intent-warning-muted';

  const nodeTypeIcon = (type: string) => {
    switch (type) {
      case 'start':
        return '▶';
      case 'end':
        return '■';
      case 'agentGroup':
      case 'aiAgent':
      case 'llm':
      case 'llmCall':
        return '🤖';
      case 'approval':
      case 'humanApproval':
        return '👤';
      case 'human':
        return '✍️';
      case 'ifElse':
      case 'condition':
        return '◆';
      case 'loop':
        return '🔁';
      case 'parallel':
        return '⚡';
      case 'merge':
        return '🔀';
      case 'pass':
        return '→';
      case 'skill':
        return '🛠';
      case 'tool':
        return '🔧';
      case 'code':
        return '💻';
      case 'workflow':
        return '🔗';
      case 'intentClassify':
        return '🏷';
      case 'knowledgeBase':
        return '📚';
      case 'dataQuery':
        return '📊';
      case 'notification':
        return '🔔';
      case 'wait':
        return '⏱';
      default:
        return '•';
    }
  };

  const nodeTypeLabel = (type: string) => {
    switch (type) {
      case 'agentGroup':
      case 'aiAgent':
        return 'Agent Group';
      case 'llm':
      case 'llmCall':
        return 'LLM';
      case 'approval':
      case 'humanApproval':
        return 'Approval';
      case 'human':
        return 'Human Task';
      case 'ifElse':
      case 'condition':
        return 'Condition';
      case 'dataQuery':
        return 'Data Query';
      case 'notification':
        return 'Notification';
      default:
        return type.charAt(0).toUpperCase() + type.slice(1);
    }
  };

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-intent-purple bg-surface-primary shadow-xs">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-2.5 bg-intent-purple-muted transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-intent-purple">
            Workflow
          </span>
          <span className="font-mono text-xs text-content-tertiary">{runId}</span>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`rounded px-2 py-0.5 text-[10px] font-medium ${statusBg} ${statusColor}`}
          >
            {status}
          </span>
          <span
            className={`text-xs text-content-tertiary transition-transform ${expanded ? 'rotate-180' : ''}`}
          >
            &#9660;
          </span>
        </div>
      </button>

      {expanded && steps.length > 0 && (
        <div className="px-4 py-3">
          {/* Timeline */}
          <div className="space-y-0">
            {steps.map((step, i) => (
              <div key={step.nodeId} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                      step.type === 'end' || status === 'completed'
                        ? 'bg-intent-success-muted text-intent-success'
                        : step.type === 'approval' || step.type === 'humanApproval'
                          ? 'bg-intent-warning-muted text-intent-warning'
                          : 'bg-surface-muted text-content-secondary'
                    }`}
                  >
                    {nodeTypeIcon(step.type)}
                  </div>
                  {i < steps.length - 1 && (
                    <div className="w-px flex-1 bg-surface-muted" />
                  )}
                </div>
                <div className="pb-3">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium text-content-primary`}>
                      {nodeTypeLabel(step.type)}
                    </span>
                    <span className={`font-mono text-[10px] text-content-tertiary`}>{step.nodeId}</span>
                  </div>
                  <p className={`text-xs text-content-tertiary mt-0.5`}>{step.output}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
