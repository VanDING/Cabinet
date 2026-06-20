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
        'border-border bg-surface-input text-content-primary placeholder:text-content-tertiary focus:ring-accent disabled:bg-surface-elevated rounded-md border px-3 py-2 text-sm transition-colors focus:ring-2 focus:outline-hidden',
        fullWidth !== false && 'w-full',
        className,
      )}
      {...rest}
    />
  );
});
