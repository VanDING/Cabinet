import { useState, useEffect, useCallback, createContext, useContext, type ReactNode } from 'react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration?: number;
}

interface ToastContextValue {
  addToast: (type: ToastMessage['type'], message: string) => void;
}

const ToastContext = createContext<ToastContextValue>({ addToast: () => {} });
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((type: ToastMessage['type'], message: string) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev, { id, type, message, duration: 4000 }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="fixed bottom-4 right-4 z-50 max-w-sm space-y-2"
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onClose }: { toast: ToastMessage; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, toast.duration ?? 4000);
    return () => clearTimeout(timer);
  }, [toast.duration, onClose]);

  const colors = {
    success: 'bg-intent-success',
    error: 'bg-intent-danger',
    warning: 'bg-amber-700',
    info: 'bg-accent-hover',
  };

  return (
    <div
      className={`${colors[toast.type]} animate-slide-in flex items-center gap-2 rounded-lg px-4 py-3 text-content-inverse shadow-lg`}
    >
      <span className="flex-1 text-sm">{toast.message}</span>
      <button onClick={onClose} className="text-lg leading-none text-content-inverse/70 hover:text-content-inverse">
        &times;
      </button>
    </div>
  );
}
