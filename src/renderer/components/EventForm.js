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
      console.log('Fetched events:', allEvents);
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
      const result = await window.electron.sqlite.eventDB.insertEvent(
        eventName,
        eventLocation,
        eventStartDate,
        eventEndDate,
      );
      console.log('Event inserted:', result);
      fetchEvents(); // Refresh the list of events after insertion
    } catch (error) {
      console.error('Error inserting event:', error);
    }
  };
  const handleEventClick = (event) => {
    navigate(`/event/${event.event_name}`, { state: { event } });
  };

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Name"
          value={eventName}
          onChange={(e) => setEventName(e.target.value)}
          required
        />
        <input
          type="text"
          placeholder="Location"
          value={eventLocation}
          onChange={(e) => setEventLocation(e.target.value)}
          required
        />
        <input
          type="date"
          placeholder="Start Date"
          value={eventStartDate}
          onChange={(e) => setEventStartDate(e.target.value)}
          required
        />
        <input
          type="date"
          placeholder="End Date"
          value={eventEndDate}
          onChange={(e) => setEventEndDate(e.target.value)}
          required
        />
        <button type="submit">Create Event</button>
      </form>
      <div>
        <h2>Events List</h2>
        <ul>
          {events.map((event) => (
            <li key={event.event_id}>
              <button
                type="button"
                onClick={() => handleEventClick(event)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <strong>{event.event_name}</strong> - {event.event_location} (
                {event.start_date} to {event.end_date})
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default EventForm;
