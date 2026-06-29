import { forwardRef } from 'react';
import { Button as ShadcnButton } from
  '../../../apps/desktop/src/components/ui/button.js';
import { cn } from './cn.js';

export interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'destructive' | 'ghost' | 'outline' | 'link' | 'default';
  size?: 'xs' | 'sm' | 'md' | 'default' | 'lg' | 'icon' | 'icon-xs' | 'icon-sm' | 'icon-lg';
  fullWidth?: boolean;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
  children?: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  type?: 'button' | 'submit' | 'reset';
}

const variantMap: Record<string, 'default' | 'secondary' | 'destructive' | 'ghost' | 'outline' | 'link'> = {
  primary: 'default',
  secondary: 'secondary',
  destructive: 'destructive',
  ghost: 'ghost',
  outline: 'outline',
  link: 'link',
  default: 'default',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'sm', fullWidth, loading, disabled, className, children, ...rest },
  ref,
) {
  const content = loading ? (
    <>
      <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
        <path d="M14 8a6 6 0 00-10.4-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      {children}
    </>
  ) : children;

  return (
    <ShadcnButton
      ref={ref}
      variant={variantMap[variant] ?? 'default'}
      size={size === 'md' ? 'default' : size as 'default' | 'xs' | 'sm' | 'lg' | 'icon' | 'icon-sm'}
      disabled={disabled || loading}
      className={cn(fullWidth && 'w-full', className)}
      {...(rest as any)}
    >
      {content}
    </ShadcnButton>
  );
});
