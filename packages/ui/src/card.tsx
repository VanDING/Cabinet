import { Card as ShadcnCard } from
  '../../../apps/desktop/src/components/ui/card.js';
import { cn } from './cn.js';

export interface CardProps {
  padding?: 'none' | 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
  hoverable?: boolean;
  as?: 'div' | 'section' | 'article';
}

const paddingMap: Record<string, string> = {
  none: 'p-0',
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
  const Element = Tag as 'div';
  return (
    <Element
      onClick={onClick}
      className={cn(onClick && 'cursor-pointer')}
    >
      <ShadcnCard
        className={cn(
          paddingMap[padding],
          hoverable && 'transition-shadow hover:shadow-sm',
          className,
        )}
      >
        {children}
      </ShadcnCard>
    </Element>
  );
}
