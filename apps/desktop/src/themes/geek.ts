import type { Theme } from './types';

export const geek: Theme = {
  id: 'geek',
  name: 'Geek',
  colors: {
    surface: {
      primary: '#0D1117',
      elevated: '#0A0F0A',
      overlay: '#111911',
      input: '#161F16',
      muted: '#1A241A',
    },
    content: {
      primary: '#E8ECEA',
      secondary: '#99BB99',
      tertiary: '#5A7A5A',
      inverse: '#0A0F0A',
    },
    border: {
      color: 'rgba(51, 255, 51, 0.1)',
      subtle: 'rgba(51, 255, 51, 0.05)',
    },
    accent: {
      base: '#33FF33',
      hover: '#00CC00',
      muted: 'rgba(51, 255, 51, 0.08)',
      foreground: '#0A0F0A',
    },
    intent: {
      success:  { color: '#33FF33', muted: 'rgba(51, 255, 51, 0.08)', foreground: '#0A0F0A' },
      danger:   { color: '#FF4444', muted: 'rgba(255, 68, 68, 0.08)', foreground: '#0A0F0A' },
      warning:  { color: '#FFCC00', muted: 'rgba(255, 204, 0, 0.08)', foreground: '#0A0F0A' },
      info:     { color: '#33AAFF', muted: 'rgba(51, 170, 255, 0.08)', foreground: '#0A0F0A' },
      purple:   { color: '#AA66FF', muted: 'rgba(170, 102, 255, 0.08)', foreground: '#0A0F0A' },
    },
  },
  style: {
    radius:  { sm: '2px', md: '4px', lg: '6px', xl: '8px' },
    shadow:  {
      sm: '0 0 4px rgba(51, 255, 51, 0.1)',
      md: '0 0 8px rgba(51, 255, 51, 0.15)',
      lg: '0 0 16px rgba(51, 255, 51, 0.2)',
    },
    font: {
      family: "'Fira Code', 'Cascadia Code', 'JetBrains Mono', 'Courier New', monospace",
      display: "'Fira Code', 'Courier New', monospace",
      letterSpacing: '0.02em',
      lineHeight: '1.5',
    },
    border: { width: '1px' },
    transition: { duration: '100ms', easing: 'ease-out' },
    opacity: { hover: '1.0', disabled: '0.5', overlay: '0.6' },
    glass: { blur: '0px', opacity: '1' },
    focusRing: { width: '2px', color: '#33FF33', offset: '1px' },
    selection: { bg: 'rgba(51, 255, 51, 0.2)', fg: '#E8ECEA' },
    scrollbar: { width: '8px', thumb: '#1A3A1A', track: 'transparent' },
    bodyBg: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(51,255,51,0.025) 2px, rgba(51,255,51,0.025) 3px), #0A0F0A',
  },
};
