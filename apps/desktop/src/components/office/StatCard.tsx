interface StatCardProps {
  label: string;
  value: string | number;
  color?: string;
  onClick?: () => void;
}

import { memo } from 'react';

export const StatCard = memo(function StatCard({
  label,
  value,
  color = 'text-blue-600',
  onClick,
}: StatCardProps) {
  return (
    <div
      onClick={onClick}
      className={`flex h-full flex-col justify-center rounded-lg border bg-white p-4 ${onClick ? 'cursor-pointer transition-shadow hover:shadow-md' : ''}`}
    >
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="mt-1 text-sm text-gray-500">{label}</div>
    </div>
  );
});
