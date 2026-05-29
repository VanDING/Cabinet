// apps/desktop/src/themes/dark-default.ts
import type { Theme } from './types';

export const darkDefault: Theme = {
  id: 'dark-default',
  name: 'Dark',
  colors: {
    surface: {
      primary: '#141414',
      elevated: '#0D0D0D',
      overlay: '#141414',
      input: '#1A1A1A',
      muted: '#1F1F1F',
    },
    content: {
      primary: '#EDEDED',
      secondary: '#888888',
      tertiary: '#666666',
      inverse: '#0D0D0D',
    },
    border: {
      color: 'rgba(255, 255, 255, 0.04)',
      subtle: 'rgba(255, 255, 255, 0.02)',
    },
    accent: {
      base: '#5E6AD2',
      hover: '#7B83E8',
      muted: 'rgba(94, 106, 210, 0.1)',
      foreground: '#FFFFFF',
    },
    intent: {
      success:  { color: '#5EC269', muted: 'rgba(94, 194, 105, 0.1)', foreground: '#0D0D0D' },
      danger:   { color: '#FF6464', muted: 'rgba(255, 100, 100, 0.08)', foreground: '#0D0D0D' },
      warning:  { color: '#E0A850', muted: 'rgba(224, 168, 80, 0.1)', foreground: '#0D0D0D' },
      info:     { color: '#5E6AD2', muted: 'rgba(94, 106, 210, 0.1)', foreground: '#0D0D0D' },
      purple:   { color: '#9B8EF0', muted: 'rgba(155, 142, 240, 0.1)', foreground: '#0D0D0D' },
    },
  },
  style: {
    radius:  { sm: '4px', md: '8px', lg: '10px', xl: '14px' },
    shadow:  {
      sm: 'none',
      md: 'none',
      lg: 'none',
    },
    font: {
      family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      display: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      letterSpacing: '-0.01em',
      lineHeight: '1.5',
    },
    border: { width: '1px' },
    transition: { duration: '120ms', easing: 'ease-out' },
    opacity: { hover: '0.9', disabled: '0.4', overlay: '0.5' },
    glass: { blur: '0px', opacity: '1' },
    focusRing: { width: '2px', color: 'rgba(94, 106, 210, 0.4)', offset: '2px' },
    selection: { bg: '#5E6AD2', fg: '#FFFFFF' },
    scrollbar: { width: '5px', thumb: 'rgba(255, 255, 255, 0.08)', track: 'transparent' },
    bodyBg: '#0D0D0D',
  },
};
