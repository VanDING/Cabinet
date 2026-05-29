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
      success:  { color: '#16a34a', muted: 'rgba(22, 163, 74, 0.12)', foreground: '#ffffff' },
      danger:   { color: '#dc2626', muted: 'rgba(220, 38, 38, 0.12)', foreground: '#ffffff' },
      warning:  { color: '#d97706', muted: 'rgba(217, 119, 6, 0.12)', foreground: '#ffffff' },
      info:     { color: '#2563eb', muted: 'rgba(37, 99, 235, 0.12)', foreground: '#ffffff' },
      purple:   { color: '#9333ea', muted: 'rgba(147, 51, 234, 0.12)', foreground: '#ffffff' },
    },
  },
  style: {
    radius:  { sm: '4px', md: '8px', lg: '12px', xl: '16px' },
    shadow:  {
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
