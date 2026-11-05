import React from 'react';
import { MAX_HEAT_COUNT } from '../../utils/heatView';

interface HeatSetupBarProps {
  /** Heats can still be created or recreated (nothing raced, no final series). */
  canSetUp: boolean;
  heatsCreated: boolean;
  numHeats: number;
  /** Shown when more heats are chosen than the entry list needs (SHRS 2.1). */
  extraHeatsNote?: string | null;
  onNumHeatsChange: (count: number) => void;
  onCreateOrRecreate: () => void;
  busy: boolean;
}

/** Number-of-heats choice and Create/Recreate, while heats can be set up. */
export default function HeatSetupBar({
  canSetUp,
  heatsCreated,
  numHeats,
  extraHeatsNote = null,
  onNumHeatsChange,
  onCreateOrRecreate,
  busy,
}: HeatSetupBarProps) {
  if (!canSetUp) return null;
  return (
    <div className="heat-toolbar">
      <label htmlFor="numHeats" className="heat-count-label">
        Number of heats
        <select
          id="numHeats"
          value={numHeats}
          onChange={(e) => onNumHeatsChange(Number(e.target.value))}
        >
          {/* Match the backend's 1–26 heat limit (createInitialHeatsAtomic)
                  so an event of up to 26×20=520 boats can be split without
                  hitting a UI dead-end (RULE-M24). */}
          {Array.from({ length: MAX_HEAT_COUNT }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              {i + 1}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={onCreateOrRecreate} disabled={busy}>
        {heatsCreated ? 'Recreate Heats' : 'Create Heats'}
      </button>
      {extraHeatsNote && (
        <p className="heat-count-warning" role="status">
          <i className="fa fa-triangle-exclamation" aria-hidden="true" />{' '}
          {extraHeatsNote}
        </p>
      )}
    </div>
  );
}
