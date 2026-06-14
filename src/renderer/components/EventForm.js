import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';
import { confirmAction, reportError, reportInfo } from '../utils/userFeedback';

const DEFAULT_DISCARD_CONFIG = {
  firstDiscardAt: 4,
  secondDiscardAt: 8,
  additionalEvery: 8,
};

const DEFAULT_THRESHOLD_PREVIEW = '4,8,16,24';

const clampPositiveInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.trunc(parsed);
  return rounded > 0 ? rounded : fallback;
};

const normalizeDiscardConfig = (raw) => {
  const firstDiscardAt = clampPositiveInt(
    raw?.firstDiscardAt,
    DEFAULT_DISCARD_CONFIG.firstDiscardAt,
  );
  const secondDiscardAt = clampPositiveInt(
    raw?.secondDiscardAt,
    DEFAULT_DISCARD_CONFIG.secondDiscardAt,
  );
  const additionalEvery = clampPositiveInt(
    raw?.additionalEvery,
    DEFAULT_DISCARD_CONFIG.additionalEvery,
  );

  return {
    firstDiscardAt,
    secondDiscardAt:
      secondDiscardAt > firstDiscardAt
        ? secondDiscardAt
        : firstDiscardAt + additionalEvery,
    additionalEvery,
  };
};

const toLegacyThresholdPreview = (config) => {
  const normalized = normalizeDiscardConfig(config);
  return [
    normalized.firstDiscardAt,
    normalized.secondDiscardAt,
    normalized.secondDiscardAt + normalized.additionalEvery,
    normalized.secondDiscardAt + normalized.additionalEvery * 2,
  ].join(',');
};

const parseThresholdInput = (input) => {
  const cleaned = String(input ?? '').trim();
  if (!cleaned) {
    return {
      thresholds: [],
      error: 'Enter at least one threshold (e.g. 4,8,16).',
    };
  }

  const parts = cleaned
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (parts.length === 0) {
    return {
      thresholds: [],
      error: 'Enter at least one threshold (e.g. 4,8,16).',
    };
  }

  const thresholds = parts.map((entry) => Number(entry));
  if (thresholds.some((value) => !Number.isInteger(value) || value <= 0)) {
    return {
      thresholds: [],
      error: 'Thresholds must be positive whole numbers.',
    };
  }

  for (let index = 1; index < thresholds.length; index += 1) {
    if (thresholds[index] <= thresholds[index - 1]) {
      return {
        thresholds: [],
        error: 'Thresholds must be in strictly increasing order.',
      };
    }
  }

  return { thresholds, error: null };
};

const parseDiscardModeAndConfig = (raw) => {
  if (!raw || raw === 'standard') {
    return {
      mode: 'standard',
      thresholdsInput: DEFAULT_THRESHOLD_PREVIEW,
    };
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.thresholds)) {
      return {
        mode: 'custom',
        thresholdsInput: parsed.thresholds.join(','),
      };
    }

    return {
      mode: 'custom',
      thresholdsInput: toLegacyThresholdPreview(parsed),
    };
  } catch (_error) {
    return {
      mode: 'standard',
      thresholdsInput: DEFAULT_THRESHOLD_PREVIEW,
    };
  }
};

const serializeDiscardProfile = (mode, thresholdsInput) => {
  if (mode === 'standard') return 'standard';
  const { thresholds, error } = parseThresholdInput(thresholdsInput);
  if (error) {
    throw new Error(error);
  }
  return JSON.stringify({ thresholds });
};

const getDiscardSummary = (mode, thresholdsInput) => {
  if (mode === 'standard') {
    return 'Standard SHRS 5.4 is active: after 4 races exclude 1, after 8 exclude 2, then +1 every 8 races.';
  }

  const { thresholds, error } = parseThresholdInput(thresholdsInput);
  if (error) return error;
  return `Custom list active. Exclusions increase by 1 at each threshold: ${thresholds.join(', ')}.`;
};

const getDiscardExamples = (mode, thresholdsInput) => {
  if (mode === 'standard') {
    return 'Examples: 4 races = 1 discard | 8 races = 2 discards | 16 races = 3 discards | 24 races = 4 discards';
  }

  const { thresholds, error } = parseThresholdInput(thresholdsInput);
  if (error) return '';

  const sampleRaceCounts = thresholds.slice(0, 4);
  if (sampleRaceCounts.length === 0) return '';

  return sampleRaceCounts
    .map((raceCount) => {
      const discardCount = thresholds.filter(
        (threshold) => raceCount >= threshold,
      ).length;
      return `${raceCount} races = ${discardCount} discard${discardCount === 1 ? '' : 's'}`;
    })
    .join(' | ');
};

const getAssignmentLabel = (event) =>
  event.shrs_qualifying_assignment_mode === 'pre-assigned'
    ? 'Pre-Assignments'
    : 'Progressive';

const getOverflowPolicyLabel = (event) =>
  event.shrs_heat_overflow_policy === 'confirm-allow-oversize'
    ? 'Oversize with confirm'
    : 'Auto-increase heats';

function EventForm({ onEventCreated }) {
  const [eventName, setEventName] = useState('');
  const [eventLocation, setEventLocation] = useState('');
  const [eventStartDate, setEventStartDate] = useState('');
  const [eventEndDate, setEventEndDate] = useState('');
  const [advancedEnabled, setAdvancedEnabled] = useState(false);
  const [assignmentMode, setAssignmentMode] = useState('progressive');
  const [qualifyingDiscardMode, setQualifyingDiscardMode] =
    useState('standard');
  const [qualifyingDiscardInput, setQualifyingDiscardInput] = useState(
    DEFAULT_THRESHOLD_PREVIEW,
  );
  const [qualifyingDiscardError, setQualifyingDiscardError] = useState('');
  const [finalDiscardMode, setFinalDiscardMode] = useState('standard');
  const [finalDiscardInput, setFinalDiscardInput] = useState(
    DEFAULT_THRESHOLD_PREVIEW,
  );
  const [finalDiscardError, setFinalDiscardError] = useState('');
  const [heatOverflowPolicy, setHeatOverflowPolicy] = useState('auto-increase');

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (eventStartDate && eventEndDate && eventEndDate < eventStartDate) {
      reportInfo(
        'The end date is before the start date. Please pick an end date that is the same day or later.',
        'Check the event dates',
      );
      return;
    }

    // Event routes are keyed by name (/event/:name), so duplicate names would
    // collide on navigation. Block them before inserting.
    try {
      const existingEvents =
        await window.electron.sqlite.eventDB.readAllEvents();
      const nameTaken =
        Array.isArray(existingEvents) &&
        existingEvents.some(
          (existing) =>
            (existing.event_name || '').trim().toLowerCase() ===
            eventName.trim().toLowerCase(),
        );
      if (nameTaken) {
        reportInfo(
          'An event with this name already exists. Please choose a different name.',
          'Event name already in use',
        );
        return;
      }
    } catch (error) {
      reportError('Could not verify the event name.', error);
      return;
    }

    if (advancedEnabled && qualifyingDiscardMode === 'custom') {
      const validation = parseThresholdInput(qualifyingDiscardInput);
      setQualifyingDiscardError(validation.error || '');
      if (validation.error) {
        reportInfo(validation.error, 'Invalid qualifying thresholds');
        return;
      }
    }

    if (advancedEnabled && finalDiscardMode === 'custom') {
      const validation = parseThresholdInput(finalDiscardInput);
      setFinalDiscardError(validation.error || '');
      if (validation.error) {
        reportInfo(validation.error, 'Invalid final thresholds');
        return;
      }
    }

    try {
      await window.electron.sqlite.eventDB.insertEvent(
        eventName,
        eventLocation,
        eventStartDate,
        eventEndDate,
        advancedEnabled ? assignmentMode : 'progressive',
        advancedEnabled
          ? serializeDiscardProfile(
              qualifyingDiscardMode,
              qualifyingDiscardInput,
            )
          : 'standard',
        advancedEnabled
          ? serializeDiscardProfile(finalDiscardMode, finalDiscardInput)
          : 'standard',
        advancedEnabled ? heatOverflowPolicy : 'auto-increase',
      );
      setEventName('');
      setEventLocation('');
      setEventStartDate('');
      setEventEndDate('');
      setAdvancedEnabled(false);
      setAssignmentMode('progressive');
      setQualifyingDiscardMode('standard');
      setQualifyingDiscardInput(DEFAULT_THRESHOLD_PREVIEW);
      setQualifyingDiscardError('');
      setFinalDiscardMode('standard');
      setFinalDiscardInput(DEFAULT_THRESHOLD_PREVIEW);
      setFinalDiscardError('');
      setHeatOverflowPolicy('auto-increase');
      if (onEventCreated) onEventCreated();
    } catch (error) {
      reportError('Could not create the event.', error);
    }
  };

  const handleQualifyingDiscardModeChange = (value) => {
    setQualifyingDiscardMode(value);
    setQualifyingDiscardError('');
    if (value === 'standard') {
      setQualifyingDiscardInput(DEFAULT_THRESHOLD_PREVIEW);
    }
  };

  const handleFinalDiscardModeChange = (value) => {
    setFinalDiscardMode(value);
    setFinalDiscardError('');
    if (value === 'standard') {
      setFinalDiscardInput(DEFAULT_THRESHOLD_PREVIEW);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-grid-2">
        <div>
          <label htmlFor="evtName">
            Event Name
            <input
              id="evtName"
              type="text"
              placeholder="e.g. Spring Regatta 2026"
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
              required
            />
          </label>
        </div>
        <div>
          <label htmlFor="evtLocation">
            Location
            <input
              id="evtLocation"
              type="text"
              placeholder="e.g. Marina Bay"
              value={eventLocation}
              onChange={(e) => setEventLocation(e.target.value)}
              required
            />
          </label>
        </div>
        <div>
          <label htmlFor="evtStart">
            Start Date
            <input
              id="evtStart"
              type="date"
              value={eventStartDate}
              onChange={(e) => setEventStartDate(e.target.value)}
              required
            />
          </label>
        </div>
        <div>
          <label htmlFor="evtEnd">
            End Date
            <input
              id="evtEnd"
              type="date"
              value={eventEndDate}
              min={eventStartDate || undefined}
              onChange={(e) => setEventEndDate(e.target.value)}
              required
            />
          </label>
        </div>
      </div>
      <label htmlFor="advancedSettingsToggle" className="checkbox-row">
        <input
          id="advancedSettingsToggle"
          type="checkbox"
          checked={advancedEnabled}
          onChange={(e) => setAdvancedEnabled(e.target.checked)}
        />
        Advanced SHRS options
      </label>

      {advancedEnabled && (
        <div className="form-grid-2">
          <div>
            <label htmlFor="assignmentMode">
              Qualifying Assignment Mode
              <select
                id="assignmentMode"
                value={assignmentMode}
                onChange={(e) => setAssignmentMode(e.target.value)}
              >
                <option value="progressive">Progressive Assignment</option>
                <option value="pre-assigned">Pre-Assignments</option>
              </select>
            </label>
          </div>
          <div>
            <label htmlFor="overflowPolicy">
              Heat Overflow Policy
              <select
                id="overflowPolicy"
                value={heatOverflowPolicy}
                onChange={(e) => setHeatOverflowPolicy(e.target.value)}
              >
                <option value="auto-increase">
                  Auto-increase number of heats
                </option>
                <option value="confirm-allow-oversize">
                  Allow oversize only after confirm
                </option>
              </select>
            </label>
          </div>
          <div>
            <label htmlFor="qualDiscardProfile">
              Qualifying Discards
              <select
                id="qualDiscardProfile"
                value={qualifyingDiscardMode}
                onChange={(e) =>
                  handleQualifyingDiscardModeChange(e.target.value)
                }
              >
                <option value="standard">Standard SHRS 5.4</option>
                <option value="custom">Custom thresholds list</option>
              </select>
              {qualifyingDiscardMode === 'custom' && (
                <input
                  type="text"
                  value={qualifyingDiscardInput}
                  onChange={(e) => {
                    setQualifyingDiscardInput(e.target.value);
                    const validation = parseThresholdInput(e.target.value);
                    setQualifyingDiscardError(validation.error || '');
                  }}
                  placeholder="e.g. 4,8,16,24"
                  title="Enter comma-separated thresholds"
                />
              )}
              {qualifyingDiscardError && (
                <small className="form-error">{qualifyingDiscardError}</small>
              )}
              <small className="form-note">
                {getDiscardSummary(
                  qualifyingDiscardMode,
                  qualifyingDiscardInput,
                )}
              </small>
              <small className="form-note">
                {getDiscardExamples(
                  qualifyingDiscardMode,
                  qualifyingDiscardInput,
                )}
              </small>
            </label>
          </div>
          <div>
            <label htmlFor="finalDiscardProfile">
              Finals Discards
              <select
                id="finalDiscardProfile"
                value={finalDiscardMode}
                onChange={(e) => handleFinalDiscardModeChange(e.target.value)}
              >
                <option value="standard">Standard SHRS 5.4</option>
                <option value="custom">Custom thresholds list</option>
              </select>
              {finalDiscardMode === 'custom' && (
                <input
                  type="text"
                  value={finalDiscardInput}
                  onChange={(e) => {
                    setFinalDiscardInput(e.target.value);
                    const validation = parseThresholdInput(e.target.value);
                    setFinalDiscardError(validation.error || '');
                  }}
                  placeholder="e.g. 4,8,16,24"
                  title="Enter comma-separated thresholds"
                />
              )}
              {finalDiscardError && (
                <small className="form-error">{finalDiscardError}</small>
              )}
              <small className="form-note">
                {getDiscardSummary(finalDiscardMode, finalDiscardInput)}
              </small>
              <small className="form-note">
                {getDiscardExamples(finalDiscardMode, finalDiscardInput)}
              </small>
            </label>
          </div>
        </div>
      )}
      <button type="submit" className="btn-success">
        <i className="fa fa-plus-circle" aria-hidden="true" /> Create Event
      </button>
    </form>
  );
}

export function EventList({ events, onEventsChanged }) {
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editStartDate, setEditStartDate] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [editAdvancedEnabled, setEditAdvancedEnabled] = useState(false);
  const [editAssignmentMode, setEditAssignmentMode] = useState('progressive');
  const [editQualifyingDiscardMode, setEditQualifyingDiscardMode] =
    useState('standard');
  const [editQualifyingDiscardInput, setEditQualifyingDiscardInput] = useState(
    DEFAULT_THRESHOLD_PREVIEW,
  );
  const [editQualifyingDiscardError, setEditQualifyingDiscardError] =
    useState('');
  const [editFinalDiscardMode, setEditFinalDiscardMode] = useState('standard');
  const [editFinalDiscardInput, setEditFinalDiscardInput] = useState(
    DEFAULT_THRESHOLD_PREVIEW,
  );
  const [editFinalDiscardError, setEditFinalDiscardError] = useState('');
  const [editHeatOverflowPolicy, setEditHeatOverflowPolicy] =
    useState('auto-increase');
  const [editQualifyingDiscardLocked, setEditQualifyingDiscardLocked] =
    useState(false);
  const [editFinalDiscardLocked, setEditFinalDiscardLocked] = useState(false);

  const navigate = useNavigate();

  const handleEventClick = (event) => {
    navigate(`/event/${event.event_name}`, { state: { event } });
  };

  const startEdit = (e, event) => {
    const qualifyingProfile = parseDiscardModeAndConfig(
      event.shrs_discard_profile_qualifying,
    );
    const finalProfile = parseDiscardModeAndConfig(
      event.shrs_discard_profile_final,
    );

    e.stopPropagation();
    setEditingId(event.event_id);
    setEditName(event.event_name);
    setEditLocation(event.event_location);
    setEditStartDate(event.start_date);
    setEditEndDate(event.end_date);
    const hasAdvancedSettings =
      (event.shrs_qualifying_assignment_mode || 'progressive') !==
        'progressive' ||
      (event.shrs_heat_overflow_policy || 'auto-increase') !==
        'auto-increase' ||
      qualifyingProfile.mode === 'custom' ||
      finalProfile.mode === 'custom';
    setEditAdvancedEnabled(hasAdvancedSettings);
    setEditAssignmentMode(
      event.shrs_qualifying_assignment_mode || 'progressive',
    );
    setEditQualifyingDiscardMode(qualifyingProfile.mode);
    setEditQualifyingDiscardInput(qualifyingProfile.thresholdsInput);
    setEditQualifyingDiscardError('');
    setEditFinalDiscardMode(finalProfile.mode);
    setEditFinalDiscardInput(finalProfile.thresholdsInput);
    setEditFinalDiscardError('');
    setEditHeatOverflowPolicy(
      event.shrs_heat_overflow_policy || 'auto-increase',
    );
    setEditQualifyingDiscardLocked(event.shrs_discard_locked_qualifying === 1);
    setEditFinalDiscardLocked(event.shrs_discard_locked_final === 1);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditAdvancedEnabled(false);
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();

    if (editStartDate && editEndDate && editEndDate < editStartDate) {
      reportInfo(
        'The end date is before the start date. Please pick an end date that is the same day or later.',
        'Check the event dates',
      );
      return;
    }

    // Event routes are keyed by name, so a rename must not collide with another
    // existing event (the event being edited is excluded by event_id).
    const renameCollides = events.some(
      (existing) =>
        existing.event_id !== editingId &&
        (existing.event_name || '').trim().toLowerCase() ===
          editName.trim().toLowerCase(),
    );
    if (renameCollides) {
      reportInfo(
        'Another event already uses this name. Please choose a different name.',
        'Event name already in use',
      );
      return;
    }

    if (
      editAdvancedEnabled &&
      !editQualifyingDiscardLocked &&
      editQualifyingDiscardMode === 'custom'
    ) {
      const validation = parseThresholdInput(editQualifyingDiscardInput);
      setEditQualifyingDiscardError(validation.error || '');
      if (validation.error) {
        reportInfo(validation.error, 'Invalid qualifying thresholds');
        return;
      }
    }

    if (
      editAdvancedEnabled &&
      !editFinalDiscardLocked &&
      editFinalDiscardMode === 'custom'
    ) {
      const validation = parseThresholdInput(editFinalDiscardInput);
      setEditFinalDiscardError(validation.error || '');
      if (validation.error) {
        reportInfo(validation.error, 'Invalid final thresholds');
        return;
      }
    }

    try {
      await window.electron.sqlite.eventDB.updateEvent(
        editingId,
        editName,
        editLocation,
        editStartDate,
        editEndDate,
        editAdvancedEnabled ? editAssignmentMode : 'progressive',
        editAdvancedEnabled
          ? serializeDiscardProfile(
              editQualifyingDiscardMode,
              editQualifyingDiscardInput,
            )
          : 'standard',
        editAdvancedEnabled
          ? serializeDiscardProfile(editFinalDiscardMode, editFinalDiscardInput)
          : 'standard',
        editAdvancedEnabled ? editHeatOverflowPolicy : 'auto-increase',
      );
      setEditingId(null);
      setEditAdvancedEnabled(false);
      if (onEventsChanged) onEventsChanged();
    } catch (error) {
      reportError('Could not update the event.', error);
    }
  };

  const handleDeleteEvent = async (e, eventId) => {
    e.stopPropagation();

    const confirmed = await confirmAction(
      'This will permanently delete the event together with all its sailors, heats, races and scores. This cannot be undone.\n\nDelete this event?',
      'Delete event',
      { confirmLabel: 'Delete permanently', cancelLabel: 'Keep event' },
    );

    if (!confirmed) return;

    try {
      await window.electron.sqlite.eventDB.deleteEvent(eventId);
      if (onEventsChanged) onEventsChanged();
      reportInfo('Event deleted successfully.', 'Success');
    } catch (error) {
      reportError('Could not delete the event.', error);
    }
  };

  const handleEditQualifyingDiscardModeChange = (value) => {
    setEditQualifyingDiscardMode(value);
    setEditQualifyingDiscardError('');
    if (value === 'standard') {
      setEditQualifyingDiscardInput(DEFAULT_THRESHOLD_PREVIEW);
    }
  };

  const handleEditFinalDiscardModeChange = (value) => {
    setEditFinalDiscardMode(value);
    setEditFinalDiscardError('');
    if (value === 'standard') {
      setEditFinalDiscardInput(DEFAULT_THRESHOLD_PREVIEW);
    }
  };

  return (
    <div className="event-list-stack">
      {events.map((event) => (
        <div key={event.event_id}>
          {editingId === event.event_id ? (
            /* ── Inline edit form ─── */
            <form onSubmit={handleEditSubmit} className="inline-edit-form">
              <div className="form-grid-2">
                <div>
                  <label htmlFor={`editName-${event.event_id}`}>
                    Event Name
                    <input
                      id={`editName-${event.event_id}`}
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      required
                    />
                  </label>
                </div>
                <div>
                  <label htmlFor={`editLoc-${event.event_id}`}>
                    Location
                    <input
                      id={`editLoc-${event.event_id}`}
                      type="text"
                      value={editLocation}
                      onChange={(e) => setEditLocation(e.target.value)}
                      required
                    />
                  </label>
                </div>
                <div>
                  <label htmlFor={`editStart-${event.event_id}`}>
                    Start Date
                    <input
                      id={`editStart-${event.event_id}`}
                      type="date"
                      value={editStartDate}
                      onChange={(e) => setEditStartDate(e.target.value)}
                      required
                    />
                  </label>
                </div>
                <div>
                  <label htmlFor={`editEnd-${event.event_id}`}>
                    End Date
                    <input
                      id={`editEnd-${event.event_id}`}
                      type="date"
                      value={editEndDate}
                      min={editStartDate || undefined}
                      onChange={(e) => setEditEndDate(e.target.value)}
                      required
                    />
                  </label>
                </div>
              </div>
              <label
                htmlFor={`editAdvanced-${event.event_id}`}
                className="checkbox-row"
              >
                <input
                  id={`editAdvanced-${event.event_id}`}
                  type="checkbox"
                  checked={editAdvancedEnabled}
                  onChange={(e) => setEditAdvancedEnabled(e.target.checked)}
                />
                Advanced SHRS options
              </label>

              {editAdvancedEnabled && (
                <div className="form-grid-2">
                  <div>
                    <label htmlFor={`editAssignment-${event.event_id}`}>
                      Qualifying Assignment Mode
                      <select
                        id={`editAssignment-${event.event_id}`}
                        value={editAssignmentMode}
                        onChange={(e) => setEditAssignmentMode(e.target.value)}
                      >
                        <option value="progressive">
                          Progressive Assignment
                        </option>
                        <option value="pre-assigned">Pre-Assignments</option>
                      </select>
                    </label>
                  </div>
                  <div>
                    <label htmlFor={`editOverflow-${event.event_id}`}>
                      Heat Overflow Policy
                      <select
                        id={`editOverflow-${event.event_id}`}
                        value={editHeatOverflowPolicy}
                        onChange={(e) =>
                          setEditHeatOverflowPolicy(e.target.value)
                        }
                      >
                        <option value="auto-increase">
                          Auto-increase number of heats
                        </option>
                        <option value="confirm-allow-oversize">
                          Allow oversize only after confirm
                        </option>
                      </select>
                    </label>
                  </div>
                  <div>
                    <label htmlFor={`editQualDiscard-${event.event_id}`}>
                      Qualifying Discards
                      <select
                        id={`editQualDiscard-${event.event_id}`}
                        value={editQualifyingDiscardMode}
                        disabled={editQualifyingDiscardLocked}
                        onChange={(e) =>
                          handleEditQualifyingDiscardModeChange(e.target.value)
                        }
                      >
                        <option value="standard">Standard SHRS 5.4</option>
                        <option value="custom">Custom thresholds list</option>
                      </select>
                      {editQualifyingDiscardMode === 'custom' && (
                        <input
                          type="text"
                          disabled={editQualifyingDiscardLocked}
                          value={editQualifyingDiscardInput}
                          onChange={(e) => {
                            setEditQualifyingDiscardInput(e.target.value);
                            const validation = parseThresholdInput(
                              e.target.value,
                            );
                            setEditQualifyingDiscardError(
                              validation.error || '',
                            );
                          }}
                          placeholder="e.g. 4,8,16,24"
                          title="Enter comma-separated thresholds"
                        />
                      )}
                      {editQualifyingDiscardError && (
                        <small className="form-error">
                          {editQualifyingDiscardError}
                        </small>
                      )}
                      <small className="form-note">
                        {getDiscardSummary(
                          editQualifyingDiscardMode,
                          editQualifyingDiscardInput,
                        )}
                      </small>
                      <small className="form-note">
                        {getDiscardExamples(
                          editQualifyingDiscardMode,
                          editQualifyingDiscardInput,
                        )}
                      </small>
                      {editQualifyingDiscardLocked && (
                        <small className="form-locked-note">
                          Locked after first qualifying race.
                        </small>
                      )}
                    </label>
                  </div>
                  <div>
                    <label htmlFor={`editFinalDiscard-${event.event_id}`}>
                      Finals Discards
                      <select
                        id={`editFinalDiscard-${event.event_id}`}
                        value={editFinalDiscardMode}
                        disabled={editFinalDiscardLocked}
                        onChange={(e) =>
                          handleEditFinalDiscardModeChange(e.target.value)
                        }
                      >
                        <option value="standard">Standard SHRS 5.4</option>
                        <option value="custom">Custom thresholds list</option>
                      </select>
                      {editFinalDiscardMode === 'custom' && (
                        <input
                          type="text"
                          disabled={editFinalDiscardLocked}
                          value={editFinalDiscardInput}
                          onChange={(e) => {
                            setEditFinalDiscardInput(e.target.value);
                            const validation = parseThresholdInput(
                              e.target.value,
                            );
                            setEditFinalDiscardError(validation.error || '');
                          }}
                          placeholder="e.g. 4,8,16,24"
                          title="Enter comma-separated thresholds"
                        />
                      )}
                      {editFinalDiscardError && (
                        <small className="form-error">
                          {editFinalDiscardError}
                        </small>
                      )}
                      <small className="form-note">
                        {getDiscardSummary(
                          editFinalDiscardMode,
                          editFinalDiscardInput,
                        )}
                      </small>
                      <small className="form-note">
                        {getDiscardExamples(
                          editFinalDiscardMode,
                          editFinalDiscardInput,
                        )}
                      </small>
                      {editFinalDiscardLocked && (
                        <small className="form-locked-note">
                          Locked after first final race.
                        </small>
                      )}
                    </label>
                  </div>
                </div>
              )}
              <div className="flex gap-2">
                <button type="submit" className="btn-success">
                  <i className="fa fa-check" aria-hidden="true" /> Save
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="btn-outline"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            /* ── Event row ─── */
            <div className="event-row">
              <button
                type="button"
                className="event-list-item"
                onClick={() => handleEventClick(event)}
              >
                <span className="event-item-title">
                  {event.event_name}
                  <span className="event-item-location">
                    &mdash; {event.event_location}
                  </span>
                </span>
                <span className="event-item-meta">
                  {event.start_date} &rarr; {event.end_date}
                </span>
                <span className="event-item-meta">
                  {getAssignmentLabel(event)}
                  {' | '}
                  {getOverflowPolicyLabel(event)}
                </span>
              </button>

              <button
                type="button"
                aria-label="Edit event"
                title="Edit event"
                onClick={(e) => startEdit(e, event)}
                className="btn-outline btn-sm"
              >
                <i className="fa fa-pencil" aria-hidden="true" />
              </button>

              <button
                type="button"
                aria-label="Delete event"
                title="Delete event"
                onClick={(e) => {
                  setEditingId(null);
                  handleDeleteEvent(e, event.event_id);
                }}
                className="btn-danger btn-sm"
              >
                <i className="fa fa-trash" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

EventForm.propTypes = {
  onEventCreated: PropTypes.func,
};

EventForm.defaultProps = {
  onEventCreated: null,
};

EventList.propTypes = {
  // eslint-disable-next-line react/forbid-prop-types
  events: PropTypes.arrayOf(PropTypes.object).isRequired,
  onEventsChanged: PropTypes.func,
};

EventList.defaultProps = {
  onEventsChanged: null,
};

export default EventForm;
