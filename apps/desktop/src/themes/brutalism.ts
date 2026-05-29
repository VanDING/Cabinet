import type { Theme } from './types';

export const brutalism: Theme = {
  id: 'brutalism',
  name: 'Brutalism',
  colors: {
    surface: {
      primary: '#FFFFFF',
      elevated: '#F0F0F0',
      overlay: '#FFFFFF',
      input: '#FFFFFF',
      muted: '#E0E0E0',
    },
    content: {
      primary: '#000000',
      secondary: '#333333',
      tertiary: '#666666',
      inverse: '#FFFFFF',
    },
    border: {
      color: '#000000',
      subtle: '#CCCCCC',
    },
    accent: {
      base: '#0000FF',
      hover: '#0000CC',
      muted: 'rgba(0, 0, 255, 0.08)',
      foreground: '#FFFFFF',
    },
    intent: {
      success:  { color: '#008000', muted: 'rgba(0, 128, 0, 0.10)', foreground: '#FFFFFF' },
      danger:   { color: '#FF0000', muted: 'rgba(255, 0, 0, 0.08)', foreground: '#FFFFFF' },
      warning:  { color: '#FFA500', muted: 'rgba(255, 165, 0, 0.10)', foreground: '#000000' },
      info:     { color: '#0000FF', muted: 'rgba(0, 0, 255, 0.08)', foreground: '#FFFFFF' },
      purple:   { color: '#800080', muted: 'rgba(128, 0, 128, 0.08)', foreground: '#FFFFFF' },
    },
  },
  style: {
    radius:  { sm: '0', md: '0', lg: '0', xl: '0' },
    shadow:  {
      sm: 'none',
      md: 'none',
      lg: 'none',
    },
    font: {
      family: "'Times New Roman', Georgia, serif",
      display: "'Times New Roman', Georgia, serif",
      letterSpacing: '0',
      lineHeight: '1.4',
    },
    border: { width: '3px' },
    transition: { duration: '0s', easing: 'linear' },
    opacity: { hover: '1.0', disabled: '0.5', overlay: '0.6' },
    glass: { blur: '0px', opacity: '1' },
    focusRing: { width: '2px', color: '#000000', offset: '2px' },
    selection: { bg: '#0000FF', fg: '#FFFFFF' },
    scrollbar: { width: '18px', thumb: '#999999', track: '#F0F0F0' },
  },
};
