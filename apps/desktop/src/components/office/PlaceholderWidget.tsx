interface Props {
  title: string;
}

export function PlaceholderWidget({ title }: Props) {
  return (
    <div className="flex h-full flex-col items-center justify-center rounded-lg border bg-surface-primary p-4 opacity-50">
      <div className="mb-2 text-2xl">🔲</div>
      <div className="text-xs font-medium text-content-tertiary">{title}</div>
      <div className="mt-1 text-xs text-content-tertiary">Coming Soon</div>
    </div>
  );
}
