import type { Theme } from './types';

export const vaporwave: Theme = {
  id: 'vaporwave',
  name: 'Vaporwave',
  colors: {
    surface: {
      primary: '#2B0F4C',
      elevated: '#3C1A6B',
      overlay: 'rgba(255, 120, 200, 0.30)',
      input: '#1F0A3A',
      muted: 'rgba(185, 103, 255, 0.20)',
    },
    content: {
      primary: '#FF71CE',
      secondary: '#01CDFE',
      tertiary: '#B967FF',
      inverse: '#2B0F4C',
    },
    border: {
      color: '#FF71CE',
      subtle: '#B967FF',
    },
    accent: {
      base: '#FF00A0',
      hover: '#FF71CE',
      muted: 'rgba(255, 0, 160, 0.12)',
      foreground: '#FFFFFF',
    },
    intent: {
      success:  { color: '#00FF41', muted: 'rgba(0, 255, 65, 0.12)', foreground: '#2B0F4C' },
      danger:   { color: '#FF3C3C', muted: 'rgba(255, 60, 60, 0.12)', foreground: '#2B0F4C' },
      warning:  { color: '#FFC800', muted: 'rgba(255, 200, 0, 0.12)', foreground: '#2B0F4C' },
      info:     { color: '#01CDFE', muted: 'rgba(1, 205, 254, 0.12)', foreground: '#2B0F4C' },
      purple:   { color: '#B967FF', muted: 'rgba(185, 103, 255, 0.12)', foreground: '#2B0F4C' },
    },
  },
  style: {
    radius:  { sm: '0', md: '0', lg: '0', xl: '0' },
    shadow:  {
      sm: '3px 3px 0 #000000',
      md: '4px 4px 0 #000000',
      lg: '6px 6px 0 #000000',
    },
    font: {
      family: "'VT323', 'Courier New', monospace",
      display: "'VT323', 'Courier New', monospace",
      letterSpacing: '0.03em',
      lineHeight: '1.2',
    },
    border: { width: '2px' },
    transition: { duration: '0ms', easing: 'step-end' },
    opacity: { hover: '1.0', disabled: '0.5', overlay: '0.6' },
    glass: { blur: '0px', opacity: '1' },
    focusRing: { width: '2px', color: '#01CDFE', offset: '1px' },
    selection: { bg: '#FF71CE', fg: '#2B0F4C' },
    scrollbar: { width: '8px', thumb: '#FF71CE', track: '#2B0F4C' },
  },
};
