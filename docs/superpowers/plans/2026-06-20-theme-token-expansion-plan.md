# Theme Token Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 16 new required theme tokens across 6 categories (surface-floating, brand._, content-link, icon._, shadow-popover/modal, duration-fast/slow) to all 15 themes.

**Architecture:** All new tokens are required (non-optional) fields in the `Theme` type. `flattenTokens()` reads them directly with no computed fallback. All 15 theme files get explicit values. `@theme inline` in `index.css` maps them to Tailwind utility classes.

**Tech Stack:** TypeScript, CSS custom properties, Tailwind v4 @theme inline, Tauri desktop app.

---

### Task 1: Update types.ts with new fields

**Files:**

- Modify: `apps/desktop/src/themes/types.ts`

- [ ] **Add new fields to ThemeColors**

In `surface`: add `floating: string;`
In `content`: add `link: string;`
Add new `brand` section with 6 fields
Add new `icon` section with 3 fields

**Exact edits:**

In `surface` block, after `sidebar: string;`:

```
    sidebar: string;
    floating: string;
```

In `content` block, after `inverse: string;`:

```
    inverse: string;
    link: string;
```

After `chart: { c1-c8 }` closing brace and before closing `}` of ThemeColors, add:

```
  brand: {
    accent: string;
    success: string;
    danger: string;
    warning: string;
    info: string;
    purple: string;
  };
  icon: {
    primary: string;
    secondary: string;
    accent: string;
  };
```

In `ThemeStyle.shadow`, after `lg: string;`:

```
    lg: string;
    popover: string;
    modal: string;
```

In `ThemeStyle.transition`:

```
  transition: { duration: string; fast: string; slow: string; easing: string };
```

- [ ] **Run typecheck to confirm no breakage yet**

Run: `pnpm typecheck`
Expected: Type errors because existing theme files are missing the new required fields (expected — we'll fix them next).

---

### Task 2: Update generate-css.ts

**Files:**

- Modify: `apps/desktop/src/themes/generate-css.ts`

- [ ] **Add brand, icon, content-link, surface-floating to flattenTokens()**

After `vars['--surface-sidebar']` line, add:

```ts
vars['--surface-floating'] = colors.surface.floating;
```

After `vars['--content-inverse']` line, add:

```ts
vars['--content-link'] = colors.content.link;
```

After existing code block (after syntax tokens, before graph), add brand and icon:

```ts
// Brand backgrounds
for (const [name, color] of Object.entries(colors.brand)) {
  vars[`--brand-${name}`] = color;
}

// Icon colors
vars['--icon-primary'] = colors.icon.primary;
vars['--icon-secondary'] = colors.icon.secondary;
vars['--icon-accent'] = colors.icon.accent;
```

In the shadow section, after `vars['--shadow-lg']`, add:

```ts
vars['--shadow-popover'] = style.shadow.popover;
vars['--shadow-modal'] = style.shadow.modal;
```

Replace the existing transition section:

```ts
// Style: transition
vars['--duration'] = style.transition.duration;
vars['--duration-fast'] = style.transition.fast;
vars['--duration-slow'] = style.transition.slow;
vars['--easing'] = style.transition.easing;
```

- [ ] **Verify with pnpm gen:theme** (will still fail until theme files are updated — expected)

---

### Task 3: Update light-default.ts

**Files:**

- Modify: `apps/desktop/src/themes/light-default.ts`

- [ ] **Add all new fields**

In `surface`, after `sidebar: '#FFFFFF',`:

```
      sidebar: '#FFFFFF',
      floating: '#FFFFFF',
```

In `content`, after `inverse: '#FFFFFF',`:

```
      inverse: '#FFFFFF',
      link: '#2563EB',
```

After `chart: { ... },` closing brace and before `};` of colors, add brand and icon:

```
    chart: { ... },
    brand: {
      accent: '#EEF2FF',
      success: '#F0FDF4',
      danger: '#FEF2F2',
      warning: '#FFFBEB',
      info: '#EFF6FF',
      purple: '#FAF5FF',
    },
    icon: {
      primary: '#1A1A1A',
      secondary: '#6E6E6E',
      accent: '#4F46E5',
    },
```

In `shadow`, after `lg: ...`:

```
      lg: '0px 1px 1px rgba(0,0,0,0.03), 0px 8px 16px -4px rgba(0,0,0,0.06), 0px 24px 32px -8px rgba(0,0,0,0.08)',
      popover: '0px 4px 16px rgba(0,0,0,0.08), 0px 1px 2px rgba(0,0,0,0.06)',
      modal: '0px 8px 32px rgba(0,0,0,0.12), 0px 2px 8px rgba(0,0,0,0.08)',
```

In `transition`, change the definition to include fast and slow:

```
    transition: { duration: '200ms', fast: '100ms', slow: '400ms', easing: 'ease' },
```

---

### Task 4: Update dark-default.ts

**Files:**

- Modify: `apps/desktop/src/themes/dark-default.ts`

- [ ] **Add all new fields**

Same pattern as light-default but with dark values:

```ts
// In surface
sidebar: '#1A1A1A',
floating: '#2A2A2A',

// In content
inverse: '#1A1A1A',
link: '#60A5FA',

// brand
brand: {
  accent: '#1E1B4B',
  success: '#052E16',
  danger: '#450A0A',
  warning: '#451A03',
  info: '#172554',
  purple: '#2E1065',
},
icon: {
  primary: '#F3F4F6',
  secondary: '#9CA3AF',
  accent: '#818CF8',
},

// shadow
popover: '0px 4px 16px rgba(0,0,0,0.30), 0px 1px 2px rgba(0,0,0,0.20)',
modal: '0px 8px 32px rgba(0,0,0,0.40), 0px 2px 8px rgba(0,0,0,0.25)',

// transition
transition: { duration: '200ms', fast: '100ms', slow: '400ms', easing: 'ease' },
```

---

### Task 5: Update 13 non-default themes

**Files:** (all 13)

- Modify: `apps/desktop/src/themes/warm.ts`
- Modify: `apps/desktop/src/themes/zen.ts`
- Modify: `apps/desktop/src/themes/brutalism.ts`
- Modify: `apps/desktop/src/themes/synthwave.ts`
- Modify: `apps/desktop/src/themes/vaporwave.ts`
- Modify: `apps/desktop/src/themes/cyberpunk.ts`
- Modify: `apps/desktop/src/themes/techno.ts`
- Modify: `apps/desktop/src/themes/polar.ts`
- Modify: `apps/desktop/src/themes/pixel-by.ts`
- Modify: `apps/desktop/src/themes/geek.ts`
- Modify: `apps/desktop/src/themes/afrofuturism.ts`
- Modify: `apps/desktop/src/themes/sumi-e.ts`
- Modify: `apps/desktop/src/themes/showa-retro.ts`

Each theme needs the same structural changes:

- [ ] **Per-theme changes (repeat for all 13)**:

For each theme file, based on its existing values:

**surface.floating**: = `surface.primary` (for light themes) or slightly lighter than `surface.primary` (for dark themes)

**content.link**:

- warm: `'#C0653A'`
- zen: `'#7A8B6F'` (= accent)
- brutalism: `'#E53E3E'` (= accent)
- synthwave: `'#00D4FF'` (cyan)
- vaporwave: `'#00D4FF'` (cyan)
- cyberpunk: `'#66FCF1'` (= accent)
- techno: `'#F4C542'` (= accent)
- polar: `'#4A90D9'` (= accent)
- pixel-by: `'#2563EB'` (= accent)
- geek: `'#66FF66'` (brighter green)
- afrofuturism: `'#E5C687'` (= accent)
- sumi-e: `'#4A4A4A'`
- showa-retro: `'#D4624A'` (= accent)

**brand.\***: For each theme, compute via `color-mix(in srgb, intent.X.color, 15%)` against the theme's surface-primary. Use the resulting hex value.

For quick estimation:
| Theme | accent hex | brand.accent (15% mix over primary) |
|-------|-----------|-------------------------------------|
| warm | #D4764A | `#F6EAE3` |
| zen | #7A8B6F | `#F0F0EB` |
| brutalism | #E53E3E | `#FDE8E8` |
| synthwave | #FF007F | `#22002B` |
| vaporwave | #FF71CE | `#3A1060` |
| cyberpunk | #66FCF1 | `#1A2A33` |
| techno | #F4C542 | `#2C2A1C` |
| polar | #4A90D9 | `#E8F0F8` |
| pixel-by | #2563EB | `#E8EEFF` |
| geek | #33FF33 | `#0A1A0A` |
| afrofuturism | #E5C687 | `#3A3040` |
| sumi-e | #2B2B2B | `#F0EDE8` |
| showa-retro | #D4624A | `#FCEFEA` |

**icon.\***: = content.primary, content.secondary, accent.base respectively.

**transition**: All get `{ duration: ...existing..., fast: '100ms', slow: '400ms', easing: ...existing... }`

**shadow.popover/modal**: Scale up existing shadow.lg by ~2x. For themes with colored glows, create a stronger glow. For hard offset themes, double the offset.

---

### Task 6: Update index.css

**Files:**

- Modify: `apps/desktop/src/index.css`

- [ ] **Add @theme inline mappings**

After existing surface mappings, add:

```
  --color-surface-floating: var(--surface-floating);
```

After `--color-content-inverse: var(--content-inverse);` add:

```
  --color-content-link: var(--content-link);
```

After chart mappings, add brand and icon:

```
  --color-brand-accent: var(--brand-accent);
  --color-brand-success: var(--brand-success);
  --color-brand-danger: var(--brand-danger);
  --color-brand-warning: var(--brand-warning);
  --color-brand-info: var(--brand-info);
  --color-brand-purple: var(--brand-purple);
  --color-icon-primary: var(--icon-primary);
  --color-icon-secondary: var(--icon-secondary);
  --color-icon-accent: var(--icon-accent);
```

After shadow mappings, add:

```
  --shadow-popover: var(--shadow-popover);
  --shadow-modal: var(--shadow-modal);
```

After `--default-transition-duration: var(--duration);` add:

```
  --duration-fast: var(--duration-fast);
  --duration-slow: var(--duration-slow);
```

Also update the `.markdown-body a` rule to use `var(--content-link)` instead of `var(--accent)`:
Find: `.markdown-body a { color: var(--accent);`
Replace: `.markdown-body a { color: var(--content-link);`

---

### Task 7: Regenerate and verify

- [ ] **Regenerate themes**

Run: `pnpm gen:theme`
Expected: `Generated .../generated.css`

- [ ] **Typecheck**

Run: `pnpm typecheck`
Expected: exit code 0, no errors

- [ ] **Run tests**

Run: `pnpm test`
Expected: all tests pass (11 files, 74+ passed)

- [ ] **Server tests**

Run: `cd ../../server && pnpm test`
Expected: all tests pass (13 files, 131+ passed)
