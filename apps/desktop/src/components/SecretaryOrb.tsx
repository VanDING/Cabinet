import { useRef, useEffect, useCallback } from 'react';
import { useChat } from '../contexts/ChatContext';
import { useNotifications } from './NotificationContext';

/** Map mood → expression preset name */
const MOOD_EXPRESSION: Record<string, string> = {
  idle: 'normal',
  thinking: 'focused',
  happy: 'happy',
  surprised: 'surprised',
  sleepy: 'sleepy',
};

export function SecretaryOrb() {
  const { activeSession, createSession, setUIMode, orbMood } = useChat();
  const { unreadCount } = useNotifications();

  const wrapRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  const handleClick = () => {
    if (!activeSession) {
      createSession();
    }
    setUIMode('work');
  };

  // Magnet effect — mouse proximity attraction
  useEffect(() => {
    const wrap = wrapRef.current;
    const inner = innerRef.current;
    if (!wrap || !inner) return;

    const padding = 100;
    const strength = 3;

    const onMouseMove = (e: MouseEvent) => {
      const rect = wrap.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const distX = Math.abs(centerX - e.clientX);
      const distY = Math.abs(centerY - e.clientY);

      if (distX < rect.width / 2 + padding && distY < rect.height / 2 + padding) {
        const offsetX = (e.clientX - centerX) / strength;
        const offsetY = (e.clientY - centerY) / strength;
        inner.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0)`;
      } else {
        inner.style.transform = 'translate3d(0, 0, 0)';
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    return () => window.removeEventListener('mousemove', onMouseMove);
  }, []);

  const expression = MOOD_EXPRESSION[orbMood] || 'normal';

  return (
    <div ref={wrapRef} className="secretary-orb-wrap">
      <div ref={innerRef} className="secretary-orb-inner">
        <button
          onClick={handleClick}
          className={`secretary-orb mood-${orbMood}`}
          data-expression={expression}
          title="Secretary"
          aria-label="Open Secretary chat"
        >
          {orbMood === 'thinking' && <div className="spinner-ring" />}

          <div className="orb-face">
            <div className="orb-eye" />
            <div className="orb-eye" />
          </div>

          {unreadCount > 0 && (
            <span className="unread-badge">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
