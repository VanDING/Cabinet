import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TitleBar } from '../components/TitleBar';
import { NotificationProvider } from '../components/NotificationContext';

function renderTitleBar(props: React.ComponentProps<typeof TitleBar> = {}) {
  return render(
    <NotificationProvider>
      <TitleBar {...props} />
    </NotificationProvider>,
  );
}

describe('TitleBar', () => {
  it('renders app title', () => {
    renderTitleBar();
    expect(screen.getByText('Cabinet')).toBeInTheDocument();
  });

  it('renders dark mode toggle button when onToggleTheme provided', () => {
    const toggle = vi.fn();
    renderTitleBar({ onToggleTheme: toggle });
    expect(screen.getByLabelText('Toggle theme')).toBeInTheDocument();
  });

  it('calls onToggleTheme when theme button clicked', () => {
    const toggle = vi.fn();
    renderTitleBar({ onToggleTheme: toggle });
    fireEvent.click(screen.getByLabelText('Toggle theme'));
    expect(toggle).toHaveBeenCalled();
  });

  it('renders both sun and moon icons (visibility controlled by CSS dark mode)', () => {
    renderTitleBar({ onToggleTheme: vi.fn() });
    const btn = screen.getByLabelText('Toggle theme');
    const svgs = btn.querySelectorAll('svg');
    const classes = Array.from(svgs).map((s) => s.getAttribute('class'));
    expect(classes.some((c) => c?.includes('lucide-sun'))).toBe(true);
    expect(classes.some((c) => c?.includes('lucide-moon'))).toBe(true);
  });

  it('hides window controls when Tauri not available (browser mode)', () => {
    renderTitleBar();
    expect(screen.queryByLabelText('Minimize')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Maximize')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Close')).not.toBeInTheDocument();
  });

  it('theme button always rendered regardless of onToggleTheme prop', () => {
    // TitleBar always renders the theme button; onClick is simply undefined when not provided
    renderTitleBar();
    expect(screen.getByLabelText('Toggle theme')).toBeInTheDocument();
  });
});
