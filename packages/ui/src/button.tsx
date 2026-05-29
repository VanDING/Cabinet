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
    'bg-blue-600 text-white hover:bg-blue-700 focus-visible:ring-2 focus-visible:ring-blue-500 disabled:bg-blue-400',
  secondary:
    'bg-gray-100 text-gray-700 hover:bg-gray-200 focus-visible:ring-2 focus-visible:ring-gray-400 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600',
  destructive:
    'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-2 focus-visible:ring-red-500 disabled:bg-red-400',
  ghost:
    'border text-gray-500 hover:text-gray-700 hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-gray-400 dark:border-gray-600 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-700',
  outline:
    'border bg-white text-gray-700 hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700',
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
