import { cn } from './cn.js';
import { GlareHover } from './animations/GlareHover';

type CardPadding = 'none' | 'xs' | 'sm' | 'md' | 'lg';

export interface CardProps {
  padding?: CardPadding;
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
  hoverable?: boolean;
  as?: 'div' | 'section' | 'article';
}

const paddingClasses: Record<CardPadding, string> = {
  none: '',
  xs: 'p-2',
  sm: 'p-3',
  md: 'p-5',
  lg: 'p-6',
};

export function Card({
  padding = 'md',
  className,
  children,
  onClick,
  hoverable,
  as: Tag = 'div',
}: CardProps) {
  return (
    <GlareHover className="rounded-lg" maxOpacity={0.03}>
      <Tag
        onClick={onClick}
        className={cn(
          'border-border bg-surface-primary rounded-xl border shadow-xs',
          paddingClasses[padding],
          onClick && 'cursor-pointer',
          hoverable && 'transition-shadow hover:shadow-sm',
          className,
        )}
      >
        {children}
      </Tag>
    </GlareHover>
  );
}
