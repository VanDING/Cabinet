import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ToastProvider, useToast } from '../components/Toast';

// Helper component to trigger toasts from within the provider
function ToastTrigger({
  type,
  message,
}: {
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
}) {
  const { addToast } = useToast();
  return <button onClick={() => addToast(type, message)}>Add Toast</button>;
}

function renderWithToast(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a toast when addToast is called', () => {
    renderWithToast(<ToastTrigger type="success" message="Operation complete!" />);
    fireEvent.click(screen.getByText('Add Toast'));
    expect(screen.getByText('Operation complete!')).toBeInTheDocument();
  });

  it('renders toast with role="status" container', () => {
    renderWithToast(<ToastTrigger type="info" message="Info message" />);
    fireEvent.click(screen.getByText('Add Toast'));
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('auto-dismisses toast after 4 seconds', () => {
    renderWithToast(<ToastTrigger type="error" message="Error occurred" />);
    fireEvent.click(screen.getByText('Add Toast'));
    expect(screen.getByText('Error occurred')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByText('Error occurred')).not.toBeInTheDocument();
  });

  it('manually closes toast on close button click', () => {
    renderWithToast(<ToastTrigger type="warning" message="Warning!" />);
    fireEvent.click(screen.getByText('Add Toast'));
    expect(screen.getByText('Warning!')).toBeInTheDocument();

    const closeBtn = screen.getByText('×');
    fireEvent.click(closeBtn);
    expect(screen.queryByText('Warning!')).not.toBeInTheDocument();
  });

  it('renders multiple toasts simultaneously', () => {
    renderWithToast(
      <div>
        <ToastTrigger type="success" message="First" />
        <ToastTrigger type="error" message="Second" />
      </div>,
    );
    // Trigger both
    const buttons = screen.getAllByText('Add Toast');
    fireEvent.click(buttons[0]!);
    fireEvent.click(buttons[1]!);

    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
  });

  it('applies green background for success', () => {
    renderWithToast(<ToastTrigger type="success" message="OK" />);
    fireEvent.click(screen.getByText('Add Toast'));
    const toastEl = screen.getByText('OK').closest('.bg-green-700');
    expect(toastEl).toBeTruthy();
  });

  it('applies red background for error', () => {
    renderWithToast(<ToastTrigger type="error" message="Fail" />);
    fireEvent.click(screen.getByText('Add Toast'));
    const toastEl = screen.getByText('Fail').closest('.bg-red-700');
    expect(toastEl).toBeTruthy();
  });

  it('applies amber background for warning', () => {
    renderWithToast(<ToastTrigger type="warning" message="Warn" />);
    fireEvent.click(screen.getByText('Add Toast'));
    const toastEl = screen.getByText('Warn').closest('.bg-amber-700');
    expect(toastEl).toBeTruthy();
  });
});
