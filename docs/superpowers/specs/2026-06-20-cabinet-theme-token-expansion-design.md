# Cabinet Theme Token Expansion — Design Spec

**Date**: 2026-06-20
**Status**: Design Approved
**Scope**: Add 6 new token categories (16 individual tokens) to the Cabinet theme system for higher design freedom.

---

## Background

After a comprehensive audit of the existing theme token system (114 lines in `types.ts`, 15 themes), 8 token categories were identified as gaps. This was narrowed to 6 by removing `content-placeholder` (redundant with `content-tertiary`) and `icon-*` (marginal benefit relative to complexity). The user elected to make all new tokens **required** rather than optional, meaning all 15 themes will get explicit values.

---

## Type Changes

### `types.ts` — ThemeColors

```diff
export interface ThemeColors {
  surface: {
    primary: string;
    elevated: string;
    surface2?: string;
    surface3?: string;
    overlay: string;
    input: string;
    muted: string;
    sidebar: string;
+   floating: string;
  };
  content: {
    primary: string;
    secondary: string;
    tertiary: string;
    inverse: string;
+   link: string;
  };
+ brand: {
+   accent: string;
+   success: string;
+   danger: string;
+   warning: string;
+   info: string;
+   purple: string;
+ };
+ icon: {
+   primary: string;
+   secondary: string;
+   accent: string;
+ };
  // ... existing fields unchanged
}
```

### `types.ts` — ThemeStyle

```diff
export interface ThemeStyle {
  // ... radius, font, border unchanged
  shadow: {
    xs?: string;
    sm: string;
    md: string;
    lg: string;
+   popover: string;
+   modal: string;
  };
  transition: {
    duration: string;   // normal
    easing: string;
+   fast: string;
+   slow: string;
  };
  // ... opacity, glass, focusRing, selection, scrollbar, bodyBg unchanged
}
```

---

## Token Definitions & Values

### 1. `surface.floating`

**Semantic**: Dedicated background for floating elements (dropdowns, popovers, context menus, tooltips). Sits visually above all content surfaces. Distinct from `surface-2` which is for in-page nested panels.

**Surface hierarchy**:

```
surface-floating   ← highest (closest to viewer)
surface-primary    ← main content
surface-elevated   ← secondary panels, sidebar
surface-2          ← nested in-page panels
surface-3          ← deeper nesting
surface-muted      ← weakest differentiation
```

**light-default**: `#FFFFFF`
**dark-default**: `#2A2A2A`
**Retro themes** (vaporwave/techno/pixel-by): same as primary + hard shadow for elevation

### 2. `brand.*`

**Semantic**: Colored container backgrounds. Currently all themed containers use `color-mix(in srgb, var(--accent) 15%, transparent)` — algorithmic blending that theme authors cannot control. `brand.*` gives exact control.

**light-default**:

| Token         | Color     | Paired intent     |
| ------------- | --------- | ----------------- |
| brand.accent  | `#EEF2FF` | accent `#4F46E5`  |
| brand.success | `#F0FDF4` | success `#15803D` |
| brand.danger  | `#FEF2F2` | danger `#DC2626`  |
| brand.warning | `#FFFBEB` | warning `#D97706` |
| brand.info    | `#EFF6FF` | info `#4F46E5`    |
| brand.purple  | `#FAF5FF` | purple `#7C3AED`  |

**dark-default**:

| Token         | Color     |
| ------------- | --------- |
| brand.accent  | `#1E1B4B` |
| brand.success | `#052E16` |
| brand.danger  | `#450A0A` |
| brand.warning | `#451A03` |
| brand.info    | `#172554` |
| brand.purple  | `#2E1065` |

**4-tier semantic color system** (existing + new):

| Layer         | Token                 | Usage                        |
| ------------- | --------------------- | ---------------------------- |
| Emphasis      | `intent.X.color`      | Foreground text, icons       |
| Subtle bg     | `intent.X.muted`      | Tags, chips, pills           |
| Container bg  | `brand.X`             | Alert banners, status panels |
| Contrast text | `intent.X.foreground` | Button text on colored bg    |

### 3. `content.link`

**Semantic**: Decouples link color from accent color. Many themes use purple/pink/gold accents which are unsuitable for standard hyperlinks.

**light-default**: `#2563EB` (classic blue)
**dark-default**: `#60A5FA` (bright blue)

No hover/visited variants — single link color per theme.

### 4. `icon.*`

**Semantic**: Dedicated icon colors. Default to content colors for backward compatibility.

| Token          | light-default | dark-default |
| -------------- | ------------- | ------------ |
| icon.primary   | `#1A1A1A`     | `#F3F4F6`    |
| icon.secondary | `#6E6E6E`     | `#9CA3AF`    |
| icon.accent    | `#4F46E5`     | `#818CF8`    |

Defaults: icon.primary = content.primary, icon.secondary = content.secondary, icon.accent = accent.base.

### 5. `transition.fast` / `transition.slow`

**light-default**: fast=`100ms`, normal=`200ms`, slow=`400ms`
**dark-default**: fast=`100ms`, normal=`200ms`, slow=`400ms`

`easing` unchanged.

### 6. `shadow.popover` / `shadow.modal`

**light-default**:
| Token | Value |
|-------|-------|
| popover | `0px 4px 16px rgba(0,0,0,0.08), 0px 1px 2px rgba(0,0,0,0.06)` |
| modal | `0px 8px 32px rgba(0,0,0,0.12), 0px 2px 8px rgba(0,0,0,0.08)` |

**dark-default**:
| Token | Value |
|-------|-------|
| popover | `0px 4px 16px rgba(0,0,0,0.30), 0px 1px 2px rgba(0,0,0,0.20)` |
| modal | `0px 8px 32px rgba(0,0,0,0.40), 0px 2px 8px rgba(0,0,0,0.25)` |

---

## Changes to `generate-css.ts`

### `flattenTokens()` — new entries to add

After existing surface tokens:

```ts
vars['--surface-floating'] = colors.surface.floating;
```

After existing content tokens:

```ts
vars['--content-link'] = colors.content.link;
```

New brand section:

```ts
for (const [name, color] of Object.entries(colors.brand)) {
  vars[`--brand-${name}`] = color;
}
```

New icon section:

```ts
vars['--icon-primary'] = colors.icon.primary;
vars['--icon-secondary'] = colors.icon.secondary;
vars['--icon-accent'] = colors.icon.accent;
```

Shadow:

```ts
vars['--shadow-popover'] = style.shadow.popover;
vars['--shadow-modal'] = style.shadow.modal;
```

Transition:

```ts
vars['--duration'] = style.transition.duration;
vars['--duration-fast'] = style.transition.fast;
vars['--duration-slow'] = style.transition.slow;
vars['--easing'] = style.transition.easing;
```

### `computeDefault()` — not needed for required fields

Since all new tokens are required in the type, `flattenTokens()` reads them directly. No `computeDefault()` fallback required.

---

## Changes to `index.css` (@theme inline)

```css
/* surface */
--color-surface-floating: var(--surface-floating);

/* content */
--color-content-link: var(--content-link);

/* brand */
--color-brand-accent: var(--brand-accent);
--color-brand-success: var(--brand-success);
--color-brand-danger: var(--brand-danger);
--color-brand-warning: var(--brand-warning);
--color-brand-info: var(--brand-info);
--color-brand-purple: var(--brand-purple);

/* icon */
--color-icon-primary: var(--icon-primary);
--color-icon-secondary: var(--icon-secondary);
--color-icon-accent: var(--icon-accent);

/* shadow */
--shadow-popover: var(--shadow-popover);
--shadow-modal: var(--shadow-modal);

/* duration */
--duration-fast: var(--duration-fast);
--duration-slow: var(--duration-slow);
```

---

## Changes to 13 Non-Default Themes

All 13 theme files (`warm.ts`, `zen.ts`, `brutalism.ts`, `synthwave.ts`, `vaporwave.ts`, `cyberpunk.ts`, `techno.ts`, `polar.ts`, `pixel-by.ts`, `geek.ts`, `afrofuturism.ts`, `sumi-e.ts`, `showa-retro.ts`) need these fields added:

### `surface.floating`

**Strategy**: Each theme's floating surface = its primary surface color. Floating elements are distinguished by shadow, not color, in light themes. In dark themes, floating = slightly lighter than primary.

### `content.link`

**Strategy**: For most themes, `content.link` = `accent.base`. For themes where accent is non-standard for links (synthwave pink, geek green, sumi-e black), use a more conventional link hue.

| Theme        | accent.base | content.link                               |
| ------------ | ----------- | ------------------------------------------ |
| warm         | `#D4764A`   | `#C0653A`                                  |
| zen          | `#7A8B6F`   | = accent                                   |
| brutalism    | `#E53E3E`   | = accent                                   |
| synthwave    | `#FF007F`   | `#00D4FF` (cyan — more readable for links) |
| vaporwave    | `#FF71CE`   | `#00D4FF`                                  |
| cyberpunk    | `#66FCF1`   | = accent                                   |
| techno       | `#F4C542`   | = accent                                   |
| polar        | `#4A90D9`   | = accent                                   |
| pixel-by     | `#2563EB`   | = accent                                   |
| geek         | `#33FF33`   | `#66FF66` (brighter green)                 |
| afrofuturism | `#E5C687`   | = accent                                   |
| sumi-e       | `#2B2B2B`   | `#4A4A4A`                                  |
| showa-retro  | `#D4624A`   | = accent                                   |

### `brand.*`

**Strategy**: Use `color-mix()` values matching each theme's palette. For each brand.X, use a low-opacity version of the corresponding intent color. For themes with transparent/overlay surfaces, brand colors follow the same pattern.

### `icon.*`

**Strategy**: `icon.primary` = `content.primary`, `icon.secondary` = `content.secondary`, `icon.accent` = `accent.base`.

### `transition.fast/slow`

**Strategy**: All themes: fast=`100ms`, slow=`400ms`. (Only duration changes; easing is per-theme.)

### `shadow.popover` / `shadow.modal`

**Strategy**: Follow each theme's shadow style (gray, colored glow, hard drop). Scale up from existing `shadow.lg` by approximately 2x.

---

## Component Usage Map

After token creation, components consume the new tokens:

| Token                | Tailwind class                         | Component target                                 |
| -------------------- | -------------------------------------- | ------------------------------------------------ |
| `surface-floating`   | `bg-surface-floating`                  | All dropdowns, context menus, tooltips, popovers |
| `content-link`       | `text-content-link`                    | `<a>` tags, `.markdown-body a`                   |
| `brand.*`            | `bg-brand-{accent/success/...}`        | Alert banners, status panels, notification bars  |
| `icon.*`             | `text-icon-{primary/secondary/accent}` | Icon elements currently using `text-content-*`   |
| `shadow-popover`     | `shadow-popover`                       | Dropdowns, context menus                         |
| `shadow-modal`       | `shadow-modal`                         | Modal dialogs, fullscreen panels                 |
| `duration-fast/slow` | via `transition-all duration-fast`     | Hover effects, modal animations                  |

---

## Self-Review Checklist

- [x] No placeholders ("TBD", "TODO") — all values specified
- [x] Internal consistency — type changes, CSS generation, component usage all aligned
- [x] Scope focused — 6 categories, no scope creep
- [x] No ambiguity — each token has clear semantic definition and fallback strategy
- [x] Backward compatible — all existing theme fields unchanged, additive only
- [x] All 15 themes get explicit values — no computeDefault() for required fields

---

## Files to Change

1. `apps/desktop/src/themes/types.ts` — add new fields
2. `apps/desktop/src/themes/generate-css.ts` — flatten new tokens
3. `apps/desktop/src/index.css` — @theme inline mappings
4. `apps/desktop/src/themes/light-default.ts` — explicit values
5. `apps/desktop/src/themes/dark-default.ts` — explicit values
6. `apps/desktop/src/themes/warm.ts` through `showa-retro.ts` (13 files) — explicit values
7. Regenerate: `pnpm gen:theme`
8. Verify: `pnpm typecheck` + `pnpm test`
