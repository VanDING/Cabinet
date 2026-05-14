import React, { useState, useEffect } from 'react';
import { WorkflowCanvas } from '@cabinet/ui';
import { useToast } from '../components/Toast';
import { useProject } from '../hooks/useProject';

interface WorkflowItem {
  id: string;
  name: string;
  nodes: any[];
  edges: any[];
  status: string;
}

export function FactoryPage() {
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  const { addToast } = useToast();
  const { current } = useProject();

  useEffect(() => {
    fetch('/api/factory/workflows', { headers: { 'x-cabinet-pin': '1234' } })
      .then(res => res.json())
      .then(data => {
        if (data.workflows) setWorkflows(data.workflows);
      })
      .catch(() => {});
  }, []);

  const handleRun = async (id: string) => {
    await fetch(`/api/factory/workflows/${id}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cabinet-pin': '1234' },
    });
    addToast('success', `Workflow ${id} started`);
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex items-baseline gap-3 mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Factory</h1>
        <span className="text-sm text-gray-500 dark:text-gray-400">{current.name} &mdash; Create workflows to automate multi-step AI processes.</span>
      </div>

      {workflows.length === 0 ? (
        <div className="text-center text-gray-400 dark:text-gray-500 py-12">
          <p className="text-lg">No workflows configured</p>
          <p className="text-sm mt-1">Create workflows to automate multi-step AI processes.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {workflows.map(wf => (
            <WorkflowCanvas key={wf.id} workflow={wf} onRun={handleRun} />
          ))}
        </div>
      )}
    </div>
  );
}
