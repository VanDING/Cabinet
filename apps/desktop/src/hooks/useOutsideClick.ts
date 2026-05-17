import { useEffect } from 'react';

export function useOutsideClick(
  ref: { readonly current: HTMLElement | null },
  callback: () => void,
  enabled: boolean = true,
): void {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) callback();
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [enabled, ref, callback]);
}
