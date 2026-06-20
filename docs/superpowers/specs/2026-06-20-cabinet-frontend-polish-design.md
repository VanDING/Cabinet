# Cabinet Frontend Polish — Design Spec

## Overview

Comprehensive frontend visual polish for the Cabinet desktop app, inspired by Raycast's desktop-app surface ladder + Vercel's systematic component framework. The scope is **CSS variable layer + component className refinements only** — no API changes, no page/feature additions, no breaking existing theme engine.

## Design Philosophy

Cabinet is a developer desktop tool for AI agent management — think Raycast + Vercel combined. It should feel:

- **Precise** — every pixel intentional, consistent spacing/radius ladder
- **Substantial** — visible borders, clear surface hierarchy, subtle depth
- **Ownable** — Inter typography with ss03 signature, hairline-gray system
- **Playful** — Secretary Orb stays as the personality anchor, untouched

## Token Layer Changes

### 1. Surface Ladder Expansion

Add 2 intermediate surface tokens + 2 hairline tokens to `:root` defaults:

```css
--surface-primary: #ffffff; /* unchanged: cards, page bg */
--surface-elevated: #f8f9fa; /* unchanged: secondary panels */
--surface-2: #f3f4f6; /* NEW: hover states, subtle insets */
--surface-3: #eef0f2; /* NEW: code blocks, dropdown bg */
--surface-muted: #e9ecef; /* unchanged: dividers, disabled */
--surface-overlay: #ffffff; /* unchanged: modals */
--surface-input: #f1f3f5; /* existed but unused → now active */

--hairline: #e5e7eb; /* NEW: 1px card borders, dividers */
--hairline-strong: #d1d5db; /* NEW: input focus, strong dividers */
```

Dark defaults:

```css
--surface-primary: #141414;
--surface-elevated: #0d0d0d;
--surface-2: #1a1a1a; /* NEW */
--surface-3: #222222; /* NEW */
--surface-muted: #1f1f1f;
--hairline: #2a2a2a; /* NEW */
--hairline-strong: #373737; /* NEW */
```

**Border system rework:**

```css
--border-color: var(--hairline); /* was: transparent */
--border-subtle: color-mix(in srgb, var(--hairline) 50%, transparent); /* was: transparent */
--border-width: 1px; /* was: 0px */
```

### 2. Stacked Shadow System (Vercel-inspired)

```css
--shadow-xs: 0px 1px 1px rgba(0, 0, 0, 0.03), 0px 0px 0px 1px rgba(0, 0, 0, 0.03);
--shadow-sm:
  0px 1px 1px rgba(0, 0, 0, 0.03), 0px 2px 2px rgba(0, 0, 0, 0.05),
  0px 0px 0px 1px rgba(0, 0, 0, 0.03);
--shadow-md:
  0px 1px 1px rgba(0, 0, 0, 0.03), 0px 2px 2px rgba(0, 0, 0, 0.04),
  0px 8px 8px -4px rgba(0, 0, 0, 0.04);
--shadow-lg:
  0px 1px 1px rgba(0, 0, 0, 0.03), 0px 8px 16px -4px rgba(0, 0, 0, 0.06),
  0px 24px 32px -8px rgba(0, 0, 0, 0.08);
```

Dark shadows are lighter (inverted luminance):

```css
--shadow-xs: 0px 1px 1px rgba(0, 0, 0, 0.15), 0px 0px 0px 1px rgba(255, 255, 255, 0.03);
--shadow-sm: ... (same pattern, lighter) --shadow-md: ... --shadow-lg: ...;
```

### 3. Radius Scale Tightening

```css
--radius-sm: 6px; /* unchanged: tags, small pills */
--radius-md: 8px; /* was 10px: buttons, inputs, cards base */
--radius-lg: 12px; /* was 14px: feature cards, modals */
--radius-xl: 16px; /* was 18px: large containers, pricing cards */
```

### 4. Typography System

Add Inter + JetBrains Mono via Google Fonts link in `index.html` or Tauri asset:

```css
--font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
--font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
--font-display: var(--font-family);
```

Inter ss03 stylistic set enabled globally:

```css
body {
  font-feature-settings: 'calt', 'kern', 'liga', 'ss03';
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

### Theme Impact Summary

| Token               | Added/Changed                               | Themes Affected                    | Migration                                 |
| ------------------- | ------------------------------------------- | ---------------------------------- | ----------------------------------------- |
| `--surface-2`       | **Added**                                   | 0 (inherits from `:root` defaults) | None needed                               |
| `--surface-3`       | **Added**                                   | 0                                  | None needed                               |
| `--hairline`        | **Added**                                   | 0                                  | Inherits `:root`; each theme CAN override |
| `--hairline-strong` | **Added**                                   | 0                                  | Inherits `:root`; each theme CAN override |
| `--border-color`    | **Changed** (transparent → var(--hairline)) | All 15 themes visually change      | Major upgrade — borders become visible    |
| `--border-width`    | **Changed** (0px → 1px)                     | All 15 themes visually change      | Required for hairline system              |
| `--shadow-*`        | **Changed** (all none → stacked)            | All 15 themes visually change      | Enhancement — adds depth                  |
| `--radius-*`        | **Changed** (tightened)                     | All 15 themes                      | Minor — radius shifts 2-4px               |
| `--font-family`     | **Changed** (system → Inter)                | All themes                         | Fallback chain preserved                  |

## Component ClassName Changes

### Card (`packages/ui/src/card.tsx`)

```diff
- 'rounded-lg border border-border bg-surface-primary shadow-xs'
+ 'rounded-xl border border-border bg-surface-primary shadow-xs'
```

- Card `padding` defaults: `md: p-4` → `md: p-5`
- Card `hoverable`: `transition-shadow hover:shadow-xs` → `transition-shadow hover:shadow-sm`

### Button (`packages/ui/src/button.tsx`)

```diff
- xs: 'rounded px-3 py-1 text-xs'
+ xs: 'rounded-md px-2.5 py-1 text-xs'
- sm: 'rounded-lg px-3 py-1.5 text-sm'
+ sm: 'rounded-md px-3.5 py-1.5 text-sm'
- md: 'rounded-lg px-4 py-2 text-sm'
+ md: 'rounded-md px-3.5 py-2 text-sm'
```

- Variant `secondary`: add `border border-border`
- Variant `ghost`: remove `border` class (ghost should be borderless)
- Base button: `shadow-xs` → `shadow-xs` (keep; buttons don't need elevation)

### Input (`packages/ui/src/input.tsx`)

```diff
- 'rounded-lg border border-border bg-surface-primary px-3 py-2 text-sm'
+ 'rounded-md border border-border bg-surface-input px-3 py-2 text-sm'
```

- Focus ring: `focus:ring-2 focus:ring-accent` stays (already good)

### Tag (`packages/ui/src/tag.tsx`)

Minimal change — add 1px hairline border for structure:

```diff
- 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium'
+ 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border border-border-subtle'
```

### Navigation Sidebar (`packages/ui/src/navigation.tsx`)

- Nav item active indicator: `border-r-2 border-accent` stays
- Add `--hairline` border-right for the sidebar edge

## Layout Changes

### Page Container Styles

Remove ad-hoc per-page padding. Add a global `.page-container` class in `index.css`:

```css
.page-container {
  padding: 1.5rem; /* p-6 */
  height: 100%;
  overflow-y: auto;
}
```

Update `EmployeesPage.tsx` and similar page components from `p-6` to using `.page-container`.

### Grid & Card Spacing

- Card grid: `gap-4` stays (16px at 4px base = 4 units)
- Card interior padding: `p-4` → `p-5` (20px = 5 units)

## Editor/Code Surface Touches

- `--code-block-bg` → use `--surface-3` instead of `#F8F9FA`
- `--code-inline-bg` → use `--surface-2` instead of `#F1F3F5`
- Markdown `code-block` border: `current border-width` → use `--hairline`

## What's NOT Changing

- All 15 existing theme color palettes (light-default, dark-default, warm, zen, cyberpunk, etc.)
- Secretary Orb, animations, expressions
- Any component API (props, interfaces, exports)
- Any page layout or behavior
- Any route or navigation structure
- Any theme-specific radius/typography — those remain as each theme's individual design choices
