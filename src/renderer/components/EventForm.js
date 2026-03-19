import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { reportError } from '../utils/userFeedback';

function EventForm() {
  const [eventName, setEventName] = useState('');
  const [eventLocation, setEventLocation] = useState('');
  const [eventStartDate, setEventStartDate] = useState('');
  const [eventEndDate, setEventEndDate] = useState('');
  const [events, setEvents] = useState([]);

  // Edit state
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editStartDate, setEditStartDate] = useState('');
  const [editEndDate, setEditEndDate] = useState('');

  // Delete confirmation state
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

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
      );
      setEventName('');
      setEventLocation('');
      setEventStartDate('');
      setEventEndDate('');
      fetchEvents();
    } catch (error) {
      reportError('Could not create the event.', error);
    }
  };

  const handleEventClick = (event) => {
    navigate(`/event/${event.event_name}`, { state: { event } });
  };

  const startEdit = (e, event) => {
    e.stopPropagation();
    setEditingId(event.event_id);
    setEditName(event.event_name);
    setEditLocation(event.event_location);
    setEditStartDate(event.start_date);
    setEditEndDate(event.end_date);
    setConfirmDeleteId(null);
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
      );
      setEditingId(null);
      fetchEvents();
    } catch (error) {
      reportError('Could not update the event.', error);
    }
  };

  const handleDeleteConfirm = async (e) => {
    e.stopPropagation();
    try {
      await window.electron.sqlite.eventDB.deleteEvent(confirmDeleteId);
      setConfirmDeleteId(null);
      fetchEvents();
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
                      style={{ flex: 1 }}
                      onClick={() => handleEventClick(event)}
                    >
                      <span>
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

                    {/* Delete / confirm delete */}
                    {confirmDeleteId === event.event_id ? (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          flexShrink: 0,
                        }}
                      >
                        <span
                          style={{
                            fontSize: '0.85rem',
                            color: '#c0392b',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          Delete all data?
                        </span>
                        <button
                          type="button"
                          onClick={handleDeleteConfirm}
                          className="btn-danger btn-sm"
                        >
                          <i className="fa fa-trash" aria-hidden="true" /> Yes,
                          delete
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteId(null);
                          }}
                          className="btn-outline btn-sm"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        aria-label="Delete event"
                        title="Delete event"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(event.event_id);
                          setEditingId(null);
                        }}
                        className="btn-danger btn-sm"
                        style={{ flexShrink: 0 }}
                      >
                        <i className="fa fa-trash" aria-hidden="true" />
                      </button>
                    )}
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
