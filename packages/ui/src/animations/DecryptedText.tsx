import { useEffect, useState, useRef } from 'react';

interface DecryptedTextProps {
  text: string;
  className?: string;
  speed?: number;
  maxIterations?: number;
  chars?: string;
}

const DEFAULT_CHARS = '!@#$%^&*()_+-=[]{}|;:,./<>?`~';

/**
 * Text scrambling effect that resolves to readable text.
 * Subtle enough for AI "thinking" status display.
 * Pure JS — no dependencies.
 */
export function DecryptedText({
  text,
  className = '',
  speed = 40,
  maxIterations = 10,
  chars = DEFAULT_CHARS,
}: DecryptedTextProps) {
  const [display, setDisplay] = useState('');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const iterRef = useRef(0);

  useEffect(() => {
    iterRef.current = 0;

    const getScrambled = (progress: number) =>
      text
        .split('')
        .map((char, i) => {
          if (char === ' ') return ' ';
          if (i <= Math.floor(progress * text.length)) return char;
          return chars[Math.floor(Math.random() * chars.length)];
        })
        .join('');

    const id = setInterval(() => {
      iterRef.current++;
      const progress = Math.min(iterRef.current / maxIterations, 1);
      setDisplay(getScrambled(progress));

      if (progress >= 1) {
        clearInterval(id);
      }
    }, speed);

    intervalRef.current = id;

    return () => clearInterval(id);
  }, [text, speed, maxIterations, chars]);

  return <span className={className}>{display || text}</span>;
}
