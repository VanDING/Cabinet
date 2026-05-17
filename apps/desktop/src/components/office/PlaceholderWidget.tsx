interface Props {
  title: string;
}

export function PlaceholderWidget({ title }: Props) {
  return (
    <div className="flex h-full flex-col items-center justify-center rounded-lg border bg-white p-4 opacity-50 dark:border-gray-600 dark:bg-gray-800">
      <div className="mb-2 text-2xl">🔲</div>
      <div className="text-xs font-medium text-gray-400">{title}</div>
      <div className="mt-1 text-xs text-gray-400">Coming Soon</div>
    </div>
  );
}
