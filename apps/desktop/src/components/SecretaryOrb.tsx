import { useRef, useEffect, useState, useCallback } from 'react';
import { useChat } from '../contexts/ChatContext';
import { useNotifications } from './NotificationContext';
import type { AppNotification } from './NotificationContext';

/** Map mood → expression preset name */
const MOOD_EXPRESSION: Record<string, string> = {
  idle: 'normal',
  thinking: 'focused',
  happy: 'happy',
  surprised: 'surprised',
  sleepy: 'sleepy',
};

/** Notification type → emoji icon */
const BUBBLE_ICONS: Record<AppNotification['type'], string> = {
  decision: '🎯',
  meeting: '📅',
  task: '✅',
  project: '📦',
  system: '🔔',
  workflow: '⚙️',
  deliverable: '📄',
};

type Accessory = 'none' | 'hat' | 'crown' | 'headphones' | 'blush' | 'heart-eyes' | 'imp';

interface SecretaryOrbProps {
  onOpen?: () => void;
  uiMode: 'idle' | 'work' | 'chat';
}

export function SecretaryOrb({ onOpen, uiMode }: SecretaryOrbProps) {
  const { activeSession, createSession, orbMood } = useChat();
  const { notifications, markRead } = useNotifications();

  const wrapRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const faceRef = useRef<HTMLDivElement>(null);

  const [accessory, setAccessory] = useState<Accessory>('none');
  const [bubbles, setBubbles] = useState<AppNotification[]>([]);
  const [isExcited, setIsExcited] = useState(false);
  const mouseInRangeRef = useRef(false);
  const autoMorphTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zzzIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const noteIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevUnreadRef = useRef(0);

  const handleClick = () => {
    if (!activeSession) {
      createSession();
    }
    onOpen?.();
  };

  /* ── Magnet effect + eye tracking ── */
  useEffect(() => {
    const wrap = wrapRef.current;
    const inner = innerRef.current;
    const face = faceRef.current;
    if (!wrap || !inner || !face) return;

    const padding = 100;
    const strength = 3;

    const onMouseMove = (e: MouseEvent) => {
      const rect = wrap.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const distX = Math.abs(centerX - e.clientX);
      const distY = Math.abs(centerY - e.clientY);

      const inRange = distX < rect.width / 2 + padding && distY < rect.height / 2 + padding;
      mouseInRangeRef.current = inRange;

      // Magnet: whole orb follows mouse
      if (inRange) {
        const offsetX = (e.clientX - centerX) / strength;
        const offsetY = (e.clientY - centerY) / strength;
        inner.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0)`;
      } else {
        inner.style.transform = 'translate3d(0, 0, 0)';
      }

      // Eyes: orb-face moves inside the orb (only within magnet range)
      if (inRange) {
        const dx = e.clientX - centerX;
        const dy = e.clientY - centerY;
        const angle = Math.atan2(dy, dx);
        const maxOffset = 10;
        const dist = Math.min(Math.sqrt(dx * dx + dy * dy), maxOffset * 3);
        const factor = dist / (maxOffset * 3);
        const fx = Math.cos(angle) * maxOffset * factor;
        const fy = Math.sin(angle) * maxOffset * factor;
        face.style.transform = `translate(${fx}px, ${fy}px)`;
      } else {
        face.style.transform = 'translate(0, 0)';
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    return () => window.removeEventListener('mousemove', onMouseMove);
  }, []);

  /* ── Notification bubbles (only when orb is visible) ── */
  useEffect(() => {
    if (uiMode !== 'idle') {
      setBubbles([]);
      return;
    }
    const unread = notifications.filter((n) => !n.read).slice(0, 2);
    setBubbles(unread);
  }, [notifications, uiMode]);

  /* ── Trigger excited animation on new unread notification ── */
  useEffect(() => {
    const unread = notifications.filter((n) => !n.read).length;
    if (unread > prevUnreadRef.current && uiMode === 'idle') {
      setIsExcited(true);
      const t = setTimeout(() => setIsExcited(false), 500);
      return () => clearTimeout(t);
    }
    prevUnreadRef.current = unread;
  }, [notifications, uiMode]);

  const dismissBubble = useCallback(
    (id: string) => {
      markRead(id);
      setBubbles((prev) => prev.filter((b) => b.id !== id));
    },
    [markRead],
  );

  /* ── ZZZ particles for sleepy mood ── */
  useEffect(() => {
    if (orbMood !== 'sleepy') {
      if (zzzIntervalRef.current) {
        clearInterval(zzzIntervalRef.current);
        zzzIntervalRef.current = null;
      }
      return;
    }
    zzzIntervalRef.current = setInterval(() => {
      const container = wrapRef.current?.querySelector('.zzz-container');
      if (!container) return;
      const z = document.createElement('span');
      z.className = 'zzz-particle';
      z.textContent = 'Z';
      (z as HTMLElement).style.right = `${Math.random() * 10}px`;
      container.appendChild(z);
      setTimeout(() => z.remove(), 2500);
    }, 2200);
    return () => {
      if (zzzIntervalRef.current) clearInterval(zzzIntervalRef.current);
    };
  }, [orbMood]);

  /* ── Note particles for happy mood ── */
  useEffect(() => {
    if (orbMood !== 'happy') {
      if (noteIntervalRef.current) {
        clearInterval(noteIntervalRef.current);
        noteIntervalRef.current = null;
      }
      return;
    }
    noteIntervalRef.current = setInterval(() => {
      const container = wrapRef.current?.querySelector('.note-container');
      if (!container) return;
      const n = document.createElement('span');
      n.className = 'note-particle';
      n.textContent = ['♪', '♫', '♬'][Math.floor(Math.random() * 3)] as string;
      (n as HTMLElement).style.left = `${Math.random() * 10}px`;
      container.appendChild(n);
      setTimeout(() => n.remove(), 3000);
    }, 1800);
    return () => {
      if (noteIntervalRef.current) clearInterval(noteIntervalRef.current);
    };
  }, [orbMood]);

  /* ── Auto morph accessory when idle ── */
  useEffect(() => {
    if (orbMood !== 'idle') {
      setAccessory('none');
      stopAutoMorph();
      return;
    }

    const pool: Accessory[] = ['none', 'hat', 'crown', 'headphones', 'blush', 'heart-eyes', 'imp'];

    function cycle() {
      const next = pool[Math.floor(Math.random() * pool.length)] as Accessory;
      setAccessory(next);
      autoMorphTimerRef.current = setTimeout(cycle, 8000 + Math.random() * 7000);
    }

    autoMorphTimerRef.current = setTimeout(cycle, 12000 + Math.random() * 8000);
    return () => stopAutoMorph();
     
  }, [orbMood]);

  function stopAutoMorph() {
    if (autoMorphTimerRef.current) {
      clearTimeout(autoMorphTimerRef.current);
      autoMorphTimerRef.current = null;
    }
  }

  /* ── Hover pop ── */
  const handleMouseEnter = () => {
    const btn = wrapRef.current?.querySelector('.secretary-orb');
    if (!btn) return;
    btn.classList.add('pop');
    setTimeout(() => btn.classList.remove('pop'), 350);
  };

  const expression = MOOD_EXPRESSION[orbMood] || 'normal';

  return (
    <div ref={wrapRef} className="secretary-orb-wrap">
      <div ref={innerRef} className="secretary-orb-inner">
        <button
          onClick={handleClick}
          onMouseEnter={handleMouseEnter}
          className={`secretary-orb mood-${orbMood} ${isExcited ? 'excited' : ''} ${
            orbMood === 'thinking' ? 'thinking-active' : ''
          } acc-${accessory}`}
          data-expression={expression}
          title="Secretary"
          aria-label="Open Secretary chat"
        >
          {/* ── Accessories ── */}
          <div className="accessory orb-horn left" />
          <div className="accessory orb-horn right" />

          <div className="accessory orb-hat-wrap">
            <div className="orb-hat-top" />
            <div className="orb-hat-brim" />
          </div>

          <div className="accessory orb-crown-wrap">
            <div className="orb-crown-peak" />
            <div className="orb-crown-peak" />
            <div className="orb-crown-peak" />
            <div className="orb-crown-band" />
          </div>

          <div className="accessory orb-headphones-wrap">
            <div className="orb-headphones-band" />
            <div className="orb-headphones-ear left" />
            <div className="orb-headphones-ear right" />
          </div>

          <div className="accessory orb-blush-wrap">
            <div className="orb-blush-spot" />
            <div className="orb-blush-spot" />
          </div>

          {/* ── Main body ── */}
          {orbMood === 'thinking' && <div className="spinner-ring" />}

          <div className="orb-face" ref={faceRef}>
            <div className="orb-eye" />
            <div className="orb-heart-eye" />
            <div className="orb-eye" />
            <div className="orb-heart-eye" />
          </div>

          {/* ── ZZZ particles ── */}
          <div className="zzz-container" />

          {/* ── Note particles ── */}
          <div className="note-container" />

          {/* ── Notification bubbles ── */}
          <div className="bubble-stack">
            {bubbles.map((bubble) => (
              <div
                key={bubble.id}
                className="orb-bubble"
                onClick={() => dismissBubble(bubble.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') dismissBubble(bubble.id);
                }}
              >
                <span className="bubble-icon">{BUBBLE_ICONS[bubble.type] ?? '🔔'}</span>
                <span className="bubble-text">{bubble.title}</span>
              </div>
            ))}
          </div>
        </button>
      </div>
    </div>
  );
}
