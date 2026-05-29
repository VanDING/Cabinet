import { cn } from './cn.js';

type TagVariant = 'default' | 'success' | 'danger' | 'warning' | 'info' | 'purple' | 'amber';

export interface TagProps {
  variant?: TagVariant;
  className?: string;
  children: React.ReactNode;
}

const variantClasses: Record<TagVariant, string> = {
  default: 'bg-gray-100 text-gray-700',
  success: 'bg-green-100 text-green-700',
  danger: 'bg-red-100 text-red-700',
  warning: 'bg-amber-100 text-amber-700',
  info: 'bg-blue-100 text-blue-700',
  purple: 'bg-purple-100 text-purple-700',
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
