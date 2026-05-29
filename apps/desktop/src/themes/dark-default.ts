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
      success:  { color: '#22c55e', muted: 'rgba(34, 197, 94, 0.2)', foreground: '#ffffff' },
      danger:   { color: '#ef4444', muted: 'rgba(239, 68, 68, 0.2)', foreground: '#ffffff' },
      warning:  { color: '#f59e0b', muted: 'rgba(245, 158, 11, 0.2)', foreground: '#111827' },
      info:     { color: '#3b82f6', muted: 'rgba(59, 130, 246, 0.25)', foreground: '#ffffff' },
      purple:   { color: '#a855f7', muted: 'rgba(168, 85, 247, 0.25)', foreground: '#ffffff' },
    },
  },
  style: {
    radius:  { sm: '4px', md: '8px', lg: '12px', xl: '16px' },
    shadow:  {
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
