import { useEffect, useRef, useState, type ReactNode } from 'react';

interface FadeContentProps {
  children: ReactNode;
  className?: string;
  duration?: number;
  delay?: number;
  blur?: boolean;
}

/**
 * Lightweight fade-in on mount. No external dependencies.
 * Uses CSS transitions for GPU-accelerated animation.
 */
export function FadeContent({
  children,
  className = '',
  duration = 400,
  delay = 0,
  blur = false,
}: FadeContentProps) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        filter: visible ? 'blur(0px)' : blur ? 'blur(4px)' : 'blur(0px)',
        transition: `opacity ${duration}ms var(--easing, ease-out), filter ${duration}ms var(--easing, ease-out)`,
        willChange: blur ? 'opacity, filter' : 'opacity',
      }}
    >
      {children}
    </div>
  );
}
