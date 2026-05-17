import { useState, useEffect } from 'react';
import { apiFetch, authHeaders } from '../../utils/pin.js';

export function Deliverables() {
  const [data, setData] = useState<{
    milestones: number;
    done: number;
    decisions: number;
    approved: number;
  } | null>(null);

  useEffect(() => {
    Promise.all([
      apiFetch('/api/decisions?status=all', { headers: authHeaders() }).then((r) => r.json()),
      apiFetch('/api/dashboard/summary', { headers: authHeaders() }).then((r) => r.json()),
    ])
      .then(([decisionsData, dashData]) => {
        const decisions = decisionsData.decisions?.length ?? 0;
        const approved =
          decisionsData.decisions?.filter((d: any) => d.status === 'approved').length ?? 0;
        setData({
          milestones: dashData.activeProjects ?? 0,
          done: dashData.activeWorkflows ?? 0,
          decisions,
          approved,
        });
      })
      .catch(() => {});
  }, []);

  return (
    <div className="flex h-full flex-col rounded-lg border bg-white p-4 dark:border-gray-600 dark:bg-gray-800">
      <div className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">Deliverables</div>
      {!data ? (
        <div className="flex flex-1 items-center justify-center text-xs text-gray-400">
          Loading...
        </div>
      ) : (
        <div className="flex-1 space-y-3 text-xs">
          <div>
            <div className="mb-1 flex justify-between">
              <span className="text-gray-500">Milestones</span>
              <span className="text-gray-700 dark:text-gray-300">
                {data.done}/{data.milestones}
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-600">
              <div
                className="h-1.5 rounded-full bg-green-500"
                style={{
                  width: `${data.milestones > 0 ? (data.done / data.milestones) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
          <div>
            <div className="mb-1 flex justify-between">
              <span className="text-gray-500">Decisions</span>
              <span className="text-gray-700 dark:text-gray-300">
                {data.approved}/{data.decisions}
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-600">
              <div
                className="h-1.5 rounded-full bg-blue-500"
                style={{
                  width: `${data.decisions > 0 ? (data.approved / data.decisions) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
