import { useState, useRef } from 'react';
import { Bell } from 'lucide-react';
import { useNotifications, type AppNotification } from './NotificationContext';
import { useOutsideClick } from '../hooks/useOutsideClick';

const TYPE_ICONS: Record<AppNotification['type'], { label: string; color: string }> = {
  decision: { label: 'D', color: 'bg-blue-500' },
  meeting: { label: 'M', color: 'bg-purple-500' },
  task: { label: 'T', color: 'bg-amber-500' },
  project: { label: 'P', color: 'bg-green-500' },
  system: { label: 'S', color: 'bg-gray-500' },
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

interface Props {
  isDark?: boolean;
}

export function NotificationBell({ isDark }: Props) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const { notifications, unreadCount, markRead, markAllRead, clearAll } = useNotifications();

  useOutsideClick(btnRef, () => setOpen(false), open);

  const bgClass = isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200';
  const itemHover = isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-50';
  const textClass = isDark ? 'text-gray-200' : 'text-gray-800';
  const subtextClass = isDark ? 'text-gray-400' : 'text-gray-500';
  const borderClass = isDark ? 'border-gray-700' : 'border-gray-200';

  return (
    <div className="relative flex h-full items-center">
      <button
        ref={btnRef}
        onClick={() => setOpen(!open)}
        className={`relative flex h-full w-8 items-center justify-center transition-colors ${
          isDark ? 'text-gray-400 hover:bg-gray-700 hover:text-gray-200' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
        }`}
        aria-label="Notifications"
      >
        <Bell size={14} />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-orange-500 px-0.5 text-[9px] font-bold text-white leading-none">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className={`absolute right-0 top-full z-50 mt-1 w-80 rounded-lg border shadow-xl ${bgClass}`}>
          <div className={`flex items-center justify-between border-b px-3 py-2 ${borderClass}`}>
            <span className={`text-xs font-semibold ${textClass}`}>Notifications</span>
            <div className="flex gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className={`rounded px-2 py-0.5 text-xs transition-colors ${subtextClass} hover:text-blue-500`}
                >
                  Mark all read
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  onClick={clearAll}
                  className={`rounded px-2 py-0.5 text-xs transition-colors ${subtextClass} hover:text-red-500`}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Bell size={24} className={`mx-auto mb-2 ${subtextClass}`} />
                <p className={`text-xs ${subtextClass}`}>No notifications</p>
              </div>
            ) : (
              notifications.map((n) => {
                const icon = TYPE_ICONS[n.type] ?? TYPE_ICONS.system;
                return (
                  <button
                    key={n.id}
                    onClick={() => { markRead(n.id); }}
                    className={`flex w-full items-start gap-2.5 border-b px-3 py-2.5 text-left transition-colors ${itemHover} ${borderClass} ${n.read ? 'opacity-60' : ''}`}
                  >
                    <span className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${icon.color}`}>
                      {icon.label}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`truncate text-xs font-medium ${textClass}`}>{n.title}</p>
                        <span className={`flex-shrink-0 text-[10px] ${subtextClass}`}>{timeAgo(n.timestamp)}</span>
                      </div>
                      <p className={`mt-0.5 truncate text-[11px] ${subtextClass}`}>{n.message}</p>
                    </div>
                    {!n.read && (
                      <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-blue-500" />
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
