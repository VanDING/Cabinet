import React, { useState, useEffect } from 'react';
import { DecisionCard } from '@cabinet/ui';
import type { Decision } from '@cabinet/types';

export function OfficePage() {
  const [decisions, setDecisions] = useState<Decision[]>([]);

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
    setDecisions(prev => prev.filter(d => d.id !== id));
  };

  const handleReject = async (id: string) => {
    await fetch(`/api/decisions/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cabinet-pin': '1234' },
    });
    setDecisions(prev => prev.filter(d => d.id !== id));
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">Office — Decisions</h1>
      {decisions.length === 0 ? (
        <div className="text-center text-gray-400 dark:text-gray-500 py-12">
          <p className="text-lg">No pending decisions</p>
          <p className="text-sm mt-1">New decisions will appear here when they require your attention.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {decisions.map(d => (
            <DecisionCard
              key={d.id}
              decision={d}
              variant="full"
              onApprove={handleApprove}
              onReject={handleReject}
            />
          ))}
        </div>
      )}
    </div>
  );
}
