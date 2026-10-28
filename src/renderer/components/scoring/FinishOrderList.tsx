import React, { useState } from 'react';
import FinishPlaceInput from './FinishPlaceInput';
import { POSITION_KEEPING_PENALTIES } from '../../utils/penaltyOrder';
import { formatPlaceDisplay } from '../../utils/finishEntry';
import { tieKey } from '../../utils/finishOrder';
import type { SailNumber } from '../../utils/finishOrder';
import type { ScoringBoat } from '../../hooks/useScoringInput';

function tieButtonTitle(
  index: number,
  isDisplacing: boolean,
  isTied: boolean,
): string {
  if (index === 0) return 'The first boat cannot be tied with a boat above';
  if (isDisplacing) return 'Penalised boats are not tied at the finishing line';
  if (isTied) return 'Untie from the boat above (RRS A7 dead heat)';
  return 'Tie with the boat above (RRS A7 dead heat)';
}

interface FinishOrderListProps {
  boatNumbers: SailNumber[];
  penalties: Record<string, string>;
  ties: Set<string>;
  placeNumbers: Record<string, number>;
  boatByKey: Map<string, ScoringBoat>;
  isInvalidSail: (sail: SailNumber) => boolean;
  onMove: (fromIndex: number, toIndex: number) => void;
  onToggleTie: (sail: SailNumber, index: number) => void;
  onRemove: (index: number) => void;
}

/**
 * The ranked finish order: type a place, drag, or use the arrows; "=" marks an
 * RRS A7 dead heat with the boat above. The drag position changes on every
 * dragover, so it lives here rather than redrawing the whole scoring screen.
 */
export default function FinishOrderList({
  boatNumbers,
  penalties,
  ties,
  placeNumbers,
  boatByKey,
  isInvalidSail,
  onMove,
  onToggleTie,
  onRemove,
}: FinishOrderListProps) {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const handleDragOver =
    (index: number) => (e: React.DragEvent<HTMLLIElement>) => {
      e.preventDefault();
      // The <ul> also has an onDragOver for the tail zone (drop after the last
      // item). Without stopping propagation, that handler fires after this one
      // and overwrites dropIndex with boatNumbers.length, so every drop lands at
      // the end and the per-item indicator never shows.
      e.stopPropagation();
      setDropIndex(index);
    };

  const handleDrop = () => {
    if (draggingIndex !== null && dropIndex !== null) {
      onMove(draggingIndex, dropIndex);
    }
    setDraggingIndex(null);
    setDropIndex(null);
  };

  const handleDragEnd = () => {
    setDraggingIndex(null);
    setDropIndex(null);
  };

  return (
    <ul
      className="finish-list"
      onDragOver={(e) => {
        e.preventDefault();
        // Allow dropping at the very end of the list (after the last item).
        setDropIndex(boatNumbers.length);
      }}
    >
      {boatNumbers.map((number, index) => {
        const boat = boatByKey.get(String(number));
        const name = boat
          ? `${boat.name ?? ''} ${boat.surname ?? ''}`.trim()
          : '';
        const invalid = isInvalidSail(number);
        const penalty = penalties[number];
        const isDisplacing = Boolean(
          penalty && !POSITION_KEEPING_PENALTIES.has(penalty),
        );
        const isTied =
          index > 0 && ties.has(tieKey(number, boatNumbers[index - 1]));
        return (
          <React.Fragment key={number}>
            {dropIndex === index && <div className="drop-indicator" />}
            <li
              data-invalid={invalid}
              className={`finish-item${invalid ? ' is-invalid' : ''}`}
              draggable
              onDragStart={() => setDraggingIndex(index)}
              onDragOver={handleDragOver(index)}
              onDragEnd={handleDragEnd}
              onDrop={handleDrop}
            >
              {penalty ? (
                <span className="finish-place">
                  {formatPlaceDisplay(placeNumbers[number], penalty, {
                    sep: ' ',
                    placeSuffix: '.',
                  })}
                </span>
              ) : (
                <FinishPlaceInput
                  place={placeNumbers[number]}
                  max={boatNumbers.length}
                  sail={number}
                  onCommit={(newPlace) =>
                    onMove(
                      index,
                      Math.min(Math.max(newPlace, 1), boatNumbers.length) - 1,
                    )
                  }
                />
              )}
              <span className="finish-label">
                <span className="finish-sail">Sail #{number}</span>
                {name ? <span className="finish-name">{name}</span> : null}
                {invalid && (
                  <span className="finish-not-in-heat">Not in this heat</span>
                )}
              </span>
              <button
                type="button"
                className="finish-move-btn"
                aria-label={`Move sail ${number} up`}
                onClick={() => onMove(index, index - 1)}
                disabled={index === 0 || isDisplacing}
                title={
                  isDisplacing
                    ? `Boats with ${penalty} stay at the end of the finish order (SHRS 5.3)`
                    : 'Move up'
                }
              >
                ↑
              </button>
              <button
                type="button"
                className="finish-move-btn"
                aria-label={`Move sail ${number} down`}
                onClick={() => onMove(index, index + 1)}
                disabled={index === boatNumbers.length - 1 || isDisplacing}
                title={
                  isDisplacing
                    ? `Boats with ${penalty} stay at the end of the finish order (SHRS 5.3)`
                    : 'Move down'
                }
              >
                ↓
              </button>
              <button
                type="button"
                className={`finish-tie-btn${isTied ? ' is-tied' : ''}`}
                aria-label={`Sail ${number} tied with the boat above`}
                aria-pressed={isTied}
                onClick={() => onToggleTie(number, index)}
                disabled={index === 0 || isDisplacing}
                title={tieButtonTitle(index, isDisplacing, isTied)}
              >
                =
              </button>
              <button
                type="button"
                className="finish-remove-btn"
                onClick={() => onRemove(index)}
                aria-label={`Remove sail ${number} from finish order`}
                title="Remove"
              >
                ✕
              </button>
            </li>
          </React.Fragment>
        );
      })}
      {dropIndex === boatNumbers.length && <div className="drop-indicator" />}
    </ul>
  );
}
