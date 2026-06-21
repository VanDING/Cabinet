import { useEffect, useState, useRef, type ReactNode } from 'react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  contentClassName?: string;
  backdropClassName?: string;
}

export function ModalOverlay({
  isOpen,
  onClose,
  children,
  contentClassName,
  backdropClassName,
}: Props) {
  const [visible, setVisible] = useState(isOpen);
  const [phase, setPhase] = useState<'enter' | 'enter-active' | 'exit' | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isOpen) {
      setVisible(true);
      // Force a reflow then trigger enter animation
      requestAnimationFrame(() => {
        setPhase('enter');
        timerRef.current = setTimeout(() => setPhase('enter-active'), 50);
      });
    } else if (visible) {
      setPhase('exit');
      timerRef.current = setTimeout(() => {
        setVisible(false);
        setPhase(null);
      }, 250);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isOpen, visible]);

  if (!visible) return null;

  const backdropPhase = phase ?? '';

  return (
    <div
      className={`modal-backdrop ${backdropPhase} ${backdropClassName ?? ''}`}
      onClick={onClose}
      aria-modal="true"
      role="dialog"
    >
      <div
        className={`modal-content ${backdropPhase} ${contentClassName ?? ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
