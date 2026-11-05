import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { ResultBar, SUCCESS_BAR_MS } from './ResultBar';
import { PendingButton } from './PendingButton';
import { KeypadField } from './KeypadField';
import { App } from '../App';

describe('ResultBar (REQ-089)', () => {
  it('REQ-089: the success bar disappears after 2 seconds', () => {
    vi.useFakeTimers();
    function Host() {
      const [msg, setMsg] = useState<{ kind: 'success'; text: string } | null>({ kind: 'success', text: 'KOT 12 sent' });
      return <ResultBar message={msg} onDismiss={() => setMsg(null)} />;
    }
    render(<Host />);
    expect(screen.getByRole('status')).toHaveTextContent('KOT 12 sent');
    act(() => vi.advanceTimersByTime(SUCCESS_BAR_MS - 1));
    expect(screen.queryByRole('status')).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('status')).toBeNull();
    vi.useRealTimers();
  });

  it('REQ-089: the error bar shows reason and next step until closed', () => {
    const onDismiss = vi.fn();
    render(<ResultBar message={{ kind: 'error', text: 'Not saved', nextStep: 'Try again' }} onDismiss={onDismiss} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Not saved');
    expect(screen.getByRole('alert')).toHaveTextContent('Try again');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onDismiss).toHaveBeenCalled();
  });
});

describe('PendingButton (REQ-089, REQ-118)', () => {
  it('REQ-118: stays disabled with a spinner while Send/Pay is pending', () => {
    const onClick = vi.fn();
    const { rerender } = render(<PendingButton pending onClick={onClick}>{'Pay'}</PendingButton>);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
    rerender(<PendingButton pending checking>{'Pay'}</PendingButton>);
    expect(btn).toHaveTextContent('Checking...');
    rerender(<PendingButton pending={false} onClick={onClick}>{'Pay'}</PendingButton>);
    expect(btn).toBeEnabled();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});

describe('KeypadField (REQ-087)', () => {
  it('REQ-087: tapping the cash tendered field opens the on-screen keypad, not the system keyboard', () => {
    function Host() {
      const [v, setV] = useState('');
      return <KeypadField label="Cash received" value={v} onChange={setV} />;
    }
    render(<Host />);
    const input = screen.getByLabelText('Cash received');
    expect(input).toHaveAttribute('inputmode', 'none');
    expect(input).toHaveAttribute('readonly');
    fireEvent.click(input);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    for (const k of ['5', '0', '0', '.', '5', '0', '9']) fireEvent.click(screen.getByRole('button', { name: k }));
    expect(input).toHaveValue('500.50');
    fireEvent.click(screen.getByRole('button', { name: 'Remove last digit' }));
    expect(input).toHaveValue('500.5');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('App shell (REQ-012)', () => {
  it('REQ-012: renders the login screen and switches its language', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Who is working?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'हिन्दी' }));
    expect(screen.getByRole('heading', { name: 'कौन काम कर रहा है?' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('hi');
  });
});
