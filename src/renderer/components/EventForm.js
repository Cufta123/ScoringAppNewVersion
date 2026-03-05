import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

function EventForm() {
  const [eventName, setEventName] = useState('');
  const [eventLocation, setEventLocation] = useState('');
  const [eventStartDate, setEventStartDate] = useState('');
  const [eventEndDate, setEventEndDate] = useState('');
  const [events, setEvents] = useState([]);
  const navigate = useNavigate();

  const fetchEvents = async () => {
    try {
      const allEvents = await window.electron.sqlite.eventDB.readAllEvents();
      setEvents(Array.isArray(allEvents) ? allEvents : []);
    } catch (error) {
      console.error('Error fetching events:', error);
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
      console.error('Error inserting event:', error);
    }
  };

  const handleEventClick = (event) => {
    navigate(`/event/${event.event_name}`, { state: { event } });
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
              <button
                key={event.event_id}
                type="button"
                className="event-list-item"
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
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default EventForm;
