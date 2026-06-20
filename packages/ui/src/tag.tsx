import { cn } from './cn.js';

type TagVariant = 'default' | 'success' | 'danger' | 'warning' | 'info' | 'purple' | 'amber';

export interface TagProps {
  variant?: TagVariant;
  className?: string;
  children: React.ReactNode;
}

const variantClasses: Record<TagVariant, string> = {
  default: 'bg-surface-muted text-content-secondary',
  success: 'bg-intent-success-muted text-intent-success',
  danger: 'bg-intent-danger-muted text-intent-danger',
  warning: 'bg-intent-warning-muted text-intent-warning',
  info: 'bg-accent-muted text-accent',
  purple: 'bg-intent-purple-muted text-intent-purple',
  amber: 'bg-intent-warning-muted text-intent-warning',
};

export function Tag({ variant = 'default', className, children }: TagProps) {
  return (
    <span
      className={cn(
        'border-border-subtle inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        variantClasses[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
