import { useTheme } from '../../hooks/useTheme';
import { registry } from '../../themes/registry';
import type { Theme } from '../../themes/types';

// ── Theme Preview Card ──
function ThemePreviewCard({
  theme,
  isActive,
  onSelect,
}: {
  theme: Theme;
  isActive: boolean;
  onSelect: () => void;
}) {
  const c = theme.colors;
  const s = theme.style;

  return (
    <button
      onClick={onSelect}
      className={`group relative w-full rounded-xl border-2 p-2.5 text-left transition-all ${
        isActive ? 'border-accent shadow-md' : 'border-transparent hover:border-border'
      }`}
      style={{ background: c.surface.elevated }}
    >
      {/* Active indicator */}
      {isActive && (
        <div
          className="absolute right-2 top-2 h-2 w-2 rounded-full"
          style={{ background: c.accent.base }}
        />
      )}

      {/* Theme name */}
      <div
        className="mb-1.5 text-xs font-semibold"
        style={{ color: c.content.primary }}
      >
        {theme.name}
      </div>

      {/* Mini UI preview */}
      <div
        className="overflow-hidden rounded-lg p-2"
        style={{
          background: s.bodyBg,
          borderRadius: s.radius.md,
          fontFamily: s.font.family,
        }}
      >
        {/* Header bar */}
        <div
          className="mb-1.5 flex items-center gap-1.5 px-1.5 py-0.5"
          style={{
            background: c.surface.primary,
            borderRadius: s.radius.sm,
            border: `1px solid ${c.border.color}`,
          }}
        >
          <span
            className="text-[8px] font-semibold"
            style={{ color: c.content.primary, letterSpacing: s.font.letterSpacing }}
          >
            Cabinet
          </span>
        </div>

        {/* Buttons */}
        <div className="mb-1.5 flex gap-1">
          <span
            className="px-1.5 py-0.5 text-[7px] font-medium"
            style={{
              background: c.accent.base,
              color: c.accent.foreground,
              borderRadius: s.radius.sm,
            }}
          >
            Primary
          </span>
          <span
            className="px-1.5 py-0.5 text-[7px]"
            style={{
              background: c.surface.muted,
              color: c.content.secondary,
              borderRadius: s.radius.sm,
              border: `1px solid ${c.border.color}`,
            }}
          >
            Secondary
          </span>
        </div>

        {/* Card */}
        <div
          className="mb-1.5 px-1.5 py-1"
          style={{
            background: c.surface.primary,
            borderRadius: s.radius.md,
            border: `1px solid ${c.border.color}`,
          }}
        >
          <div
            className="text-[8px] font-semibold"
            style={{ color: c.content.primary }}
          >
            Project Files
          </div>
          <div className="text-[7px]" style={{ color: c.content.tertiary }}>
            12 items · 2.4 MB
          </div>
        </div>

        {/* Tags */}
        <div className="flex gap-1">
          <span
            className="px-1 py-[1px] text-[6px]"
            style={{
              background: c.intent.success.muted,
              color: c.intent.success.color,
              borderRadius: s.radius.sm,
            }}
          >
            active
          </span>
          <span
            className="px-1 py-[1px] text-[6px]"
            style={{
              background: c.intent.info.muted,
              color: c.intent.info.color,
              borderRadius: s.radius.sm,
            }}
          >
            done
          </span>
        </div>
      </div>
    </button>
  );
}

// ── Theme Tab ──
export function ThemeTab() {
  const { theme: currentTheme, setTheme } = useTheme();

  return (
    <div>
      <div className="mb-5 text-xs text-content-tertiary">
        Click a theme to preview and apply it instantly.
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
        {registry.map((t) => (
          <ThemePreviewCard
            key={t.id}
            theme={t}
            isActive={t.id === currentTheme}
            onSelect={() => setTheme(t.id)}
          />
        ))}
      </div>
    </div>
  );
}
