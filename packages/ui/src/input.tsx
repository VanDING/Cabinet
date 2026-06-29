import { Input as ShadcnInput } from
  '../../../apps/desktop/src/components/ui/input.js';
import { cn } from './cn.js';

export interface InputProps {
  fullWidth?: boolean;
  className?: string;
  placeholder?: string;
  value?: string | number | readonly string[];
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  disabled?: boolean;
  autoFocus?: boolean;
  type?: string;
}

export function Input({ fullWidth = true, className, ...rest }: InputProps) {
  return (
    <ShadcnInput
      className={cn(!fullWidth && 'w-auto', className)}
      {...(rest as any)}
    />
  );
}
