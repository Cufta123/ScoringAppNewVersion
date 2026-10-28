import React from 'react';
import {
  FINISH_ENTRY_PENALTY_CODES,
  penaltyLabel,
} from '../../constants/penaltyLabels';
import type { ScoringBoat } from '../../hooks/useScoringInput';
import type { SailNumber } from '../../utils/finishOrder';

// Plain-language labels so non-expert scorers know what each code means.
// Sourced from the shared penaltyLabels module so entry and leaderboard-edit
// stay in sync.
const PENALTY_OPTIONS = FINISH_ENTRY_PENALTY_CODES.map((value) => ({
  value,
  label: penaltyLabel(value),
}));

interface BoatPickerPanelProps {
  heatName: string;
  boats: ScoringBoat[];
  entryKeyOf: (boat: ScoringBoat) => string;
  /** The finish order, to show who is already in it. */
  boatNumbers: SailNumber[];
  penalties: Record<string, string>;
  getPlaceDisplay: (sail: SailNumber) => string;
  isInvalidSail: (sail: SailNumber) => boolean;
  fetchError: string | null;
  onRetry: () => void;
  onBoatClick: (sail: SailNumber) => void;
  onPenaltyChange: (sail: SailNumber, penalty: string) => void;
}

/** Left panel: the heat's boats; click one or pick a penalty to score it. */
export default function BoatPickerPanel({
  heatName,
  boats,
  entryKeyOf,
  boatNumbers,
  penalties,
  getPlaceDisplay,
  isInvalidSail,
  fetchError,
  onRetry,
  onBoatClick,
  onPenaltyChange,
}: BoatPickerPanelProps) {
  const added = new Set(boatNumbers.map(String));
  return (
    <div className="scoring-panel">
      <h2 className="scoring-panel-title">{heatName} — Boats</h2>
      {fetchError && (
        <div role="alert" className="fetch-error-banner">
          <p>Could not load boats: {fetchError}</p>
          <button type="button" className="btn-ghost" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}
      {!fetchError && (
        <>
          <p className="scoring-hint">
            Click a row or select a penalty to include the boat in scoring
          </p>
          <div className="scoring-table-wrap">
            <table className="scoring-table">
              <thead>
                <tr>
                  <th scope="col">Sailor</th>
                  <th scope="col">Country</th>
                  <th scope="col">Sail #</th>
                  <th scope="col" className="scoring-place-cell">
                    Place
                  </th>
                  <th scope="col">Penalty</th>
                </tr>
              </thead>
              <tbody>
                {boats.map((boat) => {
                  // The name this boat is entered by: her sail number, or
                  // "ITA 12" when another boat in the heat is also 12.
                  const key = entryKeyOf(boat);
                  const isAdded = added.has(key);
                  const invalid = isInvalidSail(key);
                  return (
                    <tr
                      key={boat.boat_id}
                      onClick={() => onBoatClick(key)}
                      className={`${isAdded ? 'is-added' : ''}${invalid ? ' is-invalid' : ''}`}
                      title={
                        isAdded
                          ? `Already added at place ${getPlaceDisplay(key)}`
                          : 'Click to add to finish order'
                      }
                    >
                      <td>
                        {boat.name} {boat.surname}
                        {/* Always rendered (hidden until added) so adding the
                          check never reflows the row. */}
                        <span
                          className={`scoring-added-check${isAdded ? '' : ' is-placeholder'}`}
                          aria-hidden={!isAdded}
                        >
                          ✓
                        </span>
                      </td>
                      <td>{boat.country}</td>
                      <td className="scoring-sail-cell">{boat.sail_number}</td>
                      <td
                        className={`scoring-place-cell${isAdded ? ' is-added' : ''}`}
                      >
                        {getPlaceDisplay(key)}
                      </td>
                      <td>
                        <select
                          className="penalty-select"
                          value={penalties[key] || ''}
                          onChange={(e) => onPenaltyChange(key, e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Penalty for sail ${key}`}
                        >
                          <option value="">None</option>
                          {PENALTY_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
