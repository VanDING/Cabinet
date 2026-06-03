import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { NavPage } from '@cabinet/ui';

interface LayoutContextValue {
  activePage: NavPage;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  navigate: (page: NavPage) => void;
  navigateToProject: (projectId: string) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
}

const LayoutContext = createContext<LayoutContextValue | null>(null);

export function LayoutProvider({ children }: { children: React.ReactNode }) {
  const routerNavigate = useNavigate();
  const [activePage, setActivePage] = useState<NavPage>('office');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [sidebarWidth, setSidebarWidthState] = useState(160);

  const navigate = useCallback(
    (page: NavPage) => {
      setActivePage(page);
      routerNavigate(`/${page === 'office' ? '' : page}`);
    },
    [routerNavigate],
  );

  const navigateToProject = useCallback(
    (projectId: string) => {
      setActivePage('office');
      routerNavigate(`/project/${projectId}/office`);
    },
    [routerNavigate],
  );

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((c) => !c);
  }, []);

  const setSidebarWidth = useCallback((width: number) => {
    setSidebarWidthState(width);
  }, []);

  const value = useMemo(
    () => ({
      activePage,
      sidebarCollapsed,
      sidebarWidth,
      navigate,
      navigateToProject,
      toggleSidebar,
      setSidebarWidth,
    }),
    [activePage, sidebarCollapsed, sidebarWidth, navigate, navigateToProject, toggleSidebar, setSidebarWidth],
  );

  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>;
}

export function useLayout() {
  const ctx = useContext(LayoutContext);
  if (!ctx) throw new Error('useLayout must be used inside LayoutProvider');
  return ctx;
}
