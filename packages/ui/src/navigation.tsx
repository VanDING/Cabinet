export type NavPage = 'dashboard' | 'cabinet' | 'office' | 'factory' | 'employees' | 'memory' | 'settings';

export interface NavigationProps {
  activePage: NavPage;
  onNavigate: (page: NavPage) => void;
  isDark?: boolean;
  onToggleTheme?: () => void;
}

const navItems: { id: NavPage; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '◫' },
  { id: 'cabinet', label: 'Cabinet', icon: '💬' },
  { id: 'office', label: 'Office', icon: '⚖' },
  { id: 'factory', label: 'Factory', icon: '⚙' },
  { id: 'employees', label: 'Employees', icon: '👥' },
  { id: 'memory', label: 'Memory', icon: '🧠' },
];

export function Navigation({ activePage, onNavigate, isDark, onToggleTheme }: NavigationProps) {
  return (
    <nav className="w-56 bg-gray-900 text-white h-screen flex flex-col">
      <div className="px-5 py-4 border-b border-gray-700">
        <h1 className="text-lg font-bold">Cabinet</h1>
        <p className="text-xs text-gray-400">AI Collaboration</p>
      </div>
      <div className="flex-1 py-3">
        {navItems.map(item => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`w-full text-left px-5 py-3 flex items-center gap-3 transition-colors ${
              activePage === item.id
                ? 'bg-gray-800 text-white border-r-2 border-blue-500'
                : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
            }`}
          >
            <span className="text-lg">{item.icon}</span>
            <span className="text-sm font-medium">{item.label}</span>
          </button>
        ))}

        {/* Separator */}
        <div className="mx-5 my-2 border-t border-gray-700" />

        {/* Settings at bottom */}
        <button
          onClick={() => onNavigate('settings')}
          className={`w-full text-left px-5 py-3 flex items-center gap-3 transition-colors ${
            activePage === 'settings'
              ? 'bg-gray-800 text-white border-r-2 border-blue-500'
              : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
          }`}
        >
          <span className="text-lg">⚙</span>
          <span className="text-sm font-medium">Settings</span>
        </button>
      </div>
      <div className="px-5 py-3 border-t border-gray-700 text-xs text-gray-500">
        Cabinet v2.0
      </div>
      {onToggleTheme && (
        <button
          onClick={onToggleTheme}
          className="w-full px-5 py-2 text-xs text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-2"
        >
          <span>{isDark ? '☀️' : '🌙'}</span>
          <span>{isDark ? 'Light Mode' : 'Dark Mode'}</span>
        </button>
      )}
    </nav>
  );
}
