import type { Theme } from './types';

export const pixelBY: Theme = {
  id: 'pixel-by',
  name: 'Pixel-B&Y',
  colors: {
    surface: {
      primary: '#EFF6FF',
      elevated: '#BFDBFE',
      overlay: '#DBEAFE',
      input: '#FFFFFF',
      muted: '#93C5FD',
    },
    content: {
      primary: '#1E3A5F',
      secondary: '#3B82F6',
      tertiary: '#60A5FA',
      inverse: '#FCD34D',
    },
    border: {
      color: '#1E293B',
      subtle: '#93C5FD',
    },
    accent: {
      base: '#2563EB',
      hover: '#FCD34D',
      muted: 'rgba(37, 99, 235, 0.15)',
      foreground: '#1E293B',
    },
    intent: {
      success:  { color: '#16A34A', muted: 'rgba(22, 163, 74, 0.15)', foreground: '#FFFFFF' },
      danger:   { color: '#EF4444', muted: 'rgba(239, 68, 68, 0.15)', foreground: '#FFFFFF' },
      warning:  { color: '#FCD34D', muted: 'rgba(252, 211, 77, 0.2)', foreground: '#1E293B' },
      info:     { color: '#2563EB', muted: 'rgba(37, 99, 235, 0.15)', foreground: '#FFFFFF' },
      purple:   { color: '#8B5CF6', muted: 'rgba(139, 92, 246, 0.15)', foreground: '#FFFFFF' },
    },
  },
  style: {
    radius:  { sm: '0', md: '0', lg: '0', xl: '0' },
    shadow:  {
      sm: '3px 3px 0 #1E293B',
      md: '4px 4px 0 #1E293B',
      lg: '6px 6px 0 #1E293B',
    },
    font: {
      family: "'Courier New', 'Fira Code', monospace",
      display: "'Press Start 2P', 'Courier New', monospace",
      letterSpacing: '0.05em',
      lineHeight: '1.25',
    },
    border: { width: '3px' },
    transition: { duration: '0ms', easing: 'step-end' },
    opacity: { hover: '1.0', disabled: '0.6', overlay: '0.85' },
    glass: { blur: '0px', opacity: '1' },
    focusRing: { width: '3px', color: '#FCD34D', offset: '2px' },
    selection: { bg: '#FCD34D', fg: '#1E293B' },
    scrollbar: { width: '12px', thumb: '#FCD34D', track: '#1E293B' },
  },
};
