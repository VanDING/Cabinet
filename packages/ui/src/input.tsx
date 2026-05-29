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
        'rounded-lg border bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition-colors focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-500 dark:disabled:bg-gray-800',
        fullWidth !== false && 'w-full',
        className,
      )}
      {...rest}
    />
  );
});
