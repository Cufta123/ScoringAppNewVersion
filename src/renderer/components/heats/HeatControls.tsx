import React from 'react';
import { MAX_HEAT_COUNT } from '../../utils/heatView';
import FormatSelect from '../shared/FormatSelect';
import type { ExportFormat } from '../shared/FormatSelect';

export type NewHeatsFormat = ExportFormat;

interface HeatsHeaderProps {
  format: NewHeatsFormat;
  onFormatChange: (format: NewHeatsFormat) => void;
  onPrint: () => void;
  noHeats: boolean;
  isFinalSeriesView: boolean;
  busy: boolean;
}

/** Section title plus the print/export controls that share its row. */
export function HeatsHeader({
  format,
  onFormatChange,
  onPrint,
  noHeats,
  isFinalSeriesView,
  busy,
}: HeatsHeaderProps) {
  return (
    <div className="section-header-row">
      <h2>
        <i className="fa fa-flag" aria-hidden="true" />
        Heats
      </h2>
      <div className="list-header-actions">
        <FormatSelect
          ariaLabel="New heats format"
          value={format}
          onChange={onFormatChange}
        />
        <button
          type="button"
          className="btn-ghost"
          onClick={onPrint}
          disabled={noHeats || busy}
          title={noHeats ? 'Create the heats first' : undefined}
        >
          {isFinalSeriesView ? 'Print Final Series Heats' : 'Print New Heats'}
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
