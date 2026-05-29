import type { Theme } from './types';

export const warm: Theme = {
  id: 'warm',
  name: 'Warm',
  colors: {
    surface: {
      primary: '#FAF6F0',
      elevated: '#F0EBE3',
      overlay: '#FAF6F0',
      input: '#FFFFFF',
      muted: '#E8E2D8',
    },
    content: {
      primary: '#3D3929',
      secondary: '#6B6259',
      tertiary: '#A09880',
      inverse: '#FAF6F0',
    },
    border: {
      color: 'rgba(0, 0, 0, 0.04)',
      subtle: 'rgba(0, 0, 0, 0.02)',
    },
    accent: {
      base: '#D97757',
      hover: '#C06B4A',
      muted: 'rgba(217, 119, 87, 0.08)',
      foreground: '#3D3929',
    },
    intent: {
      success:  { color: '#7C8C6C', muted: 'rgba(124, 140, 108, 0.08)', foreground: '#FFFFFF' },
      danger:   { color: '#C87878', muted: 'rgba(200, 120, 120, 0.08)', foreground: '#FFFFFF' },
      warning:  { color: '#D4A85C', muted: 'rgba(212, 168, 92, 0.08)', foreground: '#3D3929' },
      info:     { color: '#7C9AAC', muted: 'rgba(124, 154, 172, 0.08)', foreground: '#FFFFFF' },
      purple:   { color: '#9B8EC4', muted: 'rgba(155, 142, 196, 0.08)', foreground: '#FFFFFF' },
    },
  },
  style: {
    radius:  { sm: '4px', md: '8px', lg: '12px', xl: '16px' },
    shadow:  {
      sm: '0 1px 1px rgba(0, 0, 0, 0.02)',
      md: '0 1px 2px rgba(0, 0, 0, 0.03)',
      lg: '0 2px 8px rgba(0, 0, 0, 0.04)',
    },
    font: {
      family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      display: "Georgia, 'Times New Roman', serif",
      letterSpacing: '0',
      lineHeight: '1.6',
    },
    border: { width: '1px' },
    transition: { duration: '200ms', easing: 'ease-out' },
    opacity: { hover: '0.9', disabled: '0.45', overlay: '0.35' },
    glass: { blur: '0px', opacity: '1' },
    focusRing: { width: '2px', color: '#D97757', offset: '2px' },
    selection: { bg: 'rgba(217, 119, 87, 0.15)', fg: '#3D3929' },
    scrollbar: { width: '6px', thumb: 'rgba(0, 0, 0, 0.12)', track: 'transparent' },
  },
};
