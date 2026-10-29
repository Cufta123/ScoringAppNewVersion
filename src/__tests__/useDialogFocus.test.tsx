/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import React, { useRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import useDialogFocus, {
  refocusIfLost,
} from '../renderer/hooks/useDialogFocus';

function Dialog({
  label,
  open = true,
  onClose,
  useInitial = false,
}: {
  label: string;
  open?: boolean;
  onClose: () => void;
  useInitial?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const lastRef = useRef<HTMLButtonElement>(null);
  useDialogFocus(ref, open, onClose, useInitial ? lastRef : undefined);
  if (!open) return null;
  return (
    <div ref={ref} role="dialog" aria-label={label} tabIndex={-1}>
      <button type="button">{label} first</button>
      <input aria-label={`${label} field`} />
      <button type="button" disabled>
        {label} disabled
      </button>
      <button ref={lastRef} type="button">
        {label} last
      </button>
    </div>
  );
}

const tab = (shiftKey = false) =>
  fireEvent.keyDown(document.activeElement ?? document.body, {
    key: 'Tab',
    shiftKey,
  });

describe('useDialogFocus', () => {
  it('moves focus to the first control, or to the one asked for', () => {
    const { rerender } = render(<Dialog label="A" onClose={jest.fn()} />);
    expect(screen.getByText('A first')).toHaveFocus();
    rerender(<Dialog label="A" open={false} onClose={jest.fn()} />);
    rerender(<Dialog label="A" onClose={jest.fn()} useInitial />);
    expect(screen.getByText('A last')).toHaveFocus();
  });

  it('traps Tab: from the last control to the first, Shift+Tab the other way', () => {
    render(<Dialog label="A" onClose={jest.fn()} />);
    screen.getByText('A last').focus();
    tab();
    expect(screen.getByText('A first')).toHaveFocus();
    tab(true);
    // The disabled button is skipped: the last reachable control is "last".
    expect(screen.getByText('A last')).toHaveFocus();
  });

  it('pulls focus back in when it was lost to the page body', () => {
    render(
      <>
        <button type="button">page</button>
        <Dialog label="A" onClose={jest.fn()} />
      </>,
    );
    (document.activeElement as HTMLElement).blur();
    expect(document.body).toHaveFocus();
    tab();
    expect(screen.getByText('A first')).toHaveFocus();
    (document.activeElement as HTMLElement).blur();
    tab(true);
    expect(screen.getByText('A last')).toHaveFocus();
  });

  it('calls onClose on Escape', () => {
    const onClose = jest.fn();
    render(<Dialog label="A" onClose={onClose} />);
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('gives focus back to the element that had it before, on close', () => {
    function Page({ open }: { open: boolean }) {
      return (
        <>
          <button type="button">opener</button>
          <Dialog label="A" open={open} onClose={jest.fn()} />
        </>
      );
    }
    const { rerender } = render(<Page open={false} />);
    screen.getByText('opener').focus();
    rerender(<Page open />);
    expect(screen.getByText('A first')).toHaveFocus();
    rerender(<Page open={false} />);
    expect(screen.getByText('opener')).toHaveFocus();
  });

  it('with two dialogs open, only the newest answers Escape and Tab', () => {
    const closeA = jest.fn();
    const closeB = jest.fn();
    render(
      <>
        <Dialog label="A" onClose={closeA} />
        <Dialog label="B" onClose={closeB} />
      </>,
    );
    expect(screen.getByText('B first')).toHaveFocus();
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(closeB).toHaveBeenCalledTimes(1);
    expect(closeA).not.toHaveBeenCalled();

    // Tab wraps inside B and never moves into A.
    screen.getByText('B last').focus();
    tab();
    expect(screen.getByText('B first')).toHaveFocus();
  });

  it('refocusIfLost moves focus into the dialog only when it was lost', () => {
    render(<Dialog label="A" onClose={jest.fn()} />);
    const dialog = screen.getByRole('dialog');
    screen.getByLabelText('A field').focus();
    refocusIfLost(dialog);
    expect(screen.getByLabelText('A field')).toHaveFocus();
    (document.activeElement as HTMLElement).blur();
    refocusIfLost(dialog);
    expect(dialog).toHaveFocus();
  });
});
