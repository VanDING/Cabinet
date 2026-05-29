import { forwardRef } from 'react';
import { cn } from './cn.js';

type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost' | 'outline';
type ButtonSize = 'xs' | 'sm' | 'md';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  loading?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-content-inverse hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent disabled:bg-blue-400',
  secondary:
    'bg-surface-muted text-content-secondary hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-gray-400',
  destructive:
    'bg-intent-danger text-content-inverse hover:bg-red-700 focus-visible:ring-2 focus-visible:ring-intent-danger disabled:bg-red-400',
  ghost:
    'border text-content-tertiary hover:text-content-secondary hover:bg-surface-elevated focus-visible:ring-2 focus-visible:ring-gray-400',
  outline:
    'border bg-surface-primary text-content-secondary hover:bg-surface-elevated focus-visible:ring-2 focus-visible:ring-gray-400',
};

const sizeClasses: Record<ButtonSize, string> = {
  xs: 'rounded px-3 py-1 text-xs',
  sm: 'rounded-lg px-3 py-1.5 text-sm',
  md: 'rounded-lg px-4 py-2 text-sm',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'sm',
    fullWidth,
    loading,
    disabled,
    className,
    children,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 font-medium transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
        variantClasses[variant],
        sizeClasses[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading && (
        <svg
          className="h-3.5 w-3.5 animate-spin"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
          <path
            d="M14 8a6 6 0 00-10.4-4.3"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      )}
      {children}
    </button>
  );
});
