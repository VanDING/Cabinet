import type { Theme } from './types';

export const zen: Theme = {
  id: 'zen',
  name: 'Zen',
  colors: {
    surface: {
      primary: '#F9F8F6',
      elevated: '#F2F0EB',
      overlay: 'rgba(245, 240, 235, 0.90)',
      input: '#F9F8F6',
      muted: '#F2F0EB',
    },
    content: {
      primary: '#2C2C2C',
      secondary: '#7A7A7A',
      tertiary: '#B0B0B0',
      inverse: '#F9F8F6',
    },
    border: {
      color: '#D4CFC4',
      subtle: 'transparent',
    },
    accent: {
      base: '#3A5A78',
      hover: '#2C4A63',
      muted: '#E4EAF0',
      foreground: '#F9F8F6',
    },
    intent: {
      success:  { color: '#4A6B4A', muted: '#E8F0E8', foreground: '#F9F8F6' },
      danger:   { color: '#8B5A5A', muted: '#F0E8E8', foreground: '#F9F8F6' },
      warning:  { color: '#8B784A', muted: '#F0EDE0', foreground: '#F9F8F6' },
      info:     { color: '#3A5A78', muted: '#E4EAF0', foreground: '#F9F8F6' },
      purple:   { color: '#6B5A7B', muted: '#ECE8F0', foreground: '#F9F8F6' },
    },
  },
  style: {
    radius:  { sm: '0', md: '2px', lg: '4px', xl: '6px' },
    shadow:  {
      sm: '0 1px 2px rgba(0, 0, 0, 0.03)',
      md: '0 1px 3px rgba(0, 0, 0, 0.04)',
      lg: '0 2px 6px rgba(0, 0, 0, 0.06)',
    },
    font: {
      family: "'Noto Serif JP', Georgia, 'Times New Roman', serif",
      display: "'Noto Serif JP', Georgia, 'Times New Roman', serif",
      letterSpacing: '0.02em',
      lineHeight: '2',
    },
    border: { width: '1px' },
    transition: { duration: '300ms', easing: 'ease-in-out' },
    opacity: { hover: '0.9', disabled: '0.4', overlay: '0.3' },
    glass: { blur: '0px', opacity: '1' },
    focusRing: { width: '1px', color: '#2C2C2C', offset: '0px' },
    selection: { bg: '#E8F0E8', fg: '#4A6B4A' },
    scrollbar: { width: '4px', thumb: '#D4CFC4', track: 'transparent' },
    bodyBg: 'linear-gradient(0deg, rgba(0,0,0,0.015) 0%, transparent 50%, rgba(0,0,0,0.01) 100%), #F2F0EB',
  },
};
