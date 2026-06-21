interface Props {
  title: string;
}

export function PlaceholderWidget({ title }: Props) {
  return (
    <div className="border-border bg-surface-primary flex h-full flex-col items-center justify-center rounded-lg border p-4 opacity-50 shadow-xs">
      <div className="mb-2 text-2xl">🔲</div>
      <div className="text-content-tertiary text-xs font-medium">{title}</div>
      <div className="text-content-tertiary mt-1 text-xs">Coming Soon</div>
    </div>
  );
}
