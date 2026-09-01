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
            onChange={(e) => settings.setAssignmentMode(e.target.value)}
          >
            <option value="progressive">Progressive Assignment</option>
            <option value="pre-assigned">Pre-Assignments</option>
          </select>
        </label>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-overflow`}>
          Heat Overflow Policy
          <select
            id={`${idPrefix}-overflow`}
            value={settings.heatOverflowPolicy}
            onChange={(e) => settings.setHeatOverflowPolicy(e.target.value)}
          >
            <option value="auto-increase">Auto-increase number of heats</option>
            <option value="confirm-allow-oversize">
              Allow oversize only after confirm
            </option>
          </select>
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
