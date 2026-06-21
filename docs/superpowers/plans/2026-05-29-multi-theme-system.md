# Multi-Theme System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace binary light/dark toggle with a multi-theme system where each theme is a flat TS object (57 tokens), CSS is generated at build time, and users select themes from a TitleBar dropdown.

**Architecture:** TS theme registry → build-time CSS generation → `data-theme` attribute on `<html>` → Tailwind reads CSS variables (unchanged mapping). No more `.dark` class or `darkMode: 'class'`.

**Tech Stack:** TypeScript, React, Tailwind CSS, CSS custom properties, Vite

---

### Task 1: Create theme TypeScript types

**Files:**

- Create: `apps/desktop/src/themes/types.ts`

- [ ] **Step 1: Write the types file**

```typescript
// apps/desktop/src/themes/types.ts

export interface ThemeColors {
  surface: {
    primary: string;
    elevated: string;
    overlay: string;
    input: string;
    muted: string;
  };
  content: {
    primary: string;
    secondary: string;
    tertiary: string;
    inverse: string;
  };
  border: {
    color: string;
    subtle: string;
  };
  accent: {
    base: string;
    hover: string;
    muted: string;
    foreground: string;
  };
  intent: {
    success: { color: string; muted: string; foreground: string };
    danger: { color: string; muted: string; foreground: string };
    warning: { color: string; muted: string; foreground: string };
    info: { color: string; muted: string; foreground: string };
    purple: { color: string; muted: string; foreground: string };
  };
}

export interface ThemeStyle {
  radius: { sm: string; md: string; lg: string; xl: string };
  shadow: { sm: string; md: string; lg: string };
  font: { family: string; display: string; letterSpacing: string; lineHeight: string };
  border: { width: string };
  transition: { duration: string; easing: string };
  opacity: { hover: string; disabled: string; overlay: string };
  glass: { blur: string; opacity: string };
  focusRing: { width: string; color: string; offset: string };
  selection: { bg: string; fg: string };
  scrollbar: { width: string; thumb: string; track: string };
}

export interface Theme {
  id: string;
  name: string;
  colors: ThemeColors;
  style: ThemeStyle;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/desktop && npx tsc --noEmit src/themes/types.ts
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/themes/types.ts
git commit -m "feat(theme): add Theme, ThemeColors, ThemeStyle type definitions"
```

---

### Task 2: Create light-default theme

**Files:**

- Create: `apps/desktop/src/themes/light-default.ts`

- [ ] **Step 1: Write the light-default theme**

```typescript
// apps/desktop/src/themes/light-default.ts
import type { Theme } from './types';

export const lightDefault: Theme = {
  id: 'light-default',
  name: '亮色默认',
  colors: {
    surface: {
      primary: '#ffffff',
      elevated: '#f9fafb',
      overlay: '#ffffff',
      input: '#ffffff',
      muted: '#f3f4f6',
    },
    content: {
      primary: '#111827',
      secondary: '#6b7280',
      tertiary: '#9ca3af',
      inverse: '#ffffff',
    },
    border: {
      color: '#e5e7eb',
      subtle: '#f3f4f6',
    },
    accent: {
      base: '#3b82f6',
      hover: '#2563eb',
      muted: 'rgba(59, 130, 246, 0.12)',
      foreground: '#ffffff',
    },
    intent: {
      success: { color: '#16a34a', muted: 'rgba(22, 163, 74, 0.12)', foreground: '#ffffff' },
      danger: { color: '#dc2626', muted: 'rgba(220, 38, 38, 0.12)', foreground: '#ffffff' },
      warning: { color: '#d97706', muted: 'rgba(217, 119, 6, 0.12)', foreground: '#ffffff' },
      info: { color: '#2563eb', muted: 'rgba(37, 99, 235, 0.12)', foreground: '#ffffff' },
      purple: { color: '#9333ea', muted: 'rgba(147, 51, 234, 0.12)', foreground: '#ffffff' },
    },
  },
  style: {
    radius: { sm: '4px', md: '8px', lg: '12px', xl: '16px' },
    shadow: {
      sm: '0 1px 3px rgba(0,0,0,0.06)',
      md: '0 4px 12px rgba(0,0,0,0.08)',
      lg: '0 16px 48px rgba(0,0,0,0.15)',
    },
    font: {
      family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      display: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      letterSpacing: '0',
      lineHeight: '1.5',
    },
    border: { width: '1px' },
    transition: { duration: '150ms', easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
    opacity: { hover: '0.85', disabled: '0.4', overlay: '0.5' },
    glass: { blur: '0px', opacity: '1' },
    focusRing: { width: '2px', color: 'rgba(59,130,246,0.4)', offset: '2px' },
    selection: { bg: '#3b82f6', fg: '#ffffff' },
    scrollbar: { width: '5px', thumb: '#cbd5e1', track: 'transparent' },
  },
};
```

- [ ] **Step 2: Verify the import resolves**

```bash
cd apps/desktop && npx tsc --noEmit src/themes/light-default.ts
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/themes/light-default.ts
git commit -m "feat(theme): add light-default theme definition"
```

---

### Task 3: Create dark-default theme

**Files:**

- Create: `apps/desktop/src/themes/dark-default.ts`

- [ ] **Step 1: Write the dark-default theme**

```typescript
// apps/desktop/src/themes/dark-default.ts
import type { Theme } from './types';

export const darkDefault: Theme = {
  id: 'dark-default',
  name: '暗色默认',
  colors: {
    surface: {
      primary: '#1f2937',
      elevated: '#111827',
      overlay: '#1f2937',
      input: '#374151',
      muted: '#374151',
    },
    content: {
      primary: '#f9fafb',
      secondary: '#9ca3af',
      tertiary: '#6b7280',
      inverse: '#111827',
    },
    border: {
      color: '#374151',
      subtle: '#4b5563',
    },
    accent: {
      base: '#3b82f6',
      hover: '#60a5fa',
      muted: 'rgba(59, 130, 246, 0.25)',
      foreground: '#ffffff',
    },
    intent: {
      success: { color: '#22c55e', muted: 'rgba(34, 197, 94, 0.2)', foreground: '#ffffff' },
      danger: { color: '#ef4444', muted: 'rgba(239, 68, 68, 0.2)', foreground: '#ffffff' },
      warning: { color: '#f59e0b', muted: 'rgba(245, 158, 11, 0.2)', foreground: '#111827' },
      info: { color: '#3b82f6', muted: 'rgba(59, 130, 246, 0.25)', foreground: '#ffffff' },
      purple: { color: '#a855f7', muted: 'rgba(168, 85, 247, 0.25)', foreground: '#ffffff' },
    },
  },
  style: {
    radius: { sm: '4px', md: '8px', lg: '12px', xl: '16px' },
    shadow: {
      sm: '0 1px 3px rgba(0,0,0,0.2)',
      md: '0 4px 12px rgba(0,0,0,0.3)',
      lg: '0 16px 48px rgba(0,0,0,0.4)',
    },
    font: {
      family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      display: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      letterSpacing: '0',
      lineHeight: '1.5',
    },
    border: { width: '1px' },
    transition: { duration: '150ms', easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
    opacity: { hover: '0.85', disabled: '0.4', overlay: '0.5' },
    glass: { blur: '0px', opacity: '1' },
    focusRing: { width: '2px', color: 'rgba(59,130,246,0.5)', offset: '2px' },
    selection: { bg: '#3b82f6', fg: '#ffffff' },
    scrollbar: { width: '5px', thumb: '#4b5563', track: 'transparent' },
  },
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/desktop && npx tsc --noEmit src/themes/dark-default.ts
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/themes/dark-default.ts
git commit -m "feat(theme): add dark-default theme definition"
```

---

### Task 4: Create theme registry

**Files:**

- Create: `apps/desktop/src/themes/registry.ts`

- [ ] **Step 1: Write the registry**

```typescript
// apps/desktop/src/themes/registry.ts
import type { Theme } from './types';
import { lightDefault } from './light-default';
import { darkDefault } from './dark-default';

export const registry: Theme[] = [lightDefault, darkDefault];

export const defaultTheme = lightDefault;

export function getTheme(id: string): Theme | undefined {
  return registry.find((t) => t.id === id);
}
```

- [ ] **Step 2: Verify**

```bash
cd apps/desktop && npx tsc --noEmit src/themes/registry.ts
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/themes/registry.ts
git commit -m "feat(theme): add theme registry"
```

---

### Task 5: Create CSS generator

**Files:**

- Create: `apps/desktop/src/themes/generate-css.ts`

- [ ] **Step 1: Write the generator**

```typescript
// apps/desktop/src/themes/generate-css.ts
// Run: npx tsx src/themes/generate-css.ts
// Outputs: src/themes/generated.css

import { registry } from './registry';
import type { Theme } from './types';
import * as fs from 'fs';
import * as path from 'path';

function flattenTokens(theme: Theme): Record<string, string> {
  const { colors, style } = theme;
  const vars: Record<string, string> = {};

  // Surface
  vars['--surface-primary'] = colors.surface.primary;
  vars['--surface-elevated'] = colors.surface.elevated;
  vars['--surface-overlay'] = colors.surface.overlay;
  vars['--surface-input'] = colors.surface.input;
  vars['--surface-muted'] = colors.surface.muted;

  // Content
  vars['--content-primary'] = colors.content.primary;
  vars['--content-secondary'] = colors.content.secondary;
  vars['--content-tertiary'] = colors.content.tertiary;
  vars['--content-inverse'] = colors.content.inverse;

  // Border
  vars['--border-color'] = colors.border.color;
  vars['--border-subtle'] = colors.border.subtle;

  // Accent
  vars['--accent'] = colors.accent.base;
  vars['--accent-hover'] = colors.accent.hover;
  vars['--accent-muted'] = colors.accent.muted;
  vars['--accent-foreground'] = colors.accent.foreground;

  // Intent
  for (const name of ['success', 'danger', 'warning', 'info', 'purple'] as const) {
    const i = colors.intent[name];
    vars[`--intent-${name}`] = i.color;
    vars[`--intent-${name}-muted`] = i.muted;
    vars[`--intent-${name}-foreground`] = i.foreground;
  }

  // Style: radius
  vars['--radius-sm'] = style.radius.sm;
  vars['--radius-md'] = style.radius.md;
  vars['--radius-lg'] = style.radius.lg;
  vars['--radius-xl'] = style.radius.xl;

  // Style: shadow
  vars['--shadow-sm'] = style.shadow.sm;
  vars['--shadow-md'] = style.shadow.md;
  vars['--shadow-lg'] = style.shadow.lg;

  // Style: font
  vars['--font-family'] = style.font.family;
  vars['--font-display'] = style.font.display;
  vars['--letter-spacing'] = style.font.letterSpacing;
  vars['--line-height'] = style.font.lineHeight;

  // Style: border
  vars['--border-width'] = style.border.width;

  // Style: transition
  vars['--duration'] = style.transition.duration;
  vars['--easing'] = style.transition.easing;

  // Style: opacity
  vars['--opacity-hover'] = style.opacity.hover;
  vars['--opacity-disabled'] = style.opacity.disabled;
  vars['--opacity-overlay'] = style.opacity.overlay;

  // Style: glass
  vars['--blur-amount'] = style.glass.blur;
  vars['--glass-opacity'] = style.glass.opacity;

  // Style: focus ring
  vars['--focus-ring-width'] = style.focusRing.width;
  vars['--focus-ring-color'] = style.focusRing.color;
  vars['--focus-ring-offset'] = style.focusRing.offset;

  // Style: selection
  vars['--selection-bg'] = style.selection.bg;
  vars['--selection-fg'] = style.selection.fg;

  // Style: scrollbar
  vars['--scrollbar-width'] = style.scrollbar.width;
  vars['--scrollbar-thumb'] = style.scrollbar.thumb;
  vars['--scrollbar-track'] = style.scrollbar.track;

  return vars;
}

function generateCSS(): string {
  let css = '/* Auto-generated by generate-css.ts — do not edit */\n\n';
  for (const theme of registry) {
    const vars = flattenTokens(theme);
    css += `[data-theme="${theme.id}"] {\n`;
    for (const [key, value] of Object.entries(vars)) {
      css += `  ${key}: ${value};\n`;
    }
    css += '}\n\n';
  }
  return css;
}

const outPath = path.resolve(__dirname, 'generated.css');
fs.writeFileSync(outPath, generateCSS());
console.log(`Generated ${outPath}`);
```

- [ ] **Step 2: Run the generator**

```bash
cd apps/desktop && npx tsx src/themes/generate-css.ts
```

Expected: `Generated .../apps/desktop/src/themes/generated.css`

- [ ] **Step 3: Inspect generated output**

```bash
head -20 apps/desktop/src/themes/generated.css
```

Expected: `/* Auto-generated... */` followed by `[data-theme="light-default"] {` with CSS variables.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/themes/generate-css.ts apps/desktop/src/themes/generated.css
git commit -m "feat(theme): add CSS generator and generated output"
```

---

### Task 6: Add CSS generation to package.json scripts

**Files:**

- Modify: `apps/desktop/package.json`

- [ ] **Step 1: Read current scripts**

Read `apps/desktop/package.json` to find the `"scripts"` block.

- [ ] **Step 2: Add theme generation pre-script**

Add a `gen:theme` script and prepend it to `dev` and `build`:

```json
"scripts": {
  "gen:theme": "npx tsx src/themes/generate-css.ts",
  "dev": "npm run gen:theme && vite",
  "build": "npm run gen:theme && tsc -b && vite build",
  ...
}
```

If the existing scripts use `&&` chains, adjust accordingly. The key is `gen:theme` runs first.

- [ ] **Step 3: Verify the script runs standalone**

```bash
cd apps/desktop && npm run gen:theme
```

Expected: runs without error, outputs `Generated ...`

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/package.json
git commit -m "build(theme): add gen:theme script, run before dev and build"
```

---

### Task 7: Rewrite index.css

**Files:**

- Modify: `apps/desktop/src/index.css`

- [ ] **Step 1: Replace index.css**

Remove the `:root { ... }` block (lines 5-63), `.dark { ... }` block (lines 65-123), and the legacy CSS variables. Add the generated CSS import. Also update scrollbar to use style tokens and replace hardcoded `var(--bg-primary)` / `var(--text-primary)` on `body` with new tokens. Replace `.dark` syntax highlighting selectors with a theme-agnostic approach (remove `.dark` prefix since we no longer toggle that class — syntax highlighting colors will rely on CSS variables if needed, or for now the `.dark` selectors become no-ops).

Write `apps/desktop/src/index.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* Generated theme CSS — all [data-theme="X"] blocks */
@import './themes/generated.css';

body {
  margin: 0;
  font-family: var(--font-family);
  background-color: var(--surface-elevated);
  color: var(--content-primary);
  transition:
    background-color var(--duration) var(--easing),
    color var(--duration) var(--easing);
  overflow: hidden;
}

/* Scrollbar — uses style tokens */
::-webkit-scrollbar {
  width: var(--scrollbar-width);
  height: var(--scrollbar-width);
}
::-webkit-scrollbar-track {
  background: var(--scrollbar-track);
}
::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: var(--content-secondary);
}

/* Firefox scrollbar */
* {
  scrollbar-width: thin;
  scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
}

/* Selection */
::selection {
  background: var(--selection-bg);
  color: var(--selection-fg);
}

/* Focus ring */
:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}

/* Title bar drag region */
[data-tauri-drag-region] {
  -webkit-app-region: drag;
}
[data-tauri-drag-region] button,
[data-tauri-drag-region] input,
[data-tauri-drag-region] a {
  -webkit-app-region: no-drag;
}

/* Pulse animation for active session indicator */
@keyframes pulse-dot {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}
.animate-pulse-dot {
  animation: pulse-dot 1.5s ease-in-out infinite;
}

/* Toast slide-in */
@keyframes slide-in {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}
.animate-slide-in {
  animation: slide-in 0.3s ease-out;
}

/* react-grid-layout overrides */
.react-grid-item.react-grid-placeholder {
  background: var(--accent) !important;
  border-radius: 8px;
  opacity: 0.15;
}

/* Markdown content */
.markdown-body h1 {
  font-size: 1.25rem;
  font-weight: 700;
  margin: 0.75rem 0 0.5rem;
}
.markdown-body h2 {
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0.5rem 0 0.25rem;
}
.markdown-body h3 {
  font-size: 1rem;
  font-weight: 600;
  margin: 0.5rem 0 0.25rem;
}
.markdown-body p {
  margin: 0.25rem 0;
}
.markdown-body ul,
.markdown-body ol {
  padding-left: 1.25rem;
  margin: 0.25rem 0;
}
.markdown-body li {
  margin: 0.125rem 0;
}
.markdown-body a {
  color: var(--accent);
  text-decoration: underline;
}
.markdown-body blockquote {
  border-left: 3px solid var(--border-color);
  padding-left: 0.75rem;
  margin: 0.25rem 0;
  color: var(--content-secondary);
}
.markdown-body table {
  border-collapse: collapse;
  width: 100%;
  margin: 0.25rem 0;
}
.markdown-body th,
.markdown-body td {
  border: 1px solid var(--border-color);
  padding: 0.25rem 0.5rem;
  text-align: left;
  font-size: 0.75rem;
}
.markdown-body th {
  background: var(--surface-muted);
  font-weight: 600;
}
.markdown-body .code-block {
  margin: 0.5rem 0;
  padding: 0.75rem;
  border-radius: 0.375rem;
  background: var(--surface-muted);
  border: 1px solid var(--border-color);
  overflow-x: auto;
  font-size: 0.75rem;
  line-height: 1.5;
}
.markdown-body .code-block code {
  font-family: 'Fira Code', 'Cascadia Code', monospace;
}
.markdown-body .code-block.bash {
  background: #1a1a2e;
  color: #4ade80;
  border-color: #334155;
}
.markdown-body .code-block.bash code::before {
  content: '$ ';
  color: var(--content-secondary);
}

/* Syntax highlighting — keep light defaults, .dark prefixed rules are no-ops now */
.hljs-keyword {
  color: #d73a49;
  font-weight: 600;
}
.hljs-string {
  color: #032f62;
}
.hljs-number {
  color: #005cc5;
}
.hljs-comment {
  color: #6a737d;
  font-style: italic;
}
.hljs-function {
  color: #6f42c1;
}
.hljs-class {
  color: #6f42c1;
  font-weight: 600;
}
.hljs-variable {
  color: #24292e;
}
.hljs-operator {
  color: #d73a49;
}
.hljs-punctuation {
  color: #24292e;
}
.hljs-property {
  color: #005cc5;
}
.hljs-tag {
  color: #22863a;
}
.hljs-attr {
  color: #6f42c1;
}
.hljs-built_in {
  color: #005cc5;
}
.hljs-literal {
  color: #005cc5;
}
.hljs-params {
  color: #24292e;
}

/* Skill tag */
.skill-tag {
  display: inline-block;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--accent-muted);
  color: var(--accent);
  font-weight: 500;
  font-size: 0.75rem;
}

/* Thinking block */
.thinking-block {
  margin-bottom: 0.5rem;
  border-left: 3px solid var(--accent);
  padding-left: 0.75rem;
  color: var(--content-secondary);
  font-size: 0.8125rem;
}
.thinking-summary {
  cursor: pointer;
  font-size: 0.6875rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--content-tertiary);
  margin-bottom: 0.25rem;
  user-select: none;
}
.thinking-content {
  white-space: pre-wrap;
  line-height: 1.5;
}

/* Tool call indicators */
.tool-summary {
  margin-bottom: 0.5rem;
  font-size: 0.75rem;
}
.tool-summary.streaming {
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(59, 130, 246, 0.06);
  border: 1px solid rgba(59, 130, 246, 0.2);
}
.tool-summary-indicator {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--accent);
  font-weight: 500;
}
.tool-summary-spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid rgba(59, 130, 246, 0.3);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.tool-summary.done {
  color: var(--content-secondary);
}
.tool-summary-toggle {
  cursor: pointer;
  font-size: 0.6875rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--content-tertiary);
  user-select: none;
}
.tool-summary-toggle:hover {
  color: var(--content-secondary);
}
.tool-summary-inline {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-left: 8px;
  vertical-align: middle;
}
.tool-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  border-radius: 10px;
  background: var(--surface-muted);
  font-size: 0.6875rem;
  color: var(--content-secondary);
}
.tool-chip-icon {
  font-size: 0.625rem;
}
.tool-chip-name {
  font-weight: 500;
}
.tool-chip-count {
  color: var(--content-tertiary);
}
.tool-chip-more {
  font-size: 0.625rem;
  color: var(--content-tertiary);
  padding: 1px 4px;
}
.tool-summary-list {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.tool-summary-badge.chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--surface-muted);
  font-size: 0.6875rem;
}
.tool-group-row {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--surface-muted);
  font-size: 0.6875rem;
  color: var(--content-secondary);
}
.tool-group-icon {
  font-size: 0.625rem;
}
.tool-group-name {
  font-weight: 500;
}
.tool-group-count {
  color: var(--content-tertiary);
  font-size: 0.625rem;
}
.tool-group-errors {
  color: var(--intent-danger);
  font-size: 0.625rem;
}

/* Responsive */
@media (max-width: 768px) {
  .page-container {
    padding: 0.75rem;
  }
  .card-grid {
    grid-template-columns: repeat(1, 1fr);
  }
}
```

- [ ] **Step 2: Verify CSS parses without errors**

```bash
cd apps/desktop && npx tailwindcss --input src/index.css --output /dev/null --dry-run 2>&1 || echo "Check output manually — Tailwind may not have --dry-run"
```

Alternative: check that Vite dev server starts without CSS errors in a later task.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/index.css
git commit -m "refactor(theme): replace :root/.dark blocks with generated theme CSS"
```

---

### Task 8: Update tailwind.config.js

**Files:**

- Modify: `apps/desktop/tailwind.config.js`

- [ ] **Step 1: Apply changes**

Remove `darkMode: 'class'`, change borderRadius to CSS variable references, add transition defaults.

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    '../../packages/ui/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          primary: 'var(--surface-primary)',
          elevated: 'var(--surface-elevated)',
          overlay: 'var(--surface-overlay)',
          input: 'var(--surface-input)',
          muted: 'var(--surface-muted)',
        },
        content: {
          primary: 'var(--content-primary)',
          secondary: 'var(--content-secondary)',
          tertiary: 'var(--content-tertiary)',
          inverse: 'var(--content-inverse)',
        },
        border: {
          DEFAULT: 'var(--border-color)',
          subtle: 'var(--border-subtle)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          muted: 'var(--accent-muted)',
          foreground: 'var(--accent-foreground)',
        },
        intent: {
          success: 'var(--intent-success)',
          'success-muted': 'var(--intent-success-muted)',
          'success-foreground': 'var(--intent-success-foreground)',
          danger: 'var(--intent-danger)',
          'danger-muted': 'var(--intent-danger-muted)',
          'danger-foreground': 'var(--intent-danger-foreground)',
          warning: 'var(--intent-warning)',
          'warning-muted': 'var(--intent-warning-muted)',
          'warning-foreground': 'var(--intent-warning-foreground)',
          info: 'var(--intent-info)',
          'info-muted': 'var(--intent-info-muted)',
          'info-foreground': 'var(--intent-info-foreground)',
          purple: 'var(--intent-purple)',
          'purple-muted': 'var(--intent-purple-muted)',
          'purple-foreground': 'var(--intent-purple-foreground)',
        },
      },
      borderRadius: {
        'ui-sm': 'var(--radius-sm)',
        'ui-md': 'var(--radius-md)',
        'ui-lg': 'var(--radius-lg)',
        'ui-xl': 'var(--radius-xl)',
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
        '3xs': ['0.6875rem', { lineHeight: '0.875rem' }],
      },
      transitionDuration: {
        DEFAULT: 'var(--duration)',
      },
      transitionTimingFunction: {
        DEFAULT: 'var(--easing)',
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 2: Verify config is valid**

```bash
cd apps/desktop && npx tailwindcss --help > /dev/null && echo "Tailwind CLI OK"
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/tailwind.config.js
git commit -m "refactor(theme): remove darkMode class, map radius/transition to CSS vars"
```

---

### Task 9: Rewrite useTheme hook

**Files:**

- Modify: `apps/desktop/src/hooks/useTheme.tsx`

- [ ] **Step 1: Write the new hook**

```typescript
// apps/desktop/src/hooks/useTheme.tsx
import { useState, useEffect, createContext, useContext, useCallback } from 'react';
import { registry, defaultTheme, getTheme } from '../themes/registry';
import { getStorageItem, setStorageItem } from '../utils/storage';

interface ThemeContextValue {
  theme: string;
  themes: { id: string; name: string }[];
  setTheme: (id: string) => void;
}

function useThemeState(): ThemeContextValue {
  const [theme, setThemeState] = useState(() => {
    const stored = getStorageItem('cabinet-theme');
    if (stored && getTheme(stored)) return stored;
    return defaultTheme.id;
  });

  const setTheme = useCallback((id: string) => {
    if (!getTheme(id)) return;
    setThemeState(id);
    setStorageItem('cabinet-theme', id);
    document.documentElement.setAttribute('data-theme', id);
  }, []);

  // Initialize data-theme on mount (before first paint, but useEffect runs after)
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const themes = registry.map((t) => ({ id: t.id, name: t.name }));

  return { theme, themes, setTheme };
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const value = useThemeState();
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  const fallback = useThemeState();
  return ctx ?? fallback;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/desktop && npx tsc --noEmit src/hooks/useTheme.tsx
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/hooks/useTheme.tsx
git commit -m "refactor(theme): rewrite useTheme from boolean toggle to theme ID management"
```

---

### Task 10: Update TitleBar with theme dropdown

**Files:**

- Modify: `apps/desktop/src/components/TitleBar.tsx`

- [ ] **Step 1: Replace the theme button**

Change the props interface from `onToggleTheme` to `onSetTheme` + `themes` + `currentTheme`, replace Sun/Moon button with a dropdown.

Apply this edit to `apps/desktop/src/components/TitleBar.tsx`:

Change the import (line 2):

```typescript
- import { Sun, Moon, Minus, Maximize2, RectangleHorizontal, X } from 'lucide-react';
+ import { Palette, Minus, Maximize2, RectangleHorizontal, X, ChevronDown } from 'lucide-react';
```

Change the props (line 36):

```typescript
- export function TitleBar({ onToggleTheme }: { onToggleTheme?: () => void }) {
+ interface ThemeInfo { id: string; name: string; }
+ export function TitleBar({
+   themes,
+   currentTheme,
+   onSetTheme,
+ }: {
+   themes: ThemeInfo[];
+   currentTheme: string;
+   onSetTheme?: (id: string) => void;
+ }) {
```

Add dropdown state (after `const { available } = useTauriWindow();`):

```typescript
const [themeOpen, setThemeOpen] = useState(false);
const currentThemeName = themes.find((t) => t.id === currentTheme)?.name ?? 'Theme';
```

Replace the theme button (lines 92-99):

```typescript
-        <button
-          onClick={onToggleTheme}
-          className={`flex h-full w-8 items-center justify-center transition-colors ${btnHover}`}
-          aria-label="Toggle theme"
-        >
-          <Sun size={14} className="block dark:hidden" />
-          <Moon size={14} className="hidden dark:block" />
-        </button>
+        <div className="relative">
+          <button
+            onClick={() => setThemeOpen((v) => !v)}
+            className={`flex h-full items-center gap-1 px-2 text-xs transition-colors ${btnHover}`}
+            aria-label="Select theme"
+          >
+            <Palette size={14} />
+            <span className="hidden sm:inline">{currentThemeName}</span>
+            <ChevronDown size={10} />
+          </button>
+          {themeOpen && (
+            <>
+              <div className="fixed inset-0 z-40" onClick={() => setThemeOpen(false)} />
+              <div className="absolute right-0 top-full z-50 mt-1 min-w-[120px] rounded-md border border-gray-200 bg-white py-1 shadow-lg">
+                {themes.map((t) => (
+                  <button
+                    key={t.id}
+                    onClick={() => { onSetTheme?.(t.id); setThemeOpen(false); }}
+                    className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-gray-100 ${
+                      t.id === currentTheme
+                        ? 'font-semibold text-blue-600'
+                        : 'text-gray-700'
+                    }`}
+                  >
+                    {t.name}
+                  </button>
+                ))}
+              </div>
+            </>
+          )}
+        </div>
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/components/TitleBar.tsx
git commit -m "feat(theme): replace Sun/Moon button with theme dropdown in TitleBar"
```

---

### Task 11: Update App.tsx to pass new theme props

**Files:**

- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: Change App.tsx to use new useTheme API**

Replace line 72:

```typescript
- const { toggle } = useTheme();
+ const { theme, themes, setTheme } = useTheme();
```

Replace line 680 (the TitleBar prop):

```typescript
- <TitleBar onToggleTheme={toggle} />
+ <TitleBar themes={themes} currentTheme={theme} onSetTheme={setTheme} />
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/desktop && npx tsc --noEmit src/App.tsx
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/App.tsx
git commit -m "refactor(theme): update App to pass theme list instead of toggle"
```

---

### Task 12: Fix ThemeTab for new useTheme API

**Files:**

- Modify: `apps/desktop/src/pages/settings/ThemeTab.tsx`

- [ ] **Step 1: Update to new API**

The ThemeTab currently uses `isDark` and `toggle`. Update it to work with the new API — render the theme list with selection.

```typescript
// apps/desktop/src/pages/settings/ThemeTab.tsx
import { useTheme } from '../../hooks/useTheme';

export function ThemeTab() {
  const { theme: currentTheme, themes, setTheme } = useTheme();

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold text-gray-900">
        Theme
      </h2>
      <div className="max-w-md space-y-4">
        <div className="rounded-lg border bg-white p-4">
          <div className="mb-3 text-sm font-medium text-gray-900">
            Select Theme
          </div>
          <div className="space-y-1">
            {themes.map((t) => (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                className={`block w-full rounded px-3 py-2 text-left text-sm transition-colors ${
                  t.id === currentTheme
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-700 hover:bg-gray-50'
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/desktop && npx tsc --noEmit src/pages/settings/ThemeTab.tsx
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/pages/settings/ThemeTab.tsx
git commit -m "refactor(theme): update ThemeTab to render theme list with new API"
```

---

### Task 13: Integration verification

- [ ] **Step 1: Start the dev server**

```bash
cd apps/desktop && npm run dev
```

- [ ] **Step 2: Check browser console for errors**

Open the app in the browser at the Vite dev server URL. Check the browser console (F12) for any CSS or JS errors.

Expected: no errors. The app should render with the light-default theme.

- [ ] **Step 3: Test theme switching**

Click the palette icon in the TitleBar. Select "暗色默认". Verify:

- The UI switches to dark colors immediately
- The `data-theme` attribute on `<html>` changes to `"dark-default"`
- localStorage `cabinet-theme` is set to `"dark-default"`
- Page refresh preserves the selected theme

- [ ] **Step 4: Test ThemeTab**

Navigate to Settings. Verify the theme list shows both themes and selection works.

- [ ] **Step 5: Verify no fatal regressions**

Navigate through Office, Factory, Settings, Employees, Memory pages. Verify each renders without obvious layout breakage.

- [ ] **Step 6: Commit any fixes if needed**

If verification reveals issues, fix them and commit.

---

### Task 14 (Optional): Remove dark: classes from components

**Files:**

- Modify: `packages/ui/src/**/*.tsx` (11 files)
- Modify: `apps/desktop/src/**/*.tsx` (56 files)

This is a non-blocking cleanup. `dark:` prefix classes are no-ops now that `darkMode: 'class'` is removed from Tailwind config. They don't cause bugs — they just don't do anything.

- [ ] **Step 1: Remove `dark:` classes from packages/ui**

For each file in packages/ui that uses `dark:`:

- Remove the `dark:` variant from className strings
- Example: `"text-gray-700 dark:text-gray-300"` → `"text-gray-700"`

- [ ] **Step 2: Remove `dark:` classes from apps/desktop/src**

Same process for app components.

- [ ] **Step 3: Verify app still renders correctly**

```bash
cd apps/desktop && npm run dev
```

Browse through pages and confirm no visual regressions.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src apps/desktop/src
git commit -m "cleanup(theme): remove dark: Tailwind prefix classes (now no-ops)"
```
