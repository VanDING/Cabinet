import { useState, useEffect } from 'react';
import type { Decision } from '@cabinet/types';
import { useToast } from '../Toast';

export function DecisionList() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const { addToast } = useToast();

  useEffect(() => {
    fetch('/api/decisions?status=pending', { headers: { 'x-cabinet-pin': '1234' } })
      .then(res => res.json())
      .then(data => {
        if (data.decisions) setDecisions(data.decisions);
      })
      .catch(() => {});
  }, []);

  const handleApprove = async (id: string, optionId: string) => {
    await fetch(`/api/decisions/${id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cabinet-pin': '1234' },
      body: JSON.stringify({ chosenOptionId: optionId }),
    });
    addToast('success', `Decision approved`);
    setDecisions(prev => prev.filter(d => d.id !== id));
  };

  const handleReject = async (id: string) => {
    await fetch(`/api/decisions/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cabinet-pin': '1234' },
    });
    addToast('info', `Decision rejected`);
    setDecisions(prev => prev.filter(d => d.id !== id));
  };

  return (
    <div className="h-full bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg p-4 overflow-y-auto">
      <h3 className="font-semibold text-sm text-gray-800 dark:text-gray-200 mb-3">Pending Decisions</h3>
      {decisions.length === 0 ? (
        <p className="text-xs text-gray-400">No pending decisions</p>
      ) : (
        <div className="space-y-2">
          {decisions.slice(0, 5).map(d => (
            <div key={d.id} className="border dark:border-gray-700 rounded p-2 text-xs">
              <div className="font-medium text-gray-700 dark:text-gray-300 truncate">{d.title}</div>
              <div className="text-gray-400 mt-1 truncate">{d.description?.slice(0, 80)}</div>
              <div className="flex gap-1 mt-2">
                {d.options?.map((opt: any) => (
                  <button
                    key={opt.id}
                    onClick={() => handleApprove(d.id, opt.id)}
                    className="px-2 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 hover:bg-green-200"
                  >
                    {opt.label}
                  </button>
                ))}
                <button
                  onClick={() => handleReject(d.id)}
                  className="px-2 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-200 ml-auto"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
