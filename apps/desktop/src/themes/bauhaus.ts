import type { Theme } from './types';

export const bauhaus: Theme = {
  id: 'bauhaus',
  name: 'Bauhaus',
  colors: {
    surface: {
      primary: '#E5E5E5',
      elevated: '#FFFFFF',
      overlay: '#FFFFFF',
      input: '#FFFFFF',
      muted: '#CCCCCC',
    },
    content: {
      primary: '#1A1A1A',
      secondary: '#D32F2F',
      tertiary: '#1976D2',
      inverse: '#FBC02D',
    },
    border: {
      color: '#000000',
      subtle: '#AAAAAA',
    },
    accent: {
      base: '#FBC02D',
      hover: '#F9A825',
      muted: '#FFF9C4',
      foreground: '#1A1A1A',
    },
    intent: {
      success:  { color: '#388E3C', muted: 'rgba(56, 142, 60, 0.10)', foreground: '#FFFFFF' },
      danger:   { color: '#D32F2F', muted: 'rgba(211, 47, 47, 0.10)', foreground: '#FFFFFF' },
      warning:  { color: '#FBC02D', muted: 'rgba(251, 192, 45, 0.15)', foreground: '#1A1A1A' },
      info:     { color: '#1976D2', muted: 'rgba(25, 118, 210, 0.10)', foreground: '#FFFFFF' },
      purple:   { color: '#7B1FA2', muted: 'rgba(123, 31, 162, 0.10)', foreground: '#FFFFFF' },
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
      family: "'Bauhaus 93', 'Futura', 'Poppins', -apple-system, sans-serif",
      display: "'Bauhaus 93', 'Futura', 'Poppins', -apple-system, sans-serif",
      letterSpacing: '0.03em',
      lineHeight: '1.4',
    },
    border: { width: '2px' },
    transition: { duration: '100ms', easing: 'ease-out' },
    opacity: { hover: '1.0', disabled: '0.5', overlay: '0.6' },
    glass: { blur: '0px', opacity: '1' },
    focusRing: { width: '3px', color: '#000000', offset: '2px' },
    selection: { bg: '#FBC02D', fg: '#1A1A1A' },
    scrollbar: { width: '6px', thumb: '#000000', track: '#E5E5E5' },
  },
};
