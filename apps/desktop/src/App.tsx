import React, { useState } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { Navigation, type NavPage } from '@cabinet/ui';
import { DashboardPage } from './pages/DashboardPage';
import { CabinetPage } from './pages/CabinetPage';
import { OfficePage } from './pages/OfficePage';
import { FactoryPage } from './pages/FactoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { EmployeesPage } from './pages/EmployeesPage';
import { MemoryPage } from './pages/MemoryPage';
import { useTheme } from './hooks/useTheme';
import { MobileNav } from './components/MobileNav';

export function App() {
  const [activePage, setActivePage] = useState<NavPage>('dashboard');
  const navigate = useNavigate();
  const { isDark, toggle } = useTheme();

  const handleNavigate = (page: NavPage) => {
    setActivePage(page);
    navigate(`/${page === 'dashboard' ? '' : page}`);
  };

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      <div className="hidden md:block">
        <Navigation activePage={activePage} onNavigate={handleNavigate} isDark={isDark} onToggleTheme={toggle} />
      </div>
      <main className="flex-1 overflow-auto bg-gray-50 dark:bg-gray-900 pb-16 md:pb-0">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/cabinet" element={<CabinetPage />} />
          <Route path="/office" element={<OfficePage />} />
          <Route path="/factory" element={<FactoryPage />} />
          <Route path="/skills" element={<SettingsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/employees" element={<EmployeesPage />} />
          <Route path="/memory" element={<MemoryPage />} />
        </Routes>
      </main>
      <MobileNav activePage={activePage} onNavigate={handleNavigate} />
    </div>
  );
}
