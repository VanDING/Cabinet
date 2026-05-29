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
      ? 'text-green-600'
      : status === 'failed'
        ? 'text-red-600'
        : status === 'running'
          ? 'text-blue-600'
          : 'text-amber-600';

  const statusBg =
    status === 'completed'
      ? 'bg-green-100'
      : status === 'failed'
        ? 'bg-red-100'
        : status === 'running'
          ? 'bg-blue-100'
          : 'bg-amber-100';

  const nodeTypeIcon = (type: string) => {
    switch (type) {
      case 'start':
        return '▶';
      case 'end':
        return '■';
      case 'aiAgent':
      case 'llmCall':
        return '🤖';
      case 'humanApproval':
        return '👤';
      case 'condition':
        return '◆';
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
      case 'aiAgent':
        return 'AI Agent';
      case 'llmCall':
        return 'LLM Call';
      case 'humanApproval':
        return 'Human Approval';
      case 'dataQuery':
        return 'Data Query';
      case 'notification':
        return 'Notification';
      default:
        return type.charAt(0).toUpperCase() + type.slice(1);
    }
  };

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-purple-200 bg-white shadow-sm">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-2.5 bg-purple-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-purple-700">
            Workflow
          </span>
          <span className="font-mono text-xs text-gray-500">{runId}</span>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`rounded px-2 py-0.5 text-[10px] font-medium ${statusBg} ${statusColor}`}
          >
            {status}
          </span>
          <span
            className={`text-xs text-gray-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
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
                        ? 'bg-green-100 text-green-600'
                        : step.type === 'humanApproval'
                          ? 'bg-amber-100 text-amber-600'
                          : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {nodeTypeIcon(step.type)}
                  </div>
                  {i < steps.length - 1 && (
                    <div className="w-px flex-1 bg-gray-200" />
                  )}
                </div>
                <div className="pb-3">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium text-gray-800`}>
                      {nodeTypeLabel(step.type)}
                    </span>
                    <span className={`font-mono text-[10px] text-gray-500`}>{step.nodeId}</span>
                  </div>
                  <p className={`text-xs text-gray-500 mt-0.5`}>{step.output}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
