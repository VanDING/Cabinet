import type { Theme } from './types';

export const glass: Theme = {
  id: 'glass',
  name: 'Glass',
  colors: {
    surface: {
      primary: 'rgba(255, 255, 255, 0.72)',
      elevated: 'rgba(255, 255, 255, 0.50)',
      overlay: 'rgba(255, 255, 255, 0.80)',
      input: 'rgba(255, 255, 255, 0.60)',
      muted: 'rgba(255, 255, 255, 0.30)',
    },
    content: {
      primary: '#1D1D1F',
      secondary: '#6E6E73',
      tertiary: '#AEAEB2',
      inverse: '#FFFFFF',
    },
    border: {
      color: 'rgba(255, 255, 255, 0.30)',
      subtle: 'rgba(255, 255, 255, 0.18)',
    },
    accent: {
      base: '#007AFF',
      hover: '#0062CC',
      muted: 'rgba(0, 122, 255, 0.10)',
      foreground: '#FFFFFF',
    },
    intent: {
      success:  { color: '#34C759', muted: 'rgba(52, 199, 89, 0.10)', foreground: '#FFFFFF' },
      danger:   { color: '#FF3B30', muted: 'rgba(255, 59, 48, 0.08)', foreground: '#FFFFFF' },
      warning:  { color: '#FF9500', muted: 'rgba(255, 149, 0, 0.10)', foreground: '#FFFFFF' },
      info:     { color: '#007AFF', muted: 'rgba(0, 122, 255, 0.10)', foreground: '#FFFFFF' },
      purple:   { color: '#AF52DE', muted: 'rgba(175, 82, 222, 0.08)', foreground: '#FFFFFF' },
    },
  },
  style: {
    radius:  { sm: '10px', md: '14px', lg: '18px', xl: '24px' },
    shadow:  {
      sm: '0 1px 8px rgba(0, 0, 0, 0.04)',
      md: '0 4px 20px rgba(0, 0, 0, 0.06)',
      lg: '0 8px 40px rgba(0, 0, 0, 0.08)',
    },
    font: {
      family: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif",
      display: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif",
      letterSpacing: '-0.01em',
      lineHeight: '1.5',
    },
    border: { width: '1px' },
    transition: { duration: '250ms', easing: 'ease-out' },
    opacity: { hover: '0.85', disabled: '0.4', overlay: '0.35' },
    glass: { blur: '20px', opacity: '0.72' },
    focusRing: { width: '3px', color: 'rgba(0, 122, 255, 0.4)', offset: '1px' },
    selection: { bg: '#007AFF', fg: '#FFFFFF' },
    scrollbar: { width: '6px', thumb: 'rgba(0, 0, 0, 0.15)', track: 'transparent' },
  },
};
