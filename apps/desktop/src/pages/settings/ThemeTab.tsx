import { useTheme } from '../../hooks/useTheme';

// ── Theme Tab ──
export function ThemeTab() {
  const { isDark, toggle } = useTheme();

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
        Theme & Account
      </h2>
      <div className="max-w-md space-y-4">
        <div className="flex items-center justify-between rounded-lg border bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <div>
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Dark Mode</div>
            <div className="text-xs text-gray-500">Toggle between light and dark theme</div>
          </div>
          <button
            id="theme-toggle-btn"
            className="rounded-lg border px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            onClick={toggle}
          >
            {isDark ? 'Light' : 'Dark'}
          </button>
        </div>
      </div>
    </div>
  );
}
