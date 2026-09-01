import React, { useState } from 'react';
import { reportError, reportInfo } from '../utils/userFeedback';
import { eventDB } from '../api/db';
import useEventSettings from '../hooks/useEventSettings';
import AdvancedEventSettings from './AdvancedEventSettings';

interface EventFormProps {
  onEventCreated?: (() => void) | null;
}

function EventForm({ onEventCreated = null }: EventFormProps) {
  const [eventName, setEventName] = useState('');
  const [eventLocation, setEventLocation] = useState('');
  const [eventStartDate, setEventStartDate] = useState('');
  const [eventEndDate, setEventEndDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const settings = useEventSettings();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Prevent a second create while the first round-trip is still in flight.
    if (submitting) return;

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
      const existingEvents = await eventDB.readAllEvents();
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

    const invalid = settings.validate();
    if (invalid) {
      reportInfo(
        invalid.message,
        invalid.series === 'qualifying'
          ? 'Invalid qualifying thresholds'
          : 'Invalid final thresholds',
      );
      return;
    }

    setSubmitting(true);
    try {
      // Store the trimmed values so what's saved matches what the duplicate
      // check above normalized — otherwise a stray trailing space passes the
      // check yet is written into the name that keys the /event/:name route.
      await eventDB.insertEvent(
        eventName.trim(),
        eventLocation.trim(),
        eventStartDate,
        eventEndDate,
        ...settings.toEventFields(),
      );
      setEventName('');
      setEventLocation('');
      setEventStartDate('');
      setEventEndDate('');
      settings.reset();
      if (onEventCreated) onEventCreated();
    } catch (error) {
      reportError('Could not create the event.', error);
    } finally {
      setSubmitting(false);
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
          checked={settings.advancedEnabled}
          onChange={(e) => settings.setAdvancedEnabled(e.target.checked)}
        />
        Advanced SHRS options
      </label>

      <AdvancedEventSettings idPrefix="create" settings={settings} />

      <button type="submit" className="btn-success" disabled={submitting}>
        {submitting ? (
          <>
            <i className="fa fa-spinner fa-spin" aria-hidden="true" /> Creating…
          </>
        ) : (
          <>
            <i className="fa fa-plus-circle" aria-hidden="true" /> Create Event
          </>
        )}
      </button>
    </form>
  );
}

export default EventForm;
