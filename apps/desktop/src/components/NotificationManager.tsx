import { SecretaryBubble } from './SecretaryBubble';
import { useChat } from '../contexts/ChatContext';

export function NotificationManager() {
  const { notifications, dismissNotification } = useChat();

  if (notifications.length === 0) return null;

  return (
    <>
      {notifications.map((n, i) => (
        <SecretaryBubble key={n.id} notification={n} onDismiss={dismissNotification} index={i} />
      ))}
    </>
  );
}
