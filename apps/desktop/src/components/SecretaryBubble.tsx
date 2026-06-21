import { useEffect, useState, useRef, useCallback } from 'react';
import type { SecretaryNotification } from '../contexts/ChatContext';
import { X, CheckCircle, AlertTriangle, Info, MessageSquare } from 'lucide-react';

interface Props {
  notification: SecretaryNotification;
  onDismiss: (id: string) => void;
  index: number;
}

const TYPE_ICONS = {
  info: Info,
  success: CheckCircle,
  warning: AlertTriangle,
  interactive: MessageSquare,
};

const TYPE_COLORS = {
  info: 'border-blue-400/50 bg-blue-50/90 dark:bg-blue-900/20',
  success: 'border-green-400/50 bg-green-50/90 dark:bg-green-900/20',
  warning: 'border-amber-400/50 bg-amber-50/90 dark:bg-amber-900/20',
  interactive: 'border-cyan-400/50 bg-cyan-50/90 dark:bg-cyan-900/20',
};

const TYPE_ICON_COLORS = {
  info: 'text-blue-500',
  success: 'text-green-500',
  warning: 'text-amber-500',
  interactive: 'text-cyan-500',
};

export function SecretaryBubble({ notification, onDismiss, index }: Props) {
  const [isVisible, setIsVisible] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remainingRef = useRef(notification.autoDismiss ?? 6000);
  const startRef = useRef(Date.now());

  const Icon = TYPE_ICONS[notification.type];

  const dismiss = useCallback(() => {
    setIsVisible(false);
    setTimeout(() => onDismiss(notification.id), 200);
  }, [notification.id, onDismiss]);

  useEffect(() => {
    // Stagger entrance
    const entranceTimer = setTimeout(() => setIsVisible(true), index * 120);
    return () => clearTimeout(entranceTimer);
  }, [index]);

  useEffect(() => {
    if (!isVisible) return;

    const tick = () => {
      if (isHovered) {
        startRef.current = Date.now();
        timerRef.current = setTimeout(tick, 100);
        return;
      }
      const elapsed = Date.now() - startRef.current;
      remainingRef.current -= elapsed;
      startRef.current = Date.now();

      if (remainingRef.current <= 0) {
        dismiss();
      } else {
        timerRef.current = setTimeout(tick, Math.min(remainingRef.current, 100));
      }
    };

    startRef.current = Date.now();
    timerRef.current = setTimeout(tick, notification.autoDismiss ?? 6000);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isVisible, isHovered, notification.autoDismiss, dismiss]);

  const bottomOffset = 100 + index * 100; // stack upward

  return (
    <div
      className={`fixed z-[60] transition-all duration-300 ease-out ${isVisible ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-3 scale-95 opacity-0'} `}
      style={{ bottom: `${bottomOffset}px`, right: '24px', maxWidth: '280px' }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Bubble body */}
      <div
        className={`relative rounded-xl border px-3.5 py-2.5 shadow-lg backdrop-blur-sm ${TYPE_COLORS[notification.type]} `}
      >
        {/* Tail */}
        <div
          className="absolute right-5 -bottom-1.5 h-3 w-3 rotate-45 border-r border-b bg-inherit"
          style={{ borderColor: 'inherit' }}
        />

        {/* Header */}
        <div className="flex items-start gap-2">
          <Icon size={16} className={`mt-0.5 shrink-0 ${TYPE_ICON_COLORS[notification.type]}`} />
          <div className="min-w-0 flex-1">
            <p className="text-content-primary text-sm leading-snug font-medium">
              {notification.title}
            </p>
            {notification.body && (
              <p className="text-content-secondary mt-0.5 line-clamp-3 text-xs leading-relaxed">
                {notification.body}
              </p>
            )}
          </div>
          <button
            onClick={dismiss}
            className="text-content-tertiary hover:text-content-secondary hover:bg-surface-muted -mt-0.5 -mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors"
            aria-label="Dismiss"
          >
            <X size={12} />
          </button>
        </div>

        {/* Actions */}
        {notification.actions && notification.actions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {notification.actions.map((action, i) => (
              <button
                key={i}
                onClick={() => {
                  action.onClick();
                  dismiss();
                }}
                className="bg-surface-overlay/80 text-content-secondary hover:bg-surface-elevated hover:text-content-primary rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
