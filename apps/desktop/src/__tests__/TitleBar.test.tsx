import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TitleBar } from '../components/TitleBar';
import { NotificationProvider } from '../components/NotificationContext';

function renderTitleBar(props: Partial<React.ComponentProps<typeof TitleBar>> = {}) {
  return render(
    <NotificationProvider>
      <TitleBar
        themes={[
          { id: 'light', name: 'Light' },
          { id: 'dark', name: 'Dark' },
        ]}
        currentTheme="light"
        {...props}
      />
    </NotificationProvider>,
  );
}

describe('TitleBar', () => {
  it('renders app title', () => {
    renderTitleBar();
    expect(screen.getByText('Cabinet')).toBeInTheDocument();
  });

  it('renders theme selector button', () => {
    renderTitleBar();
    expect(screen.getByLabelText('Select theme')).toBeInTheDocument();
  });

  it('opens theme dropdown on button click', () => {
    renderTitleBar();
    fireEvent.click(screen.getByLabelText('Select theme'));
    // Theme dropdown shows theme names
    expect(screen.getByText('Light')).toBeInTheDocument();
    expect(screen.getByText('Dark')).toBeInTheDocument();
  });

  it('calls onSetTheme when a theme is selected', () => {
    const setTheme = vi.fn();
    renderTitleBar({ onSetTheme: setTheme });
    fireEvent.click(screen.getByLabelText('Select theme'));
    fireEvent.click(screen.getByText('Dark'));
    expect(setTheme).toHaveBeenCalledWith('dark');
  });

  it('highlights current theme in dropdown', () => {
    renderTitleBar({ currentTheme: 'dark' });
    fireEvent.click(screen.getByLabelText('Select theme'));
    const darkOption = screen.getByText('Dark');
    expect(darkOption.className).toContain('font-semibold');
  });

  it('hides window controls when Tauri not available (browser mode)', () => {
    renderTitleBar();
    expect(screen.queryByLabelText('Minimize')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Maximize')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Close')).not.toBeInTheDocument();
  });

  it('theme button always rendered', () => {
    renderTitleBar();
    expect(screen.getByLabelText('Select theme')).toBeInTheDocument();
  });
});
