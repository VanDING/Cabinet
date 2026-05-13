import React, { useState, useEffect } from 'react';
import { WorkflowCanvas } from '@cabinet/ui';

interface WorkflowItem {
  id: string;
  name: string;
  nodes: any[];
  edges: any[];
  status: string;
}

export function FactoryPage() {
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);

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
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-4">Factory — Workflows</h1>
      {workflows.length === 0 ? (
        <div className="text-center text-gray-400 py-12">
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
