import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { confirmAction, reportError, reportInfo } from '../utils/userFeedback';

const DEFAULT_DISCARD_CONFIG = {
  firstDiscardAt: 4,
  secondDiscardAt: 8,
  additionalEvery: 8,
};

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

const parseDiscardModeAndConfig = (raw) => {
  if (!raw || raw === 'standard') {
    return {
      mode: 'standard',
      config: { ...DEFAULT_DISCARD_CONFIG },
    };
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      mode: 'custom',
      config: normalizeDiscardConfig(parsed),
    };
  } catch (_error) {
    return {
      mode: 'standard',
      config: { ...DEFAULT_DISCARD_CONFIG },
    };
  }
};

const serializeDiscardProfile = (mode, config) =>
  mode === 'standard' ? 'standard' : JSON.stringify(normalizeDiscardConfig(config));

const getDiscardSummary = (config) => {
  const normalized = normalizeDiscardConfig(config);
  return `0 discards before ${normalized.firstDiscardAt} races. Then: 1 discard from ${normalized.firstDiscardAt}, 2 from ${normalized.secondDiscardAt}, then +1 discard every ${normalized.additionalEvery} additional races.`;
};

const getDiscardExamples = (config) => {
  const normalized = normalizeDiscardConfig(config);
  const thresholds = [
    normalized.firstDiscardAt,
    normalized.secondDiscardAt,
    normalized.secondDiscardAt + normalized.additionalEvery,
    normalized.secondDiscardAt + normalized.additionalEvery * 2,
  ];

  return thresholds
    .map((raceCount) => {
      let discardCount = 0;
      if (raceCount >= normalized.firstDiscardAt) discardCount = 1;
      if (raceCount >= normalized.secondDiscardAt) {
        discardCount =
          2 +
          Math.floor(
            (raceCount - normalized.secondDiscardAt) / normalized.additionalEvery,
          );
      }
      return `${raceCount} races = ${discardCount} discard${discardCount === 1 ? '' : 's'}`;
    })
    .join(' | ');
};

function EventForm() {
  const [eventName, setEventName] = useState('');
  const [eventLocation, setEventLocation] = useState('');
  const [eventStartDate, setEventStartDate] = useState('');
  const [eventEndDate, setEventEndDate] = useState('');
  const [assignmentMode, setAssignmentMode] = useState('progressive');
  const [qualifyingDiscardMode, setQualifyingDiscardMode] =
    useState('standard');
  const [qualifyingDiscardConfig, setQualifyingDiscardConfig] = useState({
    ...DEFAULT_DISCARD_CONFIG,
  });
  const [finalDiscardMode, setFinalDiscardMode] = useState('standard');
  const [finalDiscardConfig, setFinalDiscardConfig] = useState({
    ...DEFAULT_DISCARD_CONFIG,
  });
  const [heatOverflowPolicy, setHeatOverflowPolicy] = useState('auto-increase');
  const [events, setEvents] = useState([]);

  // Edit state
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editStartDate, setEditStartDate] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [editAssignmentMode, setEditAssignmentMode] = useState('progressive');
  const [editQualifyingDiscardMode, setEditQualifyingDiscardMode] =
    useState('standard');
  const [editQualifyingDiscardConfig, setEditQualifyingDiscardConfig] =
    useState({ ...DEFAULT_DISCARD_CONFIG });
  const [editFinalDiscardMode, setEditFinalDiscardMode] = useState('standard');
  const [editFinalDiscardConfig, setEditFinalDiscardConfig] = useState({
    ...DEFAULT_DISCARD_CONFIG,
  });
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
    try {
      await window.electron.sqlite.eventDB.insertEvent(
        eventName,
        eventLocation,
        eventStartDate,
        eventEndDate,
        assignmentMode,
        serializeDiscardProfile(qualifyingDiscardMode, qualifyingDiscardConfig),
        serializeDiscardProfile(finalDiscardMode, finalDiscardConfig),
        heatOverflowPolicy,
      );
      setEventName('');
      setEventLocation('');
      setEventStartDate('');
      setEventEndDate('');
      setAssignmentMode('progressive');
      setQualifyingDiscardMode('standard');
      setQualifyingDiscardConfig({ ...DEFAULT_DISCARD_CONFIG });
      setFinalDiscardMode('standard');
      setFinalDiscardConfig({ ...DEFAULT_DISCARD_CONFIG });
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
    setEditAssignmentMode(
      event.shrs_qualifying_assignment_mode || 'progressive',
    );
    setEditQualifyingDiscardMode(qualifyingProfile.mode);
    setEditQualifyingDiscardConfig(qualifyingProfile.config);
    setEditFinalDiscardMode(finalProfile.mode);
    setEditFinalDiscardConfig(finalProfile.config);
    setEditHeatOverflowPolicy(
      event.shrs_heat_overflow_policy || 'auto-increase',
    );
    setEditQualifyingDiscardLocked(event.shrs_discard_locked_qualifying === 1);
    setEditFinalDiscardLocked(event.shrs_discard_locked_final === 1);
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    try {
      await window.electron.sqlite.eventDB.updateEvent(
        editingId,
        editName,
        editLocation,
        editStartDate,
        editEndDate,
        editAssignmentMode,
        serializeDiscardProfile(
          editQualifyingDiscardMode,
          editQualifyingDiscardConfig,
        ),
        serializeDiscardProfile(editFinalDiscardMode, editFinalDiscardConfig),
        editHeatOverflowPolicy,
      );
      setEditingId(null);
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

  const discardGridStyle = {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap: '6px',
    marginTop: '6px',
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
    if (value === 'standard') {
      setQualifyingDiscardConfig({ ...DEFAULT_DISCARD_CONFIG });
    }
  };

  const handleFinalDiscardModeChange = (value) => {
    setFinalDiscardMode(value);
    if (value === 'standard') {
      setFinalDiscardConfig({ ...DEFAULT_DISCARD_CONFIG });
    }
  };

  const handleEditQualifyingDiscardModeChange = (value) => {
    setEditQualifyingDiscardMode(value);
    if (value === 'standard') {
      setEditQualifyingDiscardConfig({ ...DEFAULT_DISCARD_CONFIG });
    }
  };

  const handleEditFinalDiscardModeChange = (value) => {
    setEditFinalDiscardMode(value);
    if (value === 'standard') {
      setEditFinalDiscardConfig({ ...DEFAULT_DISCARD_CONFIG });
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
                onChange={(e) => handleQualifyingDiscardModeChange(e.target.value)}
              >
                <option value="standard">Standard SHRS 5.4</option>
                <option value="custom">Custom thresholds</option>
              </select>
              <div style={discardGridStyle}>
                <input
                  type="number"
                  min="1"
                  disabled={qualifyingDiscardMode !== 'custom'}
                  value={qualifyingDiscardConfig.firstDiscardAt}
                  onChange={(e) =>
                    setQualifyingDiscardConfig((prev) => ({
                      ...prev,
                      firstDiscardAt: Number(e.target.value) || 1,
                    }))
                  }
                  title="First discard at N races"
                />
                <input
                  type="number"
                  min="2"
                  disabled={qualifyingDiscardMode !== 'custom'}
                  value={qualifyingDiscardConfig.secondDiscardAt}
                  onChange={(e) =>
                    setQualifyingDiscardConfig((prev) => ({
                      ...prev,
                      secondDiscardAt: Number(e.target.value) || 2,
                    }))
                  }
                  title="Second discard at N races"
                />
                <input
                  type="number"
                  min="1"
                  disabled={qualifyingDiscardMode !== 'custom'}
                  value={qualifyingDiscardConfig.additionalEvery}
                  onChange={(e) =>
                    setQualifyingDiscardConfig((prev) => ({
                      ...prev,
                      additionalEvery: Number(e.target.value) || 1,
                    }))
                  }
                  title="Additional discard every N races"
                />
              </div>
              <small style={{ color: '#5D6D7E' }}>
                Meaning of the 3 numbers: first discard starts at N1 races, second at N2 races, then one extra discard every N3 races.
              </small>
              <small style={{ color: '#5D6D7E', display: 'block' }}>
                {getDiscardSummary(qualifyingDiscardConfig)}
              </small>
              <small style={{ color: '#5D6D7E', display: 'block' }}>
                {getDiscardExamples(qualifyingDiscardConfig)}
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
                <option value="custom">Custom thresholds</option>
              </select>
              <div style={discardGridStyle}>
                <input
                  type="number"
                  min="1"
                  disabled={finalDiscardMode !== 'custom'}
                  value={finalDiscardConfig.firstDiscardAt}
                  onChange={(e) =>
                    setFinalDiscardConfig((prev) => ({
                      ...prev,
                      firstDiscardAt: Number(e.target.value) || 1,
                    }))
                  }
                  title="First discard at N races"
                />
                <input
                  type="number"
                  min="2"
                  disabled={finalDiscardMode !== 'custom'}
                  value={finalDiscardConfig.secondDiscardAt}
                  onChange={(e) =>
                    setFinalDiscardConfig((prev) => ({
                      ...prev,
                      secondDiscardAt: Number(e.target.value) || 2,
                    }))
                  }
                  title="Second discard at N races"
                />
                <input
                  type="number"
                  min="1"
                  disabled={finalDiscardMode !== 'custom'}
                  value={finalDiscardConfig.additionalEvery}
                  onChange={(e) =>
                    setFinalDiscardConfig((prev) => ({
                      ...prev,
                      additionalEvery: Number(e.target.value) || 1,
                    }))
                  }
                  title="Additional discard every N races"
                />
              </div>
              <small style={{ color: '#5D6D7E' }}>
                Same logic for Finals: N1/N2/N3 define when discards start and how they grow.
              </small>
              <small style={{ color: '#5D6D7E', display: 'block' }}>
                {getDiscardSummary(finalDiscardConfig)}
              </small>
              <small style={{ color: '#5D6D7E', display: 'block' }}>
                {getDiscardExamples(finalDiscardConfig)}
              </small>
            </label>
          </div>
        </div>
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
                            <option value="standard">Standard SHRS 5.4</option>
                            <option value="custom">Custom thresholds</option>
                          </select>
                          <div style={discardGridStyle}>
                            <input
                              type="number"
                              min="1"
                              disabled={
                                editQualifyingDiscardLocked ||
                                editQualifyingDiscardMode !== 'custom'
                              }
                              value={editQualifyingDiscardConfig.firstDiscardAt}
                              onChange={(e) =>
                                setEditQualifyingDiscardConfig((prev) => ({
                                  ...prev,
                                  firstDiscardAt: Number(e.target.value) || 1,
                                }))
                              }
                              title="First discard at N races"
                            />
                            <input
                              type="number"
                              min="2"
                              disabled={
                                editQualifyingDiscardLocked ||
                                editQualifyingDiscardMode !== 'custom'
                              }
                              value={
                                editQualifyingDiscardConfig.secondDiscardAt
                              }
                              onChange={(e) =>
                                setEditQualifyingDiscardConfig((prev) => ({
                                  ...prev,
                                  secondDiscardAt: Number(e.target.value) || 2,
                                }))
                              }
                              title="Second discard at N races"
                            />
                            <input
                              type="number"
                              min="1"
                              disabled={
                                editQualifyingDiscardLocked ||
                                editQualifyingDiscardMode !== 'custom'
                              }
                              value={
                                editQualifyingDiscardConfig.additionalEvery
                              }
                              onChange={(e) =>
                                setEditQualifyingDiscardConfig((prev) => ({
                                  ...prev,
                                  additionalEvery: Number(e.target.value) || 1,
                                }))
                              }
                              title="Additional discard every N races"
                            />
                          </div>
                          <small style={{ color: '#5D6D7E', display: 'block' }}>
                            {getDiscardSummary(editQualifyingDiscardConfig)}
                          </small>
                          <small style={{ color: '#5D6D7E', display: 'block' }}>
                            {getDiscardExamples(editQualifyingDiscardConfig)}
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
                              handleEditFinalDiscardModeChange(
                                e.target.value,
                              )
                            }
                          >
                            <option value="standard">Standard SHRS 5.4</option>
                            <option value="custom">Custom thresholds</option>
                          </select>
                          <div style={discardGridStyle}>
                            <input
                              type="number"
                              min="1"
                              disabled={
                                editFinalDiscardLocked ||
                                editFinalDiscardMode !== 'custom'
                              }
                              value={editFinalDiscardConfig.firstDiscardAt}
                              onChange={(e) =>
                                setEditFinalDiscardConfig((prev) => ({
                                  ...prev,
                                  firstDiscardAt: Number(e.target.value) || 1,
                                }))
                              }
                              title="First discard at N races"
                            />
                            <input
                              type="number"
                              min="2"
                              disabled={
                                editFinalDiscardLocked ||
                                editFinalDiscardMode !== 'custom'
                              }
                              value={editFinalDiscardConfig.secondDiscardAt}
                              onChange={(e) =>
                                setEditFinalDiscardConfig((prev) => ({
                                  ...prev,
                                  secondDiscardAt: Number(e.target.value) || 2,
                                }))
                              }
                              title="Second discard at N races"
                            />
                            <input
                              type="number"
                              min="1"
                              disabled={
                                editFinalDiscardLocked ||
                                editFinalDiscardMode !== 'custom'
                              }
                              value={editFinalDiscardConfig.additionalEvery}
                              onChange={(e) =>
                                setEditFinalDiscardConfig((prev) => ({
                                  ...prev,
                                  additionalEvery: Number(e.target.value) || 1,
                                }))
                              }
                              title="Additional discard every N races"
                            />
                          </div>
                          <small style={{ color: '#5D6D7E', display: 'block' }}>
                            {getDiscardSummary(editFinalDiscardConfig)}
                          </small>
                          <small style={{ color: '#5D6D7E', display: 'block' }}>
                            {getDiscardExamples(editFinalDiscardConfig)}
                          </small>
                          {editFinalDiscardLocked && (
                            <small style={{ color: '#6B849A' }}>
                              Locked after first final race.
                            </small>
                          )}
                        </label>
                      </div>
                    </div>
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
