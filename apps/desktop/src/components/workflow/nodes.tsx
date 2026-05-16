import { Handle, Position } from 'reactflow';

// ── Base node wrapper ──
function BaseNode({ id, data, color, label, children }: {
  id: string; data: any; color: string; label: string; children?: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 border-2 rounded-lg shadow-md min-w-[160px]" style={{ borderColor: color }}>
      <div className="px-3 py-1.5 text-xs font-semibold text-white rounded-t-md" style={{ backgroundColor: color }}>
        {label}
      </div>
      <div className="px-3 py-2 text-xs text-gray-700 dark:text-gray-300">
        <p className="font-medium truncate max-w-[140px]">{data.label || id}</p>
        {children}
      </div>
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-gray-400" />
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-gray-400" />
    </div>
  );
}

// ── Node type components ──

export function StartNode({ id, data }: { id: string; data: any }) {
  return (
    <div className="bg-white dark:bg-gray-800 border-2 border-green-500 rounded-full shadow-md min-w-[100px]">
      <div className="px-4 py-3 text-center">
        <p className="text-sm font-bold text-green-600">{data.label || 'Start'}</p>
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-green-500" />
    </div>
  );
}

export function EndNode({ id, data }: { id: string; data: any }) {
  return (
    <div className="bg-white dark:bg-gray-800 border-2 border-red-500 rounded-full shadow-md min-w-[100px]">
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-red-500" />
      <div className="px-4 py-3 text-center">
        <p className="text-sm font-bold text-red-600">{data.label || 'End'}</p>
      </div>
    </div>
  );
}

export function AIAgentNode({ id, data }: { id: string; data: any }) {
  return (
    <BaseNode id={id} data={data} color="#3b82f6" label="AI Agent">
      <p className="text-gray-400 text-xs mt-0.5">{data.model || 'claude-sonnet-4-6'}</p>
    </BaseNode>
  );
}

export function HumanApprovalNode({ id, data }: { id: string; data: any }) {
  return (
    <BaseNode id={id} data={data} color="#f59e0b" label="Human Approval">
      <p className="text-gray-400 text-xs mt-0.5">{data.role || 'Reviewer'}</p>
    </BaseNode>
  );
}

export function ConditionNode({ id, data }: { id: string; data: any }) {
  return (
    <BaseNode id={id} data={data} color="#8b5cf6" label="Condition">
      <p className="text-gray-400 text-xs mt-0.5">{data.condition || 'If/Else'}</p>
    </BaseNode>
  );
}

export function LLMCallNode({ id, data }: { id: string; data: any }) {
  return (
    <BaseNode id={id} data={data} color="#06b6d4" label="LLM Call">
      <p className="text-gray-400 text-xs mt-0.5">{data.prompt?.slice(0, 40) || 'Prompt...'}</p>
    </BaseNode>
  );
}

export function DataQueryNode({ id, data }: { id: string; data: any }) {
  return (
    <BaseNode id={id} data={data} color="#10b981" label="Data Query">
      <p className="text-gray-400 text-xs mt-0.5">{data.query?.slice(0, 40) || 'Query...'}</p>
    </BaseNode>
  );
}

export function NotificationNode({ id, data }: { id: string; data: any }) {
  return (
    <BaseNode id={id} data={data} color="#ec4899" label="Notification">
      <p className="text-gray-400 text-xs mt-0.5">{data.message?.slice(0, 40) || 'Message...'}</p>
    </BaseNode>
  );
}

export function WaitNode({ id, data }: { id: string; data: any }) {
  return (
    <BaseNode id={id} data={data} color="#6b7280" label="Timer / Wait">
      <p className="text-gray-400 text-xs mt-0.5">{data.duration || '5s'}</p>
    </BaseNode>
  );
}

// ── Node type registry ──
export const nodeTypes = {
  start: StartNode,
  end: EndNode,
  aiAgent: AIAgentNode,
  humanApproval: HumanApprovalNode,
  condition: ConditionNode,
  llmCall: LLMCallNode,
  dataQuery: DataQueryNode,
  notification: NotificationNode,
  wait: WaitNode,
};

export const nodePalette = [
  { type: 'start', label: 'Start', color: '#22c55e', icon: '▶' },
  { type: 'end', label: 'End', color: '#ef4444', icon: '⏹' },
  { type: 'aiAgent', label: 'AI Agent', color: '#3b82f6', icon: '🤖' },
  { type: 'humanApproval', label: 'Human Approval', color: '#f59e0b', icon: '👤' },
  { type: 'condition', label: 'Condition', color: '#8b5cf6', icon: '🔀' },
  { type: 'llmCall', label: 'LLM Call', color: '#06b6d4', icon: '💬' },
  { type: 'dataQuery', label: 'Data Query', color: '#10b981', icon: '📊' },
  { type: 'notification', label: 'Notification', color: '#ec4899', icon: '🔔' },
  { type: 'wait', label: 'Wait / Timer', color: '#6b7280', icon: '⏱' },
];
