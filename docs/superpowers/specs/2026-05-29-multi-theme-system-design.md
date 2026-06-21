# Multi-Theme System Design

## Overview

将当前二元亮/暗切换升级为多主题系统。每个主题 = 完整的配色（30 个颜色 token）+ 风格参数（27 个风格 token），用户从 TitleBar 下拉列表中选择。

## Architecture

### Theme = TS Registry → Generated CSS → `data-theme` Attribute

```
src/themes/types.ts        — Theme, ThemeColors, ThemeStyle 类型定义
src/themes/light-default.ts — "亮色默认" 主题
src/themes/dark-default.ts  — "暗色默认" 主题
src/themes/forest.ts        — "森林" 主题（后续添加）
src/themes/registry.ts      — 主题注册表，所有主题在此导入
src/themes/generate-css.ts  — 将 registry 中所有主题生成 CSS 字符串
```

**数据流：**

1. 每个主题是一个 TS 对象（57 个 token 值）
2. `generate-css.ts`（构建时）将 registry 转换为 `[data-theme="X"] { ... }` CSS
3. `useTheme` 管理一个 theme ID 字符串
4. 切换主题 = `document.documentElement.setAttribute('data-theme', id)`
5. Tailwind 读取 CSS 变量，无需改动映射关系

### Why Build-Time CSS Generation

- 首帧无闪烁（CSS 作为静态资源加载）
- 类型安全（TS 强制 57 个字段完整）
- 添加主题 = 新建一个 TS 文件

## Theme Data Model

### Color Tokens (30)

| Category | Tokens                                                                                                                   | Count |
| -------- | ------------------------------------------------------------------------------------------------------------------------ | ----- |
| Surface  | `--surface-primary` `--surface-elevated` `--surface-overlay` `--surface-input` `--surface-muted`                         | 5     |
| Content  | `--content-primary` `--content-secondary` `--content-tertiary` `--content-inverse`                                       | 4     |
| Border   | `--border-color` `--border-subtle`                                                                                       | 2     |
| Accent   | `--accent` `--accent-hover` `--accent-muted` `--accent-foreground`                                                       | 4     |
| Intent   | success / danger / warning / info / purple, each: `--intent-{name}` `--intent-{name}-muted` `--intent-{name}-foreground` | 15    |

Semantic intent colors must adjust per-theme to match the accent color temperature and maintain contrast.

### Style Tokens (27)

| Category      | Tokens                                                               | Count |
| ------------- | -------------------------------------------------------------------- | ----- |
| Border Radius | `--radius-sm` `--radius-md` `--radius-lg` `--radius-xl`              | 4     |
| Shadow        | `--shadow-sm` `--shadow-md` `--shadow-lg` (full CSS value templates) | 3     |
| Font          | `--font-family` `--font-display` `--letter-spacing` `--line-height`  | 4     |
| Border Width  | `--border-width`                                                     | 1     |
| Transition    | `--duration` `--easing` (mapped to Tailwind defaults)                | 2     |
| Opacity       | `--opacity-hover` `--opacity-disabled` `--opacity-overlay`           | 3     |
| Glass         | `--blur-amount` `--glass-opacity`                                    | 2     |
| Focus Ring    | `--focus-ring-width` `--focus-ring-color` `--focus-ring-offset`      | 3     |
| Selection     | `--selection-bg` `--selection-fg`                                    | 2     |
| Scrollbar     | `--scrollbar-width` `--scrollbar-thumb` `--scrollbar-track`          | 3     |

**Total: 57 CSS variables per theme.**

## TypeScript Types

```typescript
// src/themes/types.ts

interface ThemeColors {
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

interface ThemeStyle {
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

interface Theme {
  id: string;
  name: string;
  colors: ThemeColors;
  style: ThemeStyle;
}
```

## CSS Generation

```typescript
// src/themes/generate-css.ts

function flattenTokens(theme: Theme): Record<string, string> {
  // Maps nested Theme object to flat CSS variable map
  // --surface-primary, --accent, --radius-md, etc.
}

export function generateCSS(): string {
  let css = '';
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
```

Run at build time via npm script: `npx tsx src/themes/generate-css.ts` outputs `src/themes/generated.css`. Add to `package.json` scripts as a pre-step before `vite dev` / `vite build`. The generated file is imported in `index.css`.

## Tailwind Config Changes

```javascript
// tailwind.config.js

// REMOVE: darkMode: 'class' — no longer needed

// borderRadius → CSS variable references
'ui-sm': 'var(--radius-sm)',
'ui-md': 'var(--radius-md)',
'ui-lg': 'var(--radius-lg)',
'ui-xl': 'var(--radius-xl)',

// NEW: transition defaults mapped to CSS variables
transitionDuration: { DEFAULT: 'var(--duration)' },
transitionTimingFunction: { DEFAULT: 'var(--easing)' },
```

Color mappings (`surface-primary` → `var(--surface-primary)`, etc.) remain unchanged — CSS variable names don't change, only the selector that defines their values.

## useTheme Hook

```typescript
// src/hooks/useTheme.tsx

// State: theme ID string (e.g. "light-default", "dark-default")
// No more isDark boolean, no toggle function

const [theme, setThemeState] = useState(() => {
  return localStorage.getItem('cabinet-theme') || defaultTheme.id;
});

const setTheme = (id: string) => {
  setThemeState(id);
  localStorage.setItem('cabinet-theme', id);
  document.documentElement.setAttribute('data-theme', id);
};

// Context exposes: { theme, setTheme, themes }
// themes = registry mapped to [{ id, name }] for UI rendering
```

## UI Changes

### TitleBar

- **Remove** Sun/Moon icon toggle button
- **Add** theme dropdown button showing current theme name
- Click opens a popover/dropdown listing all available themes from registry
- Selecting a theme calls `setTheme(id)`

### ThemeTab (Settings)

- No changes required (existing dark mode toggle can be removed later if desired)

### Component Cleanup

- Remove `dark:` Tailwind prefix classes from components in `packages/ui/` and `apps/desktop/`
- Components should rely on CSS variables for dark/light adaptation, not `dark:` utilities
- **Non-blocking**: remove what's found, but remaining `dark:` classes are harmless (they become no-ops once `darkMode: 'class'` is removed from Tailwind config)

## index.css Changes

- Remove `:root { ... }` token block (lines 6-63)
- Remove `.dark { ... }` token block (lines 65-123)
- Remove legacy variables (`--bg-primary`, `--bg-card`, etc.)
- Add `@import './themes/generated.css'` (or inline the generated CSS)
- Keep non-theme styles: animations, syntax highlighting (adapt to work without `.dark`), markdown styles, scrollbar styles (move to style tokens), title bar drag regions

## Files Summary

| File                          | Action                 | Est. Lines |
| ----------------------------- | ---------------------- | ---------- |
| `src/themes/types.ts`         | New                    | ~50        |
| `src/themes/light-default.ts` | New                    | ~80        |
| `src/themes/dark-default.ts`  | New                    | ~80        |
| `src/themes/forest.ts`        | New (placeholder)      | ~80        |
| `src/themes/registry.ts`      | New                    | ~15        |
| `src/themes/generate-css.ts`  | New                    | ~40        |
| `src/hooks/useTheme.tsx`      | Rewrite                | ~40        |
| `src/components/TitleBar.tsx` | Modify                 | ~20        |
| `src/index.css`               | Major cleanup          | ~-100 / +5 |
| `tailwind.config.js`          | Modify                 | ~10 / -3   |
| `packages/ui/src/**/*.tsx`    | Remove `dark:` classes | varies     |
| `apps/desktop/src/**/*.tsx`   | Remove `dark:` classes | varies     |

## Out of Scope

- System preference (`prefers-color-scheme`) auto-switching (can be added later)
- Custom/user-created themes
- Theme import/export
