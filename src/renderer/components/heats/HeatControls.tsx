import React from 'react';
import { MAX_HEAT_COUNT } from '../../utils/heatView';

interface HeatsHeaderProps {
  /** Opens the export dialog (heat lists and scoring sheets). */
  onExport: () => void;
  noHeats: boolean;
  busy: boolean;
}

/** Section title plus the print/export controls that share its row. */
export function HeatsHeader({ onExport, noHeats, busy }: HeatsHeaderProps) {
  return (
    <div className="section-header-row">
      <h2>
        <i className="fa fa-flag" aria-hidden="true" />
        Heats
      </h2>
      <div className="list-header-actions">
        <button
          type="button"
          className="btn-ghost"
          onClick={onExport}
          disabled={noHeats || busy}
          title={noHeats ? 'Create the heats first' : undefined}
        >
          Export heats…
        </button>
      </div>
    </div>
  );
}

interface HeatSetupBarProps {
  /** Heats can still be created or recreated (nothing raced, no final series). */
  canSetUp: boolean;
  heatsCreated: boolean;
  numHeats: number;
  onNumHeatsChange: (count: number) => void;
  onCreateOrRecreate: () => void;
  busy: boolean;
  hasMultipleRounds: boolean;
  displayLastHeats: boolean;
  onToggleDisplayMode: () => void;
}

/** Number-of-heats choice, Create/Recreate, and the all-rounds toggle. */
export function HeatSetupBar({
  canSetUp,
  heatsCreated,
  numHeats,
  onNumHeatsChange,
  onCreateOrRecreate,
  busy,
  hasMultipleRounds,
  displayLastHeats,
  onToggleDisplayMode,
}: HeatSetupBarProps) {
  if (!canSetUp && !hasMultipleRounds) return null;
  return (
    <div className="heat-toolbar">
      {canSetUp && (
        <>
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
        </>
      )}
      {hasMultipleRounds && (
        <button
          type="button"
          className="btn-ghost"
          onClick={onToggleDisplayMode}
        >
          {displayLastHeats ? 'Show All Heats' : 'Show Last Heats'}
        </button>
      )}
    </div>
  );
}
