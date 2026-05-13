import React, { useState, useEffect } from 'react';
import { DashboardSummary, type DashboardStats } from '@cabinet/ui';
import { useProject } from '../hooks/useProject';
import { ProjectSwitcher } from '../components/ProjectSwitcher';

export function DashboardPage() {
  const { projects, current, setProject } = useProject();
  const [stats, setStats] = useState<DashboardStats>({
    pendingDecisions: 0,
    todayCost: 0,
    activeProjects: projects.length,
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
        }));
      })
      .catch(() => {});
  }, [current.id]);

  const handleNavigate = (page: string) => {
    window.location.href = `/${page === 'dashboard' ? '' : page}`;
  };

  return (
    <div>
      <div className="px-6 pt-4 flex items-center justify-between">
        <ProjectSwitcher projects={projects} current={current} onSwitch={setProject} />
        <span className="text-xs text-gray-400">Project ID: {current.id}</span>
      </div>
      <DashboardSummary
        stats={{ ...stats, greeting: `Project: ${current.name}` }}
        onNavigate={handleNavigate as any}
      />
    </div>
  );
}
