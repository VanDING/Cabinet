import type { NavPage } from '@cabinet/ui';
import { useTranslation } from 'react-i18next';

const navKeys = ['office', 'factory', 'staff', 'memory'] as const;
const navIds: NavPage[] = ['office', 'factory', 'employees', 'memory'];

interface Props {
  activePage: NavPage;
  onNavigate: (page: NavPage) => void;
}

export function MobileNav({ activePage, onNavigate }: Props) {
  const { t } = useTranslation();

  const items = navIds.map((id, i) => ({
    id,
    label: t(`nav.${navKeys[i]}`),
  }));

  return (
    <nav
      aria-label={t('nav.mobileNavLabel')}
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-gray-200 bg-white text-gray-800 md:hidden"
    >
      <div className="flex justify-around py-1">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            aria-label={item.label}
            aria-current={activePage === item.id ? 'page' : undefined}
            className={`flex flex-col items-center px-2 py-1.5 text-xs transition-colors ${
              activePage === item.id ? 'text-blue-400' : 'text-gray-400'
            }`}
          >
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
