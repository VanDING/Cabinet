import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TitleBar } from '../components/TitleBar';

describe('TitleBar', () => {
  it('renders app title', () => {
    render(<TitleBar />);
    expect(screen.getByText('Cabinet')).toBeInTheDocument();
  });

  it('renders dark mode toggle button when onToggleTheme provided', () => {
    const toggle = vi.fn();
    render(<TitleBar onToggleTheme={toggle} />);
    const btn = screen.getByLabelText('Toggle theme');
    expect(btn).toBeInTheDocument();
  });

  it('calls onToggleTheme when theme button clicked', () => {
    const toggle = vi.fn();
    render(<TitleBar onToggleTheme={toggle} />);
    fireEvent.click(screen.getByLabelText('Toggle theme'));
    expect(toggle).toHaveBeenCalled();
  });

  it('shows moon icon in light mode (isDark=false)', () => {
    render(<TitleBar isDark={false} onToggleTheme={vi.fn()} />);
    const btn = screen.getByLabelText('Toggle theme');
    // lucide-react Moon icon has class "lucide-moon"
    expect(btn.innerHTML).toContain('lucide-moon');
  });

  it('shows sun icon in dark mode (isDark=true)', () => {
    render(<TitleBar isDark={true} onToggleTheme={vi.fn()} />);
    const btn = screen.getByLabelText('Toggle theme');
    expect(btn.innerHTML).toContain('lucide-sun');
  });

  it('hides window controls when Tauri not available (browser mode)', () => {
    render(<TitleBar />);
    expect(screen.queryByLabelText('Minimize')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Maximize')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Close')).not.toBeInTheDocument();
  });

  it('hides theme button when onToggleTheme not provided', () => {
    render(<TitleBar />);
    expect(screen.queryByLabelText('Toggle theme')).not.toBeInTheDocument();
  });
});
