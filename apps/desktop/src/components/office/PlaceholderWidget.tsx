interface Props {
  title: string;
}

export function PlaceholderWidget({ title }: Props) {
  return (
    <div className="h-full bg-white dark:bg-gray-800 border dark:border-gray-600 rounded-lg p-4 flex flex-col items-center justify-center opacity-50">
      <div className="text-2xl mb-2">🔲</div>
      <div className="text-xs font-medium text-gray-400">{title}</div>
      <div className="text-xs text-gray-400 mt-1">Coming Soon</div>
    </div>
  );
}
