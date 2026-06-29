import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuLabel,
} from '@/components/ui/context-menu';

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

  // Wrapper div to position the shadcn-style menu at coordinates
  return (
    <div
      ref={ref}
      className="fixed z-50"
      style={{ left: x, top: y }}
    >
      <ContextMenuContent
        className="min-w-[180px]"
        aria-label={title}
      >
        {title && (
          <ContextMenuLabel className="text-xs font-medium text-muted-foreground truncate">
            {title}
          </ContextMenuLabel>
        )}
        {entries.map((entry, i) => {
          if (entry.type === 'separator') {
            return <ContextMenuSeparator key={`sep-${i}`} />;
          }
          const { label, icon, onClick, danger, disabled } = entry.item;
          return (
            <ContextMenuItem
              key={`item-${i}-${label}`}
              disabled={disabled}
              variant={danger ? 'destructive' : 'default'}
              onSelect={() => {
                onClick();
                onClose();
              }}
            >
              {icon && <span className="shrink-0">{icon}</span>}
              <span className="flex-1 truncate">{label}</span>
            </ContextMenuItem>
          );
        })}
      </ContextMenuContent>
    </div>
  );
}
