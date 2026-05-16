import { useState, useEffect } from 'react';
import { apiFetch, authHeaders } from '../../utils/pin.js';

export function Deliverables() {
  const [data, setData] = useState<{ milestones: number; done: number; decisions: number; approved: number } | null>(null);

  useEffect(() => {
    Promise.all([
      apiFetch('/api/decisions?status=all', { headers: authHeaders() }).then(r => r.json()),
      apiFetch('/api/dashboard/summary', { headers: authHeaders() }).then(r => r.json()),
    ]).then(([decisionsData, dashData]) => {
      const decisions = decisionsData.decisions?.length ?? 0;
      const approved = decisionsData.decisions?.filter((d: any) => d.status === 'approved').length ?? 0;
      setData({
        milestones: dashData.activeProjects ?? 0,
        done: dashData.activeWorkflows ?? 0,
        decisions,
        approved,
      });
    }).catch(() => {});
  }, []);

  return (
    <div className="h-full bg-white dark:bg-gray-800 border dark:border-gray-600 rounded-lg p-4 flex flex-col">
      <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Deliverables</div>
      {!data ? (
        <div className="flex-1 flex items-center justify-center text-xs text-gray-400">Loading...</div>
      ) : (
        <div className="flex-1 space-y-3 text-xs">
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-gray-500">Milestones</span>
              <span className="text-gray-700 dark:text-gray-300">{data.done}/{data.milestones}</span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-1.5">
              <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${data.milestones > 0 ? (data.done / data.milestones) * 100 : 0}%` }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-gray-500">Decisions</span>
              <span className="text-gray-700 dark:text-gray-300">{data.approved}/{data.decisions}</span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-1.5">
              <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${data.decisions > 0 ? (data.approved / data.decisions) * 100 : 0}%` }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
