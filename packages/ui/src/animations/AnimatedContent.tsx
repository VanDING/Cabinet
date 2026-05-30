import { useEffect, useRef, useState, type ReactNode } from 'react';

interface AnimatedContentProps {
  children: ReactNode;
  /**
   * Key that triggers animation when changed.
   * Use route pathname or any unique identifier.
   */
  triggerKey: string;
  className?: string;
  duration?: number;
}

/**
 * Crossfade wrapper for route transitions.
 * When triggerKey changes, old content fades out and new content fades in.
 */
export function AnimatedContent({
  children,
  triggerKey,
  className = '',
  duration = 200,
}: AnimatedContentProps) {
  const [currentKey, setCurrentKey] = useState(triggerKey);
  const [isVisible, setIsVisible] = useState(true);
  const [content, setContent] = useState(children);
  const prevKeyRef = useRef(triggerKey);

  useEffect(() => {
    if (triggerKey !== prevKeyRef.current) {
      // Start fade out
      setIsVisible(false);
      prevKeyRef.current = triggerKey;

      const timeout = setTimeout(() => {
        setContent(children);
        setCurrentKey(triggerKey);
        // Force reflow, then fade in
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setIsVisible(true);
          });
        });
      }, duration);

      return () => clearTimeout(timeout);
    } else {
      setContent(children);
    }
  }, [triggerKey, children, duration]);

  return (
    <div
      key={currentKey}
      className={className}
      style={{
        opacity: isVisible ? 1 : 0,
        transition: `opacity ${duration}ms var(--easing, ease-out)`,
      }}
    >
      {content}
    </div>
  );
}
