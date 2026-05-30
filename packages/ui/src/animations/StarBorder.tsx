import { type ReactNode } from 'react';

interface StarBorderProps {
  children: ReactNode;
  className?: string;
  color?: string;
  speed?: number;
}

/**
 * Subtle animated border with rotating corner accents.
 * Barely-visible enhancement for "active" or "running" states.
 * Pure CSS — uses conic-gradient with CSS animation.
 */
export function StarBorder({
  children,
  className = '',
  color = 'var(--accent)',
  speed = 6,
}: StarBorderProps) {
  return (
    <div className={`relative ${className}`}>
      {/* Animated border layer */}
      <div
        className="pointer-events-none absolute inset-0 rounded-[inherit]"
        style={{
          padding: '1px',
          background: `conic-gradient(from 0deg, ${color} 0%, transparent 40%, ${color} 60%, transparent 100%)`,
          WebkitMask:
            'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          WebkitMaskComposite: 'xor',
          maskComposite: 'exclude',
          animation: `star-border-spin ${speed}s linear infinite`,
          opacity: 0.35,
        }}
      />
      {children}
      <style>{`
        @keyframes star-border-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
