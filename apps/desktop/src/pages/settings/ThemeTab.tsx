import { useTheme } from '../../hooks/useTheme';

// ── Theme Tab ──
export function ThemeTab() {
  const { theme: currentTheme, themes, setTheme } = useTheme();

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold text-content-primary">
        Theme
      </h2>
      <div className="max-w-md space-y-4">
        <div className="rounded-lg border bg-surface-primary p-4">
          <div className="mb-3 text-sm font-medium text-content-primary">
            Select Theme
          </div>
          <div className="space-y-1">
            {themes.map((t) => (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                className={`block w-full rounded px-3 py-2 text-left text-sm transition-colors ${
                  t.id === currentTheme
                    ? 'bg-accent-muted text-accent'
                    : 'text-content-secondary hover:bg-surface-elevated'
                }`}
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
