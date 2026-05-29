import { cn } from './cn.js';

type TagVariant = 'default' | 'success' | 'danger' | 'warning' | 'info' | 'purple' | 'amber';

export interface TagProps {
  variant?: TagVariant;
  className?: string;
  children: React.ReactNode;
}

const variantClasses: Record<TagVariant, string> = {
  default: 'bg-surface-muted text-content-secondary',
  success: 'bg-green-100 text-intent-success',
  danger: 'bg-red-100 text-intent-danger',
  warning: 'bg-amber-100 text-amber-700',
  info: 'bg-blue-100 text-accent',
  purple: 'bg-purple-100 text-intent-purple',
  amber: 'bg-amber-100 text-amber-700',
};

export function Tag({ variant = 'default', className, children }: TagProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        variantClasses[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
