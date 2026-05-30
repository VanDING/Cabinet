import { useEffect, useRef, useState } from 'react';

interface CountUpProps {
  to: number;
  from?: number;
  duration?: number;
  delay?: number;
  className?: string;
  separator?: string;
  suffix?: string;
  prefix?: string;
}

/**
 * Animated number counter using requestAnimationFrame.
 * No external dependencies. Uses ease-out easing curve.
 */
export function CountUp({
  to,
  from = 0,
  duration = 1.2,
  delay = 0,
  className = '',
  separator = '',
  suffix = '',
  prefix = '',
}: CountUpProps) {
  const [display, setDisplay] = useState(from);
  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(0);

  const format = (val: number): string => {
    const opts: Intl.NumberFormatOptions = {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    };
    // detect if we need decimals
    if (to.toString().includes('.') || from.toString().includes('.')) {
      const d1 = to.toString().split('.')[1]?.length ?? 0;
      const d2 = from.toString().split('.')[1]?.length ?? 0;
      opts.minimumFractionDigits = Math.min(Math.max(d1, d2), 2);
      opts.maximumFractionDigits = Math.min(Math.max(d1, d2), 2);
    }
    return Intl.NumberFormat('en-US', opts)
      .format(val)
      .replace(/,/g, separator || ',');
  };

  useEffect(() => {
    const timeout = setTimeout(() => {
      startRef.current = performance.now();

      const animate = (now: number) => {
        const elapsed = now - startRef.current;
        const progress = Math.min(elapsed / (duration * 1000), 1);
        // ease-out quad
        const eased = 1 - (1 - progress) * (1 - progress);
        setDisplay(from + (to - from) * eased);

        if (progress < 1) {
          rafRef.current = requestAnimationFrame(animate);
        }
      };

      rafRef.current = requestAnimationFrame(animate);
    }, delay * 1000);

    return () => {
      clearTimeout(timeout);
      cancelAnimationFrame(rafRef.current);
    };
  }, [to, from, duration, delay]);

  // Reset when values change
  useEffect(() => {
    setDisplay(from);
  }, [to, from]);

  return (
    <span className={className}>
      {prefix}
      {format(display)}
      {suffix}
    </span>
  );
}
