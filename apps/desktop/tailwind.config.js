/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    '../../packages/ui/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Semantic surface tokens — auto-switch via CSS variables
        surface: {
          primary: 'var(--surface-primary)',
          elevated: 'var(--surface-elevated)',
          overlay: 'var(--surface-overlay)',
          input: 'var(--surface-input)',
          muted: 'var(--surface-muted)',
        },
        // Semantic content/text tokens
        content: {
          primary: 'var(--content-primary)',
          secondary: 'var(--content-secondary)',
          tertiary: 'var(--content-tertiary)',
          inverse: 'var(--content-inverse)',
        },
        // Semantic border tokens
        border: {
          DEFAULT: 'var(--border-color)',
          subtle: 'var(--border-subtle)',
        },
        // Accent / brand tokens
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          muted: 'var(--accent-muted)',
          foreground: 'var(--accent-foreground)',
        },
        // Intent / semantic color tokens
        intent: {
          success: 'var(--intent-success)',
          'success-muted': 'var(--intent-success-muted)',
          'success-foreground': 'var(--intent-success-foreground)',
          danger: 'var(--intent-danger)',
          'danger-muted': 'var(--intent-danger-muted)',
          'danger-foreground': 'var(--intent-danger-foreground)',
          warning: 'var(--intent-warning)',
          'warning-muted': 'var(--intent-warning-muted)',
          'warning-foreground': 'var(--intent-warning-foreground)',
          info: 'var(--intent-info)',
          'info-muted': 'var(--intent-info-muted)',
          'info-foreground': 'var(--intent-info-foreground)',
          purple: 'var(--intent-purple)',
          'purple-muted': 'var(--intent-purple-muted)',
          'purple-foreground': 'var(--intent-purple-foreground)',
        },
      },
      borderRadius: {
        'ui-sm': 'var(--radius-sm)',
        'ui-md': 'var(--radius-md)',
        'ui-lg': 'var(--radius-lg)',
        'ui-xl': 'var(--radius-xl)',
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
        '3xs': ['0.6875rem', { lineHeight: '0.875rem' }],
      },
      transitionDuration: {
        DEFAULT: 'var(--duration)',
      },
      transitionTimingFunction: {
        DEFAULT: 'var(--easing)',
      },
    },
  },
  plugins: [],
};
