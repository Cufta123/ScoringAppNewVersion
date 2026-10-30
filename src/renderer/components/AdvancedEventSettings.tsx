import React from 'react';
import type { DiscardSeries, EventSettings } from '../hooks/useEventSettings';
import {
  getDiscardExamples,
  getDiscardSummary,
} from '../utils/discardProfileForm';

/**
 * The advanced SHRS options panel, shared by the create form and the inline
 * edit form. Both rendered their own copy of these four controls, which is why
 * option labels like "Never discard" appeared four times in one file.
 *
 * Ids are prefixed per instance because the edit form renders one panel per
 * event row, and duplicate ids would break label association.
 */

interface DiscardFieldProps {
  id: string;
  label: string;
  series: DiscardSeries;
  /** Shown when the profile is locked; names the race that closed it. */
  lockedNote: string;
}

function DiscardField({ id, label, series, lockedNote }: DiscardFieldProps) {
  return (
    <div>
      <label htmlFor={id}>
        {label}
        <select
          id={id}
          value={series.mode}
          disabled={series.locked}
          onChange={(e) => series.setMode(e.target.value)}
        >
          <option value="standard">Standard SHRS 5.4</option>
          <option value="custom">Custom thresholds list</option>
          <option value="never">Never discard</option>
        </select>
        {series.mode === 'custom' && (
          <input
            type="text"
            disabled={series.locked}
            value={series.input}
            onChange={(e) => series.setInput(e.target.value)}
            placeholder="e.g. 4,8,16,24"
            title="Enter comma-separated thresholds"
          />
        )}
        {series.error && <small className="form-error">{series.error}</small>}
        <small className="form-note">
          {getDiscardSummary(series.mode, series.input)}
        </small>
        <small className="form-note">
          {getDiscardExamples(series.mode, series.input)}
        </small>
        {series.locked && (
          <small className="form-locked-note">{lockedNote}</small>
        )}
      </label>
    </div>
  );
}

interface AdvancedEventSettingsProps {
  idPrefix: string;
  settings: EventSettings;
}

export default function AdvancedEventSettings({
  idPrefix,
  settings,
}: AdvancedEventSettingsProps) {
  if (!settings.advancedEnabled) return null;

  return (
    <div className="form-grid-2">
      <div>
        <label htmlFor={`${idPrefix}-assignment`}>
          Qualifying Assignment Mode
          <select
            id={`${idPrefix}-assignment`}
            value={settings.assignmentMode}
            disabled={settings.assignmentLocked}
            onChange={(e) => settings.setAssignmentMode(e.target.value)}
          >
            <option value="progressive">Progressive Assignment (3.1)</option>
            <option value="pre-assigned">Pre-Assignments (3.2)</option>
          </select>
          <small className="form-note">
            {settings.assignmentMode === 'pre-assigned'
              ? 'Boats keep the heat they get for the first race for the whole qualifying series. Use the method the Notice of Race states.'
              : 'Race 1 is seeded 1, 2, 3 … 3, 2, 1; after that boats move by the Heat Movement Table. Use the method the Notice of Race states.'}
          </small>
          {settings.assignmentLocked && (
            <small className="form-locked-note">
              Locked: the qualifying series has started with this method.
            </small>
          )}
        </label>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-overflow`}>
          Final fleets over 20 boats
          <select
            id={`${idPrefix}-overflow`}
            value={settings.heatOverflowPolicy}
            disabled={settings.overflowLocked}
            onChange={(e) => settings.setHeatOverflowPolicy(e.target.value)}
          >
            <option value="auto-increase">Add a fleet (max 20 each)</option>
            <option value="confirm-allow-oversize">
              Ask, allow over 20 if confirmed
            </option>
          </select>
          <small className="form-note">
            Used only when the Final Series is split (SHRS 2.3: at most 20 boats
            a fleet). There are as many fleets as qualifying heats (4.1), so a
            fleet can only pass 20 boats when boats were entered after the heats
            were made. Qualifying heats are always kept at 20 or fewer.
          </small>
          {settings.overflowLocked && (
            <small className="form-locked-note">
              Locked: the Final Series has already been split into fleets.
            </small>
          )}
        </label>
      </div>
      <DiscardField
        id={`${idPrefix}-qual-discard`}
        label="Qualifying Discards"
        series={settings.qualifying}
        lockedNote="Locked after first qualifying race."
      />
      <DiscardField
        id={`${idPrefix}-final-discard`}
        label="Finals Discards"
        series={settings.final}
        lockedNote="Locked after first final race."
      />
    </div>
  );
}
