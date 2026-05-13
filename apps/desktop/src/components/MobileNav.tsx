import React from 'react';
import type { NavPage } from '@cabinet/ui';

const items: { id: NavPage; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Home', icon: '◫' },
  { id: 'cabinet', label: 'Chat', icon: '💬' },
  { id: 'office', label: 'Decide', icon: '⚖' },
  { id: 'factory', label: 'Flow', icon: '⚙' },
];

interface Props {
  activePage: NavPage;
  onNavigate: (page: NavPage) => void;
}

export function MobileNav({ activePage, onNavigate }: Props) {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-gray-900 text-white border-t border-gray-700 z-50">
      <div className="flex justify-around py-1">
        {items.map(item => (
          <button key={item.id} onClick={() => onNavigate(item.id)}
            className={`flex flex-col items-center px-3 py-1.5 text-xs transition-colors ${
              activePage === item.id ? 'text-blue-400' : 'text-gray-400'
            }`}
          >
            <span className="text-lg">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
