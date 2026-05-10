import React, { useState, useEffect } from 'react';
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

function EventForm() {
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
  const [events, setEvents] = useState([]);

  // Edit state
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

  const fetchEvents = async () => {
    try {
      const allEvents = await window.electron.sqlite.eventDB.readAllEvents();
      setEvents(Array.isArray(allEvents) ? allEvents : []);
    } catch (error) {
      reportError('Could not load events.', error);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();

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
      fetchEvents();
    } catch (error) {
      reportError('Could not create the event.', error);
    }
  };

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
      fetchEvents();
    } catch (error) {
      reportError('Could not update the event.', error);
    }
  };

  const handleDeleteEvent = async (e, eventId) => {
    e.stopPropagation();

    const confirmed = await confirmAction(
      'Delete this event and all associated data?',
      'Delete event',
    );

    if (!confirmed) return;

    try {
      await window.electron.sqlite.eventDB.deleteEvent(eventId);
      fetchEvents();
      reportInfo('Event deleted successfully.', 'Success');
    } catch (error) {
      reportError('Could not delete the event.', error);
    }
  };

  const fieldStyle = {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '14px',
    marginBottom: '16px',
  };

  const settingsFieldStyle = {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '14px',
    marginBottom: '18px',
  };

  const advancedToggleLabelStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: '8px',
    marginBottom: '14px',
  };

  const checkboxInputStyle = {
    width: 'auto',
    padding: 0,
    border: 'none',
    borderRadius: 0,
    boxShadow: 'none',
    background: 'transparent',
    margin: 0,
  };

  const getAssignmentLabel = (event) =>
    event.shrs_qualifying_assignment_mode === 'pre-assigned'
      ? 'Pre-Assignments'
      : 'Progressive';

  const getOverflowPolicyLabel = (event) =>
    event.shrs_heat_overflow_policy === 'confirm-allow-oversize'
      ? 'Oversize with confirm'
      : 'Auto-increase heats';

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
    <div>
      {/* ── Create form ─── */}
      <form onSubmit={handleSubmit}>
        <div style={fieldStyle}>
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
                onChange={(e) => setEventEndDate(e.target.value)}
                required
              />
            </label>
          </div>
        </div>
        <label
          htmlFor="advancedSettingsToggle"
          style={advancedToggleLabelStyle}
        >
          <input
            id="advancedSettingsToggle"
            type="checkbox"
            style={checkboxInputStyle}
            checked={advancedEnabled}
            onChange={(e) => setAdvancedEnabled(e.target.checked)}
          />
          Advanced SHRS options
        </label>

        {advancedEnabled && (
          <div style={settingsFieldStyle}>
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
                  <small style={{ color: '#B42318', display: 'block' }}>
                    {qualifyingDiscardError}
                  </small>
                )}
                <small style={{ color: '#5D6D7E', display: 'block' }}>
                  {getDiscardSummary(
                    qualifyingDiscardMode,
                    qualifyingDiscardInput,
                  )}
                </small>
                <small style={{ color: '#5D6D7E', display: 'block' }}>
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
                  <small style={{ color: '#B42318', display: 'block' }}>
                    {finalDiscardError}
                  </small>
                )}
                <small style={{ color: '#5D6D7E', display: 'block' }}>
                  {getDiscardSummary(finalDiscardMode, finalDiscardInput)}
                </small>
                <small style={{ color: '#5D6D7E', display: 'block' }}>
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

      {/* ── Existing events ─── */}
      {events.length > 0 && (
        <div style={{ marginTop: '28px' }}>
          <h2 style={{ marginBottom: '12px' }}>
            <i
              className="fa fa-list"
              aria-hidden="true"
              style={{ marginRight: '8px' }}
            />
            Existing Events
          </h2>
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
          >
            {events.map((event) => (
              <div key={event.event_id}>
                {editingId === event.event_id ? (
                  /* ── Inline edit form ─── */
                  <form
                    onSubmit={handleEditSubmit}
                    style={{
                      background: 'var(--surface)',
                      border: '1px solid var(--border, #d0d7de)',
                      borderRadius: 'var(--radius)',
                      padding: '16px',
                    }}
                  >
                    <div style={fieldStyle}>
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
                            onChange={(e) => setEditEndDate(e.target.value)}
                            required
                          />
                        </label>
                      </div>
                    </div>
                    <label
                      htmlFor={`editAdvanced-${event.event_id}`}
                      style={advancedToggleLabelStyle}
                    >
                      <input
                        id={`editAdvanced-${event.event_id}`}
                        type="checkbox"
                        style={checkboxInputStyle}
                        checked={editAdvancedEnabled}
                        onChange={(e) =>
                          setEditAdvancedEnabled(e.target.checked)
                        }
                      />
                      Advanced SHRS options
                    </label>

                    {editAdvancedEnabled && (
                      <div style={settingsFieldStyle}>
                        <div>
                          <label htmlFor={`editAssignment-${event.event_id}`}>
                            Qualifying Assignment Mode
                            <select
                              id={`editAssignment-${event.event_id}`}
                              value={editAssignmentMode}
                              onChange={(e) =>
                                setEditAssignmentMode(e.target.value)
                              }
                            >
                              <option value="progressive">
                                Progressive Assignment
                              </option>
                              <option value="pre-assigned">
                                Pre-Assignments
                              </option>
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
                                handleEditQualifyingDiscardModeChange(
                                  e.target.value,
                                )
                              }
                            >
                              <option value="standard">
                                Standard SHRS 5.4
                              </option>
                              <option value="custom">
                                Custom thresholds list
                              </option>
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
                              <small
                                style={{ color: '#B42318', display: 'block' }}
                              >
                                {editQualifyingDiscardError}
                              </small>
                            )}
                            <small
                              style={{ color: '#5D6D7E', display: 'block' }}
                            >
                              {getDiscardSummary(
                                editQualifyingDiscardMode,
                                editQualifyingDiscardInput,
                              )}
                            </small>
                            <small
                              style={{ color: '#5D6D7E', display: 'block' }}
                            >
                              {getDiscardExamples(
                                editQualifyingDiscardMode,
                                editQualifyingDiscardInput,
                              )}
                            </small>
                            {editQualifyingDiscardLocked && (
                              <small style={{ color: '#6B849A' }}>
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
                              <option value="standard">
                                Standard SHRS 5.4
                              </option>
                              <option value="custom">
                                Custom thresholds list
                              </option>
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
                                  setEditFinalDiscardError(
                                    validation.error || '',
                                  );
                                }}
                                placeholder="e.g. 4,8,16,24"
                                title="Enter comma-separated thresholds"
                              />
                            )}
                            {editFinalDiscardError && (
                              <small
                                style={{ color: '#B42318', display: 'block' }}
                              >
                                {editFinalDiscardError}
                              </small>
                            )}
                            <small
                              style={{ color: '#5D6D7E', display: 'block' }}
                            >
                              {getDiscardSummary(
                                editFinalDiscardMode,
                                editFinalDiscardInput,
                              )}
                            </small>
                            <small
                              style={{ color: '#5D6D7E', display: 'block' }}
                            >
                              {getDiscardExamples(
                                editFinalDiscardMode,
                                editFinalDiscardInput,
                              )}
                            </small>
                            {editFinalDiscardLocked && (
                              <small style={{ color: '#6B849A' }}>
                                Locked after first final race.
                              </small>
                            )}
                          </label>
                        </div>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: '8px' }}>
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
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <button
                      type="button"
                      className="event-list-item"
                      style={{
                        flex: 1,
                        minWidth: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        justifyContent: 'center',
                        gap: '4px',
                      }}
                      onClick={() => handleEventClick(event)}
                    >
                      <span
                        style={{
                          width: '100%',
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {event.event_name}
                        <span
                          style={{
                            marginLeft: '10px',
                            color: '#5D6D7E',
                            fontWeight: 400,
                          }}
                        >
                          &mdash; {event.event_location}
                        </span>
                      </span>
                      <span className="event-item-meta">
                        {event.start_date} &rarr; {event.end_date}
                      </span>
                      <span
                        className="event-item-meta"
                        style={{ marginTop: '4px' }}
                      >
                        {getAssignmentLabel(event)}
                        {' | '}
                        {getOverflowPolicyLabel(event)}
                      </span>
                    </button>

                    {/* Edit button */}
                    <button
                      type="button"
                      aria-label="Edit event"
                      title="Edit event"
                      onClick={(e) => startEdit(e, event)}
                      className="btn-outline btn-sm"
                      style={{ flexShrink: 0 }}
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
                      style={{ flexShrink: 0 }}
                    >
                      <i className="fa fa-trash" aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default EventForm;
