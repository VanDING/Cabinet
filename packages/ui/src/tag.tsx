import { Badge } from
  '../../../apps/desktop/src/components/ui/badge.js';
import { cn } from './cn.js';

export type TagVariant = 'default' | 'success' | 'danger' | 'warning' | 'info' | 'purple' | 'amber';

export interface TagProps {
  variant?: TagVariant;
  className?: string;
  children: React.ReactNode;
}

const badgeVariantMap: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  default: 'default',
  success: 'default',
  danger: 'destructive',
  warning: 'outline',
  info: 'default',
  purple: 'default',
  amber: 'outline',
};

const colorOverrides: Record<string, string> = {
  success: 'border-transparent bg-[var(--intent-success-muted)] text-[var(--intent-success)]',
  info: 'border-transparent bg-[var(--accent-muted)] text-[var(--accent)]',
  purple: 'border-transparent bg-[var(--intent-purple-muted)] text-[var(--intent-purple)]',
  amber: 'border-transparent bg-[var(--intent-warning-muted)] text-[var(--intent-warning)]',
};

export function Tag({ variant = 'default', className, children }: TagProps) {
  return (
    <Badge
      variant={badgeVariantMap[variant] as any}
      className={cn(colorOverrides[variant], className)}
    >
      {children}
    </Badge>
  );
}
