import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

export interface ContextMenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export type ContextMenuEntry = { type: 'item'; item: ContextMenuItem } | { type: 'separator' };

interface Props {
  x: number;
  y: number;
  title?: string;
  entries: ContextMenuEntry[];
  onClose: () => void;
}

export function ContextMenu({ x, y, title, entries, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = () => onClose();
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener('mousedown', handler, true);
    document.addEventListener('scroll', close, true);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('mousedown', handler, true);
      document.removeEventListener('scroll', close, true);
      window.removeEventListener('blur', close);
    };
  }, [onClose]);

  // Adjust position so the menu doesn't overflow the viewport
  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const overflowX = Math.max(0, rect.right - window.innerWidth);
    const overflowY = Math.max(0, rect.bottom - window.innerHeight);
    if (overflowX > 0) ref.current.style.left = `${x - overflowX - 4}px`;
    if (overflowY > 0) ref.current.style.top = `${y - overflowY - 4}px`;
  }, [x, y]);

  return (
    <div
      ref={ref}
      className="border-border bg-surface-primary fixed z-50 min-w-[180px] rounded-lg border py-1 shadow-lg"
      style={{ left: x, top: y }}
    >
      {title && (
        <div className="border-hairline text-content-secondary truncate border-b px-3 py-1.5 text-xs font-medium">
          {title}
        </div>
      )}
      {entries.map((entry, i) => {
        if (entry.type === 'separator') {
          return <div key={`sep-${i}`} className="bg-hairline mx-2 my-1 h-px" />;
        }
        const { label, icon, onClick, danger, disabled } = entry.item;
        return (
          <button
            key={`item-${i}-${label}`}
            disabled={disabled}
            onClick={() => {
              onClick();
              onClose();
            }}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
              disabled
                ? 'text-content-tertiary cursor-default'
                : danger
                  ? 'text-intent-danger hover:bg-intent-danger-muted'
                  : 'text-content-secondary hover:bg-surface-muted'
            }`}
          >
            {icon && <span className="shrink-0">{icon}</span>}
            <span className="flex-1 truncate">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
