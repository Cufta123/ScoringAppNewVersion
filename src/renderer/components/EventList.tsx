import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  confirmAction,
  confirmChoice,
  reportError,
  reportInfo,
} from '../utils/userFeedback';
import { eventDB, heatRaceDB } from '../api/db';
import type { EventRow } from '../types';
import useEventSettings, {
  reportInvalidSettings,
} from '../hooks/useEventSettings';
import { formatEventDateRange } from '../utils/formatDate';
import AdvancedEventSettings from './AdvancedEventSettings';
import {
  getAssignmentLabel,
  getOverflowPolicyLabel,
} from '../utils/discardProfileForm';

interface EventListProps {
  events: EventRow[];
  onEventsChanged?: (() => void) | null;
}

export default function EventList({
  events,
  onEventsChanged = null,
}: EventListProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editStartDate, setEditStartDate] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const settings = useEventSettings();
  // Snapshot of the values an edit session started with, so we can tell whether
  // the user has actually changed anything before silently discarding an
  // in-progress edit when they jump to another row.
  const editBaselineRef = useRef<Record<string, unknown> | null>(null);

  const navigate = useNavigate();

  const currentEditSnapshot = (): Record<string, unknown> => ({
    name: editName,
    location: editLocation,
    start: editStartDate,
    end: editEndDate,
    advanced: settings.advancedEnabled,
    assignment: settings.assignmentMode,
    qMode: settings.qualifying.mode,
    qInput: settings.qualifying.input,
    fMode: settings.final.mode,
    fInput: settings.final.input,
    overflow: settings.heatOverflowPolicy,
  });

  const hasUnsavedEdits = (): boolean => {
    if (editingId == null || editBaselineRef.current == null) return false;
    return (
      JSON.stringify(currentEditSnapshot()) !==
      JSON.stringify(editBaselineRef.current)
    );
  };

  const handleEventClick = (event: EventRow) => {
    navigate(`/event/${event.event_name}`, { state: { event } });
  };

  const startEdit = async (e: React.MouseEvent, event: EventRow) => {
    e.stopPropagation();

    // Jumping straight from one row's unsaved edit into another would discard
    // the first with no warning — confirm before throwing that work away.
    if (
      editingId != null &&
      editingId !== event.event_id &&
      hasUnsavedEdits()
    ) {
      const proceed = await confirmAction(
        'You have unsaved changes to another event. Discard them and edit this one instead?',
        'Discard unsaved changes',
        { confirmLabel: 'Discard changes', confirmClassName: 'btn-danger' },
      );
      if (!proceed) return;
    }

    setEditingId(event.event_id);
    setEditName(event.event_name);
    setEditLocation(event.event_location);
    setEditStartDate(event.start_date);
    setEditEndDate(event.end_date);
    // loadFrom returns what it loaded: state updates are async, so the values
    // cannot be read back off `settings` here.
    const loaded = settings.loadFrom(event);

    editBaselineRef.current = {
      name: event.event_name,
      location: event.event_location,
      start: event.start_date,
      end: event.end_date,
      advanced: loaded.advanced,
      assignment: loaded.assignment,
      qMode: loaded.qMode,
      qInput: loaded.qInput,
      fMode: loaded.fMode,
      fInput: loaded.fInput,
      overflow: loaded.overflow,
    };
  };

  const cancelEdit = () => {
    setEditingId(null);
    settings.setAdvancedEnabled(false);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId == null) return;

    // Prevent a second save while the update round-trip is still in flight.
    if (savingEdit) return;

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

    const invalid = settings.validate();
    if (invalid) {
      reportInvalidSettings(invalid);
      return;
    }

    setSavingEdit(true);
    try {
      // Store trimmed values so the saved name matches the rename-collision
      // check above (and never keys the route with trailing whitespace).
      await eventDB.updateEvent(
        editingId,
        editName.trim(),
        editLocation.trim(),
        editStartDate,
        editEndDate,
        ...settings.toEventFields(),
      );
      setEditingId(null);
      settings.setAdvancedEnabled(false);
      if (onEventsChanged) onEventsChanged();
    } catch (error) {
      reportError('Could not update the event.', error);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteEvent = async (e: React.MouseEvent, event: EventRow) => {
    e.stopPropagation();
    const eventId = event.event_id;

    // Echo the event name (so a misclick on the wrong row is obvious) and offer
    // a recovery path: save a backup file before the irreversible delete.
    const choice = await confirmChoice(
      `This permanently deletes "${event.event_name}" and all its sailors, heats, races and scores. This cannot be undone.\n\n` +
        'You can save a backup file first, so the event can be restored later if needed.',
      'Delete event',
      {
        confirmLabel: 'Delete permanently',
        extraLabel: 'Back up, then delete',
        cancelLabel: 'Keep event',
        confirmClassName: 'btn-danger',
        extraClassName: 'btn-success',
      },
    );

    if (choice === 'cancel') return;

    if (choice === 'extra') {
      try {
        const result = (await heatRaceDB.exportEventSnapshotToFile(
          eventId,
        )) as { canceled?: boolean };
        // If the user cancels the save dialog, abort the delete too — deleting
        // without the backup they just asked for would be the worst outcome.
        if (result?.canceled) return;
      } catch (error) {
        reportError(
          'Could not save the backup, so the event was NOT deleted. Please try again.',
          error,
        );
        return;
      }
    }

    try {
      await eventDB.deleteEvent(eventId);
      if (onEventsChanged) onEventsChanged();
      reportInfo('Event deleted successfully.', 'Success');
    } catch (error) {
      reportError('Could not delete the event.', error);
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
                  checked={settings.advancedEnabled}
                  onChange={(e) =>
                    settings.setAdvancedEnabled(e.target.checked)
                  }
                />
                Advanced SHRS options
              </label>

              <AdvancedEventSettings
                idPrefix={`edit-${event.event_id}`}
                settings={settings}
              />

              <div className="flex gap-2">
                <button
                  type="submit"
                  className="btn-success"
                  disabled={savingEdit}
                >
                  {savingEdit ? (
                    <>
                      <i className="fa fa-spinner fa-spin" aria-hidden="true" />{' '}
                      Saving…
                    </>
                  ) : (
                    <>
                      <i className="fa fa-check" aria-hidden="true" /> Save
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="btn-outline"
                  disabled={savingEdit}
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
                  {formatEventDateRange(event.start_date, event.end_date)}
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
                  handleDeleteEvent(e, event);
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
