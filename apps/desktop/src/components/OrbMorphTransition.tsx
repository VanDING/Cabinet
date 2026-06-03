import { useEffect, useRef } from 'react';

interface Props {
  fromRect: DOMRect;
  toRect: DOMRect;
  phase: 'opening' | 'closing';
  duration?: number;
  onComplete: () => void;
}

export function OrbMorphTransition({
  fromRect,
  toRect,
  phase,
  duration = 550,
  onComplete,
}: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const completedRef = useRef(false);

  useEffect(() => {
    const el = elRef.current;
    if (!el || completedRef.current) return;

    // Force reflow so the browser paints the initial styles first
    void el.offsetWidth;

    requestAnimationFrame(() => {
      if (!el) return;
      const easing = 'cubic-bezier(0.32, 0, 0.2, 1)';
      el.style.transition = `
        top ${duration}ms ${easing},
        left ${duration}ms ${easing},
        width ${duration}ms ${easing},
        height ${duration}ms ${easing},
        border-radius ${duration}ms ${easing},
        background ${duration * 0.5}ms ease,
        opacity ${duration * 0.35}ms ease
      `;
      el.style.top = `${toRect.top}px`;
      el.style.left = `${toRect.left}px`;
      el.style.width = `${toRect.width}px`;
      el.style.height = `${toRect.height}px`;
      el.style.borderRadius = phase === 'opening' ? '16px' : '9999px';
      el.style.opacity = '0';
    });

    const timer = setTimeout(() => {
      if (!completedRef.current) {
        completedRef.current = true;
        onComplete();
      }
    }, duration + 100);

    return () => clearTimeout(timer);
  }, [fromRect, toRect, duration, onComplete, phase]);

  const isOpening = phase === 'opening';

  return (
    <div
      ref={elRef}
      className="orb-morph-layer"
      style={{
        position: 'fixed',
        top: fromRect.top,
        left: fromRect.left,
        width: fromRect.width,
        height: fromRect.height,
        borderRadius: isOpening ? '9999px' : '16px',
        background: isOpening
          ? 'linear-gradient(135deg, var(--accent) 0%, color-mix(in srgb, var(--accent) 60%, var(--accent-hover)) 100%)'
          : 'var(--surface-elevated)',
        zIndex: 60,
        pointerEvents: 'none',
        opacity: 1,
        boxShadow:
          '0 10px 25px -5px color-mix(in srgb, var(--accent) 30%, transparent)',
      }}
    />
  );
}
