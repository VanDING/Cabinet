import type { Theme } from './types';

export const meadow: Theme = {
  id: 'meadow',
  name: 'Meadow',
  colors: {
    surface: {
      primary: '#FAF8F2',
      elevated: '#FFFFFF',
      overlay: 'rgba(255, 252, 245, 0.90)',
      input: '#FFFFFF',
      muted: '#F5F2EA',
    },
    content: {
      primary: '#3E4A32',
      secondary: '#7D8C6C',
      tertiary: '#A8B398',
      inverse: '#FAF8F2',
    },
    border: {
      color: '#D4D0BE',
      subtle: '#EBE6D5',
    },
    accent: {
      base: '#7D9F50',
      hover: '#6B8A3E',
      muted: '#EBF2E2',
      foreground: '#FFFFFF',
    },
    intent: {
      success:  { color: '#7D9F50', muted: '#EBF2E2', foreground: '#FFFFFF' },
      danger:   { color: '#C4906E', muted: '#F5EAE4', foreground: '#FFFFFF' },
      warning:  { color: '#C4A85E', muted: '#F5F0E2', foreground: '#3E4A32' },
      info:     { color: '#7D9FB8', muted: '#E4EEF5', foreground: '#FFFFFF' },
      purple:   { color: '#9B8EC4', muted: '#EDE8F5', foreground: '#FFFFFF' },
    },
  },
  style: {
    radius:  { sm: '4px', md: '8px', lg: '14px', xl: '18px' },
    shadow:  {
      sm: '0 1px 4px rgba(60, 70, 40, 0.06)',
      md: '0 4px 14px rgba(100, 120, 60, 0.10)',
      lg: '0 8px 30px rgba(120, 140, 80, 0.12)',
    },
    font: {
      family: "'Karla', 'Quicksand', -apple-system, BlinkMacSystemFont, sans-serif",
      display: "'Karla', 'Quicksand', -apple-system, BlinkMacSystemFont, sans-serif",
      letterSpacing: '0',
      lineHeight: '1.6',
    },
    border: { width: '1px' },
    transition: { duration: '200ms', easing: 'ease-out' },
    opacity: { hover: '0.9', disabled: '0.45', overlay: '0.35' },
    glass: { blur: '12px', opacity: '0.6' },
    focusRing: { width: '2px', color: '#7D9F50', offset: '2px' },
    selection: { bg: '#EBF2E2', fg: '#3E4A32' },
    scrollbar: { width: '5px', thumb: '#D4D0BE', track: 'transparent' },
  },
};
