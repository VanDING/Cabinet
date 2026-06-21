interface StatCardProps {
  label: string;
  value: string | number;
  color?: string;
  onClick?: () => void;
}

import { memo } from 'react';

// Dashboard stat card widget
export const StatCard = memo(function StatCard({
  label,
  value,
  color = 'text-accent',
  onClick,
}: StatCardProps) {
  return (
    <div
      onClick={onClick}
      className={`border-border bg-surface-primary flex h-full flex-col justify-center rounded-lg border p-4 shadow-xs ${onClick ? 'cursor-pointer' : ''}`}
    >
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-content-tertiary mt-1 text-sm">{label}</div>
    </div>
  );
});
