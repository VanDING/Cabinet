import { useRef, useEffect, useCallback, type ReactNode } from 'react';

interface ClickSparkProps {
  children?: ReactNode;
  sparkColor?: string;
  sparkSize?: number;
  sparkRadius?: number;
  sparkCount?: number;
  duration?: number;
}

interface Spark {
  x: number;
  y: number;
  angle: number;
  startTime: number;
}

/**
 * Click particle burst effect. Pure Canvas + requestAnimationFrame.
 * Inspired by react-bits ClickSpark, adapted for Cabinet's theme system.
 */
export function ClickSpark({
  children,
  sparkColor = 'var(--accent)',
  sparkSize = 6,
  sparkRadius = 12,
  sparkCount = 6,
  duration = 350,
}: ClickSparkProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sparksRef = useRef<Spark[]>([]);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const resize = () => {
      const { width, height } = parent.getBoundingClientRect();
      canvas.width = width;
      canvas.height = height;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const now = performance.now();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    sparksRef.current = sparksRef.current.filter((spark) => {
      const elapsed = now - spark.startTime;
      if (elapsed >= duration) return false;

      const progress = elapsed / duration;
      const eased = progress * (2 - progress); // ease-out
      const distance = eased * sparkRadius;
      const lineLen = sparkSize * (1 - eased) * 0.5;
      const alpha = 1 - progress;

      const x1 = spark.x + distance * Math.cos(spark.angle);
      const y1 = spark.y + distance * Math.sin(spark.angle);
      const x2 = spark.x + (distance + lineLen) * Math.cos(spark.angle);
      const y2 = spark.y + (distance + lineLen) * Math.sin(spark.angle);

      ctx.globalAlpha = alpha;
      ctx.strokeStyle = sparkColor;
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      return true;
    });

    if (sparksRef.current.length > 0) {
      rafRef.current = requestAnimationFrame(draw);
    }
    ctx.globalAlpha = 1;
  }, [sparkColor, sparkSize, sparkRadius, duration]);

  const handleClick = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const now = performance.now();
    for (let i = 0; i < sparkCount; i++) {
      sparksRef.current.push({
        x,
        y,
        angle: (2 * Math.PI * i) / sparkCount,
        startTime: now,
      });
    }

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
  };

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  return (
    <div className="relative inline-flex" onClick={handleClick}>
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 z-10"
      />
      {children}
    </div>
  );
}
