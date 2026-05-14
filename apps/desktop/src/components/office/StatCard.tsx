interface StatCardProps {
  label: string;
  value: string | number;
  color?: string;
  onClick?: () => void;
}

export function StatCard({ label, value, color = 'text-blue-600', onClick }: StatCardProps) {
  return (
    <div
      onClick={onClick}
      className={`h-full bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg p-4 flex flex-col justify-center ${onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
    >
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">{label}</div>
    </div>
  );
}
