import type { Theme } from './types';

export const memphis: Theme = {
  id: 'memphis',
  name: 'Memphis',
  colors: {
    surface: {
      primary: '#FFFFFF',
      elevated: '#F8F9FA',
      overlay: '#FFFFFF',
      input: '#FFFFFF',
      muted: '#F0F0F0',
    },
    content: {
      primary: '#1A1A1A',
      secondary: '#0A9396',
      tertiary: '#999999',
      inverse: '#FFFFFF',
    },
    border: {
      color: '#000000',
      subtle: '#CCCCCC',
    },
    accent: {
      base: '#FF6B6B',
      hover: '#FF4444',
      muted: '#FFE0E0',
      foreground: '#FFFFFF',
    },
    intent: {
      success:  { color: '#2ECC71', muted: 'rgba(46, 204, 113, 0.15)', foreground: '#1A1A1A' },
      danger:   { color: '#FF6B6B', muted: 'rgba(255, 107, 107, 0.15)', foreground: '#1A1A1A' },
      warning:  { color: '#FFE66D', muted: 'rgba(255, 230, 109, 0.25)', foreground: '#1A1A1A' },
      info:     { color: '#0A9396', muted: 'rgba(10, 147, 150, 0.15)', foreground: '#1A1A1A' },
      purple:   { color: '#B464FF', muted: 'rgba(180, 100, 255, 0.15)', foreground: '#1A1A1A' },
    },
  },
  style: {
    radius:  { sm: '0', md: '9999px', lg: '9999px', xl: '9999px' },
    shadow:  {
      sm: '3px 3px 0 #000000',
      md: '4px 4px 0 #000000',
      lg: '6px 6px 0 #000000',
    },
    font: {
      family: "'Poppins', 'Fredoka One', -apple-system, BlinkMacSystemFont, sans-serif",
      display: "'Poppins', 'Fredoka One', -apple-system, BlinkMacSystemFont, sans-serif",
      letterSpacing: '-0.01em',
      lineHeight: '1.4',
    },
    border: { width: '2px' },
    transition: { duration: '0ms', easing: 'step-end' },
    opacity: { hover: '1.0', disabled: '0.5', overlay: '0.5' },
    glass: { blur: '0px', opacity: '1' },
    focusRing: { width: '3px', color: '#000000', offset: '2px' },
    selection: { bg: '#FFE66D', fg: '#1A1A1A' },
    scrollbar: { width: '8px', thumb: '#000000', track: '#FFFFFF' },
  },
};
