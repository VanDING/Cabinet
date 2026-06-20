# Default Themes Polish Design

## Summary

全面抛光 light-default 和 dark-default 两个主题，利用 P2 新 token 做精细化调整。

## Changes: light-default

### Surface Ladder

- `surface.elevated`: #F8F9FA (keep — cards on white surface distinguished by shadow)
- `surface.surface2`: #F0F1F3 (was computed)
- `surface.surface3`: #EAEBED (was computed)
- `bodyBg`: #F5F6F8 (was #F8F9FA — 3-step difference from elevated for distinct page BG)

### Accent Color Swap (#4F46E5 indigo → #2563EB blue)

- `accent.base`: #2563EB
- `accent.hover`: #1D4ED8
- `accent.muted`: rgba(37, 99, 235, 0.08)
- `accent.foreground`: #FFFFFF

### Intent Follow-up

- `intent.info.color`: #2563EB (was #4F46E5, matching new accent)
- `intent.info.muted`: rgba(37, 99, 235, 0.08)

### Icon

- `icon.accent`: #2563EB (was #4F46E5)

### Focus Ring & Selection

- `focusRing.color`: rgba(37, 99, 235, 0.4)
- `selection.bg`: #2563EB

### Shadows (popover/modal differentiation)

- `shadow.popover`: `0px 8px 24px rgba(0,0,0,0.10), 0px 2px 4px rgba(0,0,0,0.06)` (compact)
- `shadow.modal`: `0px 16px 48px rgba(0,0,0,0.15), 0px 4px 8px rgba(0,0,0,0.08)` (wide)

### Transitions

- `duration`: 200ms (was 180ms)
- `slow`: 350ms (was 400ms)

## Changes: dark-default

### Surface Ladder (fixed direction)

- `surface.elevated`: #1C1C1C (was #0D0D0D — now LIGHTER than primary #141414)
- `surface.surface2`: #222222 (was computed)
- `surface.surface3`: #282828 (was computed)
- `surface.floating`: #2E2E2E (was #2A2A2A)

Dark ladder progression: bodyBg #0D0D0D → primary #141414 → elevated #1C1C1C → muted #1F1F1F → surface-2 #222222 → surface-3 #282828 → floating #2E2E2E

### Shadows

- `shadow.popover`: `0px 8px 24px rgba(0,0,0,0.35), 0px 2px 4px rgba(0,0,0,0.20)`
- `shadow.modal`: `0px 16px 48px rgba(0,0,0,0.45), 0px 4px 8px rgba(0,0,0,0.25)`

### Transitions

- `duration`: 150ms (was 120ms)
- `fast`: 80ms (was 100ms)
- `slow`: 300ms (was 400ms)

## Verification

1. `pnpm gen:theme` — regenerates generated.css
2. `pnpm typecheck` — no type errors
3. `pnpm test` — no regressions
