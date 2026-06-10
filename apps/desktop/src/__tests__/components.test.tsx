import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { StatCard } from '../components/office/StatCard';
import { MobileNav } from '../components/MobileNav';

describe('ErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <p>Hello world</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders fallback UI when child throws', () => {
    const Exploder = () => {
      throw new Error('boom');
    };
    render(
      <ErrorBoundary>
        <Exploder />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('reset button clears error state', async () => {
    let shouldExplode = true;
    const Exploder = () => {
      if (shouldExplode) throw new Error('boom');
      return <p>Recovered</p>;
    };
    const { rerender } = render(
      <ErrorBoundary>
        <Exploder />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    shouldExplode = false;
    screen.getByText('Try again').click();

    rerender(
      <ErrorBoundary>
        <Exploder />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Recovered')).toBeInTheDocument();
  });
});

describe('StatCard', () => {
  it('renders label and value', () => {
    render(<StatCard label="Active Sessions" value={42} />);
    expect(screen.getByText('Active Sessions')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders with custom color', () => {
    render(<StatCard label="Cost" value="$5.00" color="text-green-600" />);
    const value = screen.getByText('$5.00');
    expect(value.className).toContain('text-green-600');
  });
});

describe('MobileNav', () => {
  it('renders all nav items', () => {
    render(<MobileNav activePage="office" onNavigate={() => {}} />);
    expect(screen.getByText('Office')).toBeInTheDocument();
    expect(screen.getByText('Workflows')).toBeInTheDocument();
    expect(screen.getByText('Staff')).toBeInTheDocument();
    expect(screen.getByText('Memory')).toBeInTheDocument();
  });

  it('marks active page with aria-current', () => {
    render(<MobileNav activePage="workflows" onNavigate={() => {}} />);
    const officeBtn = screen.getByLabelText('Office');
    const workflowsBtn = screen.getByLabelText('Workflows');
    expect(officeBtn).not.toHaveAttribute('aria-current');
    expect(workflowsBtn).toHaveAttribute('aria-current', 'page');
  });

  it('calls onNavigate when a nav item is clicked', () => {
    let navigatedTo = '';
    render(<MobileNav activePage="office" onNavigate={(page) => (navigatedTo = page)} />);
    screen.getByLabelText('Memory').click();
    expect(navigatedTo).toBe('memory');
  });
});
