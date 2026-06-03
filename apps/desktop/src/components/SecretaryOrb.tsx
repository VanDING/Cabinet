import { Bot } from 'lucide-react';
import { useChat } from '../contexts/ChatContext';
import { useNotifications } from './NotificationContext';

const MOOD_STYLES: Record<string, string> = {
  idle: 'from-cyan-400 to-blue-500 dark:from-cyan-600 dark:to-blue-800 animate-[orb-breathe_3s_ease-in-out_infinite]',
  thinking: 'from-blue-400 to-indigo-500 dark:from-blue-600 dark:to-indigo-800',
  happy: 'from-cyan-300 to-sky-400 dark:from-cyan-500 dark:to-sky-600 animate-[orb-breathe_1.5s_ease-in-out_infinite]',
  surprised: 'from-amber-300 to-orange-400 dark:from-amber-500 dark:to-orange-600 animate-[float-gentle_1s_ease-in-out_2]',
  sleepy: 'from-slate-400 to-slate-500 dark:from-slate-600 dark:to-slate-700 animate-[orb-breathe_5s_ease-in-out_infinite]',
};

export function SecretaryOrb() {
  const { activeSession, createSession, setUIMode, orbMood } = useChat();
  const { unreadCount } = useNotifications();

  const handleClick = () => {
    if (!activeSession) {
      createSession();
    }
    setUIMode('work');
  };

  const moodStyle = MOOD_STYLES[orbMood] ?? MOOD_STYLES.idle;

  return (
    <button
      onClick={handleClick}
      className={`fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full
        bg-gradient-to-br ${moodStyle}
        border-2 border-white dark:border-gray-800
        shadow-lg shadow-blue-500/20 dark:shadow-cyan-500/20
        transition-transform duration-200 hover:scale-110
        will-change-transform
        cursor-pointer
      `}
      title="Secretary"
      aria-label="Open Secretary chat"
    >
      {/* Processing spinner ring */}
      {orbMood === 'thinking' && (
        <div className="absolute inset-0 rounded-full border-2 border-white/30 border-t-white animate-spin" />
      )}

      <Bot size={24} className="text-white relative z-10" strokeWidth={2.5} />

      {/* Unread badge */}
      {unreadCount > 0 && (
        <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-intent-danger px-1 text-[10px] font-bold text-white shadow-sm">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </button>
  );
}
