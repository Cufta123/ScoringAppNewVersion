import React, { useState } from 'react';
import { reportWarning } from '../../utils/userFeedback';
import type { SailNumber } from '../../utils/finishOrder';

interface FinishPlaceInputProps {
  place: number;
  max: number;
  sail: SailNumber;
  onCommit: (newPlace: number) => void;
}

/**
 * Editable finishing-place field for a plain finisher: type a number and press
 * Enter (or blur) to move that boat directly to that place, instead of clicking
 * ↑/↓ one step at a time. Commits on blur/Enter so typing "12" doesn't reorder
 * on the intermediate "1".
 */
export default function FinishPlaceInput({
  place,
  max,
  sail,
  onCommit,
}: FinishPlaceInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? String(place);

  const commit = () => {
    const typed = draft?.trim() ?? '';
    setDraft(null);
    if (draft === null || typed === '' || typed === String(place)) return;
    // Never guess: 2.5, 0 or a place past the last boat would move the boat
    // somewhere the scorer did not ask for, so the order stays as it was.
    if (!/^\d+$/.test(typed)) {
      reportWarning(
        `"${typed}" is not a place. Type a whole number from 1 to ${max}.`,
        'Place not changed',
      );
      return;
    }
    const parsed = Number(typed);
    if (parsed < 1 || parsed > max) {
      reportWarning(
        `There are ${max} boats in the finish order, so the place must be 1 to ${max}. Sail ${sail} stays at place ${place}.`,
        'Place not changed',
      );
      return;
    }
    onCommit(parsed);
  };

  return (
    // A text field, not type="number": a number field changes on the mouse
    // wheel and the arrow keys, which moved boats by accident.
    <input
      className="finish-place-input"
      type="text"
      inputMode="numeric"
      autoComplete="off"
      maxLength={3}
      role="spinbutton"
      aria-valuemin={1}
      aria-valuemax={max}
      aria-valuenow={place}
      value={value}
      aria-label={`Finishing place for sail ${sail} (currently ${place})`}
      title={`Type a place from 1 to ${max} and press Enter to move this boat there`}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === 'Escape') {
          setDraft(null);
        }
      }}
    />
  );
}
