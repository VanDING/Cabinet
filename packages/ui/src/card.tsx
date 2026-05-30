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
  md: 'p-4',
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
          'rounded-lg border border-border bg-surface-primary shadow-xs',
          paddingClasses[padding],
          onClick && 'cursor-pointer',
          hoverable && 'transition-shadow hover:shadow-xs',
          className,
        )}
      >
        {children}
      </Tag>
    </GlareHover>
  );
}
