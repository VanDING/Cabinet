import type { Theme } from './types';

export const cyberpunk: Theme = {
  id: 'cyberpunk',
  name: 'Cyberpunk',
  colors: {
    surface: {
      primary: '#0B0C10',
      elevated: '#1F2833',
      overlay: 'rgba(0, 255, 240, 0.10)',
      input: '#1A1D24',
      muted: 'rgba(69, 162, 158, 0.15)',
    },
    content: {
      primary: '#00FFF0',
      secondary: '#FF007F',
      tertiary: '#C5C6C7',
      inverse: '#0B0C10',
    },
    border: {
      color: '#45A29E',
      subtle: '#1F2833',
    },
    accent: {
      base: '#FCEE0A',
      hover: '#FFD700',
      muted: 'rgba(252, 238, 10, 0.12)',
      foreground: '#0B0C10',
    },
    intent: {
      success:  { color: '#00FF41', muted: 'rgba(0, 255, 65, 0.12)', foreground: '#0B0C10' },
      danger:   { color: '#FF003C', muted: 'rgba(255, 0, 60, 0.12)', foreground: '#0B0C10' },
      warning:  { color: '#FFAA00', muted: 'rgba(255, 170, 0, 0.12)', foreground: '#0B0C10' },
      info:     { color: '#00C8FF', muted: 'rgba(0, 200, 255, 0.12)', foreground: '#0B0C10' },
      purple:   { color: '#C800FF', muted: 'rgba(200, 0, 255, 0.12)', foreground: '#0B0C10' },
    },
  },
  style: {
    radius:  { sm: '0', md: '2px', lg: '4px', xl: '6px' },
    shadow:  {
      sm: '0 0 6px rgba(0, 255, 240, 0.12)',
      md: '0 0 14px rgba(0, 255, 240, 0.18)',
      lg: '0 0 24px rgba(0, 255, 240, 0.15), 0 0 48px rgba(255, 0, 127, 0.08)',
    },
    font: {
      family: "'Share Tech Mono', 'Courier New', monospace",
      display: "'Share Tech Mono', 'Courier New', monospace",
      letterSpacing: '0.05em',
      lineHeight: '1.5',
    },
    border: { width: '2px' },
    transition: { duration: '80ms', easing: 'step-end' },
    opacity: { hover: '1.0', disabled: '0.5', overlay: '0.7' },
    glass: { blur: '0px', opacity: '1' },
    focusRing: { width: '2px', color: '#00FFF0', offset: '2px' },
    selection: { bg: '#FF007F', fg: '#0B0C10' },
    scrollbar: { width: '6px', thumb: '#45A29E', track: '#0B0C10' },
  },
};
