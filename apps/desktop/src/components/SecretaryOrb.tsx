import { Bot } from 'lucide-react';
import { useChat } from '../contexts/ChatContext';
import { useNotifications } from './NotificationContext';

export function SecretaryOrb() {
  const { activeSession, createSession, setUIMode, orbMood } = useChat();
  const { unreadCount } = useNotifications();

  const handleClick = () => {
    if (!activeSession) {
      createSession();
    }
    setUIMode('work');
  };

  return (
    <button
      onClick={handleClick}
      className={`secretary-orb mood-${orbMood}`}
      title="Secretary"
      aria-label="Open Secretary chat"
    >
      {orbMood === 'thinking' && <div className="spinner-ring" />}

      <Bot size={24} className="orb-icon" strokeWidth={2.5} />

      {unreadCount > 0 && (
        <span className="unread-badge">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </button>
  );
}
