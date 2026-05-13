import React, { useState, useEffect } from 'react';
import { DashboardSummary, type DashboardStats } from '@cabinet/ui';

export function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    pendingDecisions: 0,
    todayCost: 0,
    activeProjects: 1,
    activeWorkflows: 0,
    recentEvents: [],
    greeting: 'Good day, Captain.',
  });

  useEffect(() => {
    fetch('/api/dashboard/summary', { headers: { 'x-cabinet-pin': '1234' } })
      .then(res => res.json())
      .then(data => {
        setStats(prev => ({
          ...prev,
          pendingDecisions: data.pendingDecisions ?? 0,
          todayCost: data.todayCost ?? 0,
          activeProjects: data.activeProjects ?? 1,
        }));
      })
      .catch(() => {});
  }, []);

  const handleNavigate = (page: string) => {
    window.location.href = `/${page === 'dashboard' ? '' : page}`;
  };

  return <DashboardSummary stats={stats} onNavigate={handleNavigate as any} />;
}
