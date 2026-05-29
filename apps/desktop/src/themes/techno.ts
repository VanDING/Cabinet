import type { Theme } from './types';

export const techno: Theme = {
  id: 'techno',
  name: 'Techno',
  colors: {
    surface: {
      primary: '#1C1C1C',
      elevated: '#2A2A2A',
      overlay: 'rgba(0, 0, 0, 0.90)',
      input: '#333333',
      muted: '#252525',
    },
    content: {
      primary: '#E0E0E0',
      secondary: '#F4C542',
      tertiary: '#888888',
      inverse: '#1C1C1C',
    },
    border: {
      color: '#555555',
      subtle: '#3A3A3A',
    },
    accent: {
      base: '#F4C542',
      hover: '#E0B830',
      muted: '#3E3A20',
      foreground: '#1C1C1C',
    },
    intent: {
      success:  { color: '#8BC34A', muted: 'rgba(139, 195, 74, 0.10)', foreground: '#1C1C1C' },
      danger:   { color: '#FF1744', muted: 'rgba(255, 23, 68, 0.10)', foreground: '#1C1C1C' },
      warning:  { color: '#F4C542', muted: 'rgba(244, 197, 66, 0.10)', foreground: '#1C1C1C' },
      info:     { color: '#64B4FF', muted: 'rgba(100, 180, 255, 0.10)', foreground: '#1C1C1C' },
      purple:   { color: '#B48CFF', muted: 'rgba(180, 140, 255, 0.10)', foreground: '#1C1C1C' },
    },
  },
  style: {
    radius:  { sm: '0', md: '0', lg: '0', xl: '0' },
    shadow:  {
      sm: '2px 2px 0 #000000',
      md: '2px 2px 0 #000000',
      lg: '3px 3px 0 #000000',
    },
    font: {
      family: "'Share Tech Mono', 'Consolas', 'Courier New', monospace",
      display: "'Share Tech Mono', 'Consolas', 'Courier New', monospace",
      letterSpacing: '0.04em',
      lineHeight: '1.4',
    },
    border: { width: '2px' },
    transition: { duration: '80ms', easing: 'ease-out' },
    opacity: { hover: '1.0', disabled: '0.5', overlay: '0.7' },
    glass: { blur: '0px', opacity: '1' },
    focusRing: { width: '2px', color: '#F4C542', offset: '2px' },
    selection: { bg: '#F4C542', fg: '#1C1C1C' },
    scrollbar: { width: '8px', thumb: '#555555', track: '#1C1C1C' },
    bodyBg: 'repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(255,255,255,0.012) 1px, rgba(255,255,255,0.012) 2px), #1C1C1C',
  },
};
