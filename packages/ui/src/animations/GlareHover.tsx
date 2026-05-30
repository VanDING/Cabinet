import { useState, useRef, type ReactNode, type MouseEvent } from 'react';

interface GlareHoverProps {
  children: ReactNode;
  className?: string;
  color?: string;
  maxOpacity?: number;
}

/**
 * Subtle mouse-tracking glare effect on cards.
 * Similar to macOS translucent card hover.
 * Pure CSS + inline style transforms — no dependencies.
 */
export function GlareHover({
  children,
  className = '',
  color = 'var(--content-primary)',
  maxOpacity = 0.04,
}: GlareHoverProps) {
  const [pos, setPos] = useState({ x: 0.5, y: 0.5, active: false });
  const ref = useRef<HTMLDivElement>(null);

  const handleMove = (e: MouseEvent) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setPos({
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
      active: true,
    });
  };

  const handleLeave = () => setPos((p) => ({ ...p, active: false }));

  return (
    <div
      ref={ref}
      className={`relative overflow-hidden ${className}`}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
    >
      {children}
      <div
        className="pointer-events-none absolute inset-0 transition-opacity duration-300"
        style={{
          background: `radial-gradient(circle at ${pos.x * 100}% ${pos.y * 100}%, ${color} 0%, transparent 70%)`,
          opacity: pos.active ? maxOpacity : 0,
        }}
      />
    </div>
  );
}
