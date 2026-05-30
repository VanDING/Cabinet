import { forwardRef } from 'react';
import { cn } from './cn.js';
import { ClickSpark } from './animations/ClickSpark';

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
    'bg-accent text-accent-foreground hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50',
  secondary:
    'bg-surface-muted text-content-secondary hover:bg-surface-elevated focus-visible:ring-2 focus-visible:ring-border',
  destructive:
    'bg-intent-danger text-intent-danger-foreground hover:bg-intent-danger hover:opacity-80 focus-visible:ring-2 focus-visible:ring-intent-danger disabled:opacity-50',
  ghost:
    'border text-content-tertiary hover:text-content-secondary hover:bg-surface-elevated focus-visible:ring-2 focus-visible:ring-border',
  outline:
    'border bg-surface-primary text-content-secondary hover:bg-surface-elevated focus-visible:ring-2 focus-visible:ring-border',
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
  const content = (
    <>
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
    </>
  );

  return (
    <ClickSpark sparkColor="var(--accent)" sparkCount={5} sparkSize={5} sparkRadius={10} duration={300}>
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          'inline-flex items-center justify-center gap-1.5 font-medium shadow-xs transition-colors focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-50',
          variantClasses[variant],
          sizeClasses[size],
          fullWidth && 'w-full',
          className,
        )}
        {...rest}
      >
        {content}
      </button>
    </ClickSpark>
  );
});
