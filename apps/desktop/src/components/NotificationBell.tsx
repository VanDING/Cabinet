import { useState, useRef, useEffect } from 'react';
import { Bell } from 'lucide-react';
import { useNotifications, type AppNotification } from './NotificationContext';

const TYPE_ICONS: Record<AppNotification['type'], { label: string; color: string }> = {
  decision: { label: 'D', color: 'bg-accent' },
  meeting: { label: 'M', color: 'bg-intent-purple' },
  task: { label: 'T', color: 'bg-intent-warning' },
  project: { label: 'P', color: 'bg-intent-success' },
  system: { label: 'S', color: 'bg-surface-elevated0' },
  workflow: { label: 'W', color: 'bg-intent-info' },
  deliverable: { label: 'F', color: 'bg-intent-info' },
};

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString();
}

const panelClasses =
  'absolute right-0 top-full z-50 mt-1 w-80 rounded-lg border border-border bg-surface-primary shadow-xl';
const textClasses = 'text-content-primary';
const subtextClasses = 'text-content-tertiary';
const borderClasses = 'border-border';
const itemHoverClasses = 'hover:bg-surface-elevated bg-surface-input';

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { notifications, unreadCount, markRead, markAllRead, clearAll } = useNotifications();

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative flex h-full items-center">
      <button
        ref={btnRef}
        onClick={() => setOpen(!open)}
        className="relative flex h-full w-8 items-center justify-center text-content-tertiary transition-colors hover:bg-surface-muted hover:text-content-secondary:bg-surface-input:text-content-tertiary"
        aria-label="Notifications"
      >
        <Bell size={14} />
        {unreadCount > 0 && (
          <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-accent ring-1 ring-surface-primary" />
        )}
      </button>

      {open && (
        <div ref={panelRef} className={panelClasses}>
          <div className={`flex items-center justify-between border-b px-3 py-2 ${borderClasses}`}>
            <span className={`text-xs font-semibold ${textClasses}`}>Notifications</span>
            <div className="flex gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className={`rounded px-2 py-0.5 text-xs transition-colors ${subtextClasses} hover:text-accent`}
                >
                  Mark all read
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  onClick={clearAll}
                  className={`rounded px-2 py-0.5 text-xs transition-colors ${subtextClasses} hover:text-intent-danger`}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Bell size={24} className={`mx-auto mb-2 ${subtextClasses}`} />
                <p className={`text-xs ${subtextClasses}`}>No notifications</p>
              </div>
            ) : (
              notifications.map((n) => {
                const icon = TYPE_ICONS[n.type] ?? TYPE_ICONS.system;
                const isExpanded = expandedId === n.id;
                const isLong = n.message.length > 100;
                return (
                  <button
                    key={n.id}
                    onClick={() => {
                      if (!n.read) markRead(n.id);
                      setExpandedId(isExpanded ? null : n.id);
                    }}
                    className={`flex w-full items-start gap-2.5 border-b px-3 py-2.5 text-left transition-colors ${itemHoverClasses} ${borderClasses} ${n.read ? 'opacity-60' : ''}`}
                  >
                    <span
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-content-inverse ${icon.color}`}
                    >
                      {icon.label}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`truncate text-xs font-medium ${textClasses}`}>{n.title}</p>
                        <span className={`shrink-0 text-[10px] ${subtextClasses}`}>
                          {timeAgo(n.timestamp)}
                        </span>
                      </div>
                      <p
                        className={`mt-0.5 text-[11px] ${subtextClasses} ${isExpanded ? 'whitespace-pre-wrap' : 'truncate'}`}
                      >
                        {n.message}
                      </p>
                      {isLong && (
                        <p className={`mt-1 text-[10px] ${subtextClasses}`}>
                          {isExpanded ? '▲ collapse' : '▼ expand'}
                        </p>
                      )}
                    </div>
                    {!n.read && (
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
