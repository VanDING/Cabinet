// apps/desktop/src/themes/generate-css.ts
// Run: npx tsx src/themes/generate-css.ts
// Outputs: src/themes/generated.css

import { registry, defaultTheme } from './registry';
import type { Theme } from './types';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

function flattenTokens(theme: Theme): Record<string, string> {
  const { colors, style } = theme;
  const vars: Record<string, string> = {};

  // Surface
  vars['--surface-primary'] = colors.surface.primary;
  vars['--surface-elevated'] = colors.surface.elevated;
  vars['--surface-overlay'] = colors.surface.overlay;
  vars['--surface-input'] = colors.surface.input;
  vars['--surface-muted'] = colors.surface.muted;
  vars['--surface-sidebar'] = colors.surface.sidebar;

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

  // Code blocks
  vars['--code-block-bg'] = colors.code.blockBg;
  vars['--code-block-border'] = colors.code.blockBorder;
  vars['--code-block-color'] = colors.code.blockColor;
  vars['--code-inline-bg'] = colors.code.inlineBg;
  vars['--code-inline-color'] = colors.code.inlineColor;

  // Syntax highlighting
  vars['--syntax-keyword'] = colors.syntax.keyword;
  vars['--syntax-string'] = colors.syntax.string;
  vars['--syntax-number'] = colors.syntax.number;
  vars['--syntax-comment'] = colors.syntax.comment;
  vars['--syntax-function'] = colors.syntax.function;
  vars['--syntax-variable'] = colors.syntax.variable;
  vars['--syntax-tag'] = colors.syntax.tag;

  // Graph
  vars['--graph-entity-person'] = colors.graph.entityPerson;
  vars['--graph-entity-project'] = colors.graph.entityProject;
  vars['--graph-entity-concept'] = colors.graph.entityConcept;
  vars['--graph-entity-technology'] = colors.graph.entityTechnology;
  vars['--graph-entity-decision'] = colors.graph.entityDecision;
  vars['--graph-entity-memory'] = colors.graph.entityMemory;
  vars['--graph-edge-active'] = colors.graph.edgeActive;
  vars['--graph-edge-inactive'] = colors.graph.edgeInactive;
  vars['--graph-node-label'] = colors.graph.nodeLabel;
  vars['--graph-bg-grid'] = colors.graph.bgGrid;
  vars['--graph-minimap-mask'] = colors.graph.minimapMask;

  // Chart palette
  vars['--chart-1'] = colors.chart.c1;
  vars['--chart-2'] = colors.chart.c2;
  vars['--chart-3'] = colors.chart.c3;
  vars['--chart-4'] = colors.chart.c4;
  vars['--chart-5'] = colors.chart.c5;
  vars['--chart-6'] = colors.chart.c6;
  vars['--chart-7'] = colors.chart.c7;
  vars['--chart-8'] = colors.chart.c8;

  // Style: radius
  vars['--radius-sm'] = style.radius.sm;
  vars['--radius-md'] = style.radius.md;
  vars['--radius-lg'] = style.radius.lg;
  vars['--radius-xl'] = style.radius.xl;

  // Style: shadow
  vars['--shadow-xs'] = style.shadow.sm;
  vars['--shadow-sm'] = style.shadow.sm;
  vars['--shadow-md'] = style.shadow.md;
  vars['--shadow-lg'] = style.shadow.lg;

  // Style: font
  vars['--font-family'] = style.font.family;
  vars['--font-display'] = style.font.display;
  vars['--letter-spacing'] = style.font.letterSpacing;
  vars['--line-height'] = style.font.lineHeight;
  vars['--font-size-base'] = style.font.sizeBase;
  vars['--font-size-sm'] = style.font.sizeSm;
  vars['--font-size-xs'] = style.font.sizeXs;
  vars['--font-size-lg'] = style.font.sizeLg;
  vars['--font-size-xl'] = style.font.sizeXl;
  vars['--font-size-2xl'] = style.font.size2xl;
  vars['--font-weight-normal'] = style.font.weightNormal;
  vars['--font-weight-medium'] = style.font.weightMedium;
  vars['--font-weight-bold'] = style.font.weightBold;

  // Style: border
  vars['--border-width'] = style.border.width;
  vars['--border-style'] = style.border.style;

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
  vars['--body-bg'] = style.bodyBg;

  return vars;
}

function generateCSS(): string {
  let css = '/* Auto-generated by generate-css.ts — do not edit */\n\n';

  // :root defaults — use light-default values so var() never resolves to transparent
  const defaultVars = flattenTokens(defaultTheme);
  css += ':root {\n';
  for (const [key, value] of Object.entries(defaultVars)) {
    css += `  ${key}: ${value};\n`;
  }
  css += '}\n\n';

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outPath = path.resolve(__dirname, 'generated.css');
fs.writeFileSync(outPath, generateCSS());
console.log(`Generated ${outPath}`);
