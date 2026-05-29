// apps/desktop/src/themes/light-default.ts
import type { Theme } from './types';

export const lightDefault: Theme = {
  id: 'light-default',
  name: 'Light',
  colors: {
    surface: {
      primary: '#FFFFFF',
      elevated: '#F8F9FA',
      overlay: '#FFFFFF',
      input: '#F1F3F5',
      muted: '#E9ECEF',
    },
    content: {
      primary: '#1A1A1A',
      secondary: '#6E6E6E',
      tertiary: '#A0A0A0',
      inverse: '#FFFFFF',
    },
    border: {
      color: 'transparent',
      subtle: 'transparent',
    },
    accent: {
      base: '#4F46E5',
      hover: '#4338CA',
      muted: 'rgba(79, 70, 229, 0.08)',
      foreground: '#FFFFFF',
    },
    intent: {
      success:  { color: '#15803D', muted: 'rgba(21, 128, 61, 0.08)', foreground: '#FFFFFF' },
      danger:   { color: '#DC2626', muted: 'rgba(220, 38, 38, 0.08)', foreground: '#FFFFFF' },
      warning:  { color: '#D97706', muted: 'rgba(217, 119, 6, 0.08)', foreground: '#FFFFFF' },
      info:     { color: '#4F46E5', muted: 'rgba(79, 70, 229, 0.08)', foreground: '#FFFFFF' },
      purple:   { color: '#7C3AED', muted: 'rgba(124, 58, 237, 0.08)', foreground: '#FFFFFF' },
    },
  },
  style: {
    radius:  { sm: '6px', md: '10px', lg: '14px', xl: '18px' },
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
    border: { width: '0px' },
    transition: { duration: '180ms', easing: 'ease-out' },
    opacity: { hover: '0.9', disabled: '0.4', overlay: '0.5' },
    glass: { blur: '0px', opacity: '1' },
    focusRing: { width: '2px', color: 'rgba(79, 70, 229, 0.4)', offset: '2px' },
    selection: { bg: '#4F46E5', fg: '#FFFFFF' },
    scrollbar: { width: '5px', thumb: '#D1D5DB', track: 'transparent' },
    bodyBg: '#F8F9FA',
  },
};
