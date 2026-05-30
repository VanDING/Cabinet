import { forwardRef } from 'react';
import { cn } from './cn.js';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  fullWidth?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { fullWidth, className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        'rounded-lg border border-border bg-surface-primary px-3 py-2 text-sm text-content-primary placeholder:text-content-tertiary transition-colors focus:ring-2 focus:ring-accent focus:outline-hidden disabled:bg-surface-elevated',
        fullWidth !== false && 'w-full',
        className,
      )}
      {...rest}
    />
  );
});
