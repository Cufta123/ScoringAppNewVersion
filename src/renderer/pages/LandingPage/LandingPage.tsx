import React, { useState, useEffect, useCallback } from 'react';
import EventForm from '../../components/EventForm';
import EventList from '../../components/EventList';
import Navbar from '../../components/Navbar';
import { reportError, reportInfo } from '../../utils/userFeedback';
import useExclusiveAction from '../../hooks/useExclusiveAction';
import './LandingPage.css';
import { eventDB, heatRaceDB } from '../../api/db';
import type { EventRow } from '../../types';

function LandingPage() {
  // null = not loaded yet; [] = loaded and empty
  const [events, setEvents] = useState<EventRow[] | null>(null);
  // Distinguish "load failed" from "no events yet" — otherwise a failed read
  // would show the first-run onboarding and make the user think their events
  // are gone.
  const [loadFailed, setLoadFailed] = useState(false);

  const refreshEvents = useCallback(async () => {
    try {
      const allEvents = await eventDB.readAllEvents();
      setEvents(Array.isArray(allEvents) ? allEvents : []);
      setLoadFailed(false);
    } catch (error) {
      reportError('Could not load your events.', error);
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    refreshEvents();
  }, [refreshEvents]);

  // A backup file as a new event: from another computer, or an event that
  // was deleted after "Back up, then delete".
  const { busy: importing, runExclusive } = useExclusiveAction();
  const importEvent = () =>
    runExclusive(async () => {
      try {
        const result = await heatRaceDB.importEventSnapshotFromFile();
        if (result?.canceled) return;
        await refreshEvents();
        reportInfo(
          `"${result?.eventName}" was added from the backup file, with its sailors, heats and results.`,
          'Event imported',
        );
      } catch (error) {
        reportError('Could not import the event.', error);
      }
    });

  const isFirstRun =
    !loadFailed && Array.isArray(events) && events.length === 0;
  const hasEvents = Array.isArray(events) && events.length > 0;
  // The create form opens from "New event"; before the first event it is
  // simply there.
  const [creating, setCreating] = useState(false);
  const formOpen = isFirstRun || creating;
  const onEventCreated = useCallback(async () => {
    setCreating(false);
    await refreshEvents();
  }, [refreshEvents]);

  return (
    <div>
      <Navbar />

      <main id="main-content" className="landing-page" tabIndex={-1}>
        {/* ── Page header: the events, and the two ways to add one ─── */}
        <header className="landing-header">
          <div>
            <h1>Events</h1>
            <p>Sailing event management &amp; race scoring</p>
          </div>
          {Array.isArray(events) && (
            <div className="landing-header-actions">
              <button
                type="button"
                className="btn-ghost"
                onClick={importEvent}
                disabled={importing}
                title="A backup file from this or another computer is added as a new event."
              >
                <i className="fa fa-file-import" aria-hidden="true" /> Import
                from backup…
              </button>
              {hasEvents && !creating && (
                <button
                  type="button"
                  className="btn-success"
                  onClick={() => setCreating(true)}
                >
                  <i className="fa fa-plus" aria-hidden="true" /> New event
                </button>
              )}
            </div>
          )}
        </header>

        {/* ── Load failure — offer a retry instead of pretending there are no
            events (which would show the first-run onboarding) ─── */}
        {loadFailed && (
          <div className="landing-card landing-load-error" role="alert">
            <h2>
              <i className="fa fa-triangle-exclamation" aria-hidden="true" />
              Could not load your events
            </h2>
            <p>
              Your events may still be saved — the app just couldn’t read them
              right now. Please try again.
            </p>
            <button
              type="button"
              className="btn-success"
              onClick={refreshEvents}
            >
              <i className="fa fa-rotate-right" aria-hidden="true" /> Retry
            </button>
          </div>
        )}

        {/* ── Create event (opened from "New event") ─── */}
        {formOpen && (
          <section
            className="landing-card"
            aria-labelledby="create-event-title"
          >
            <div className="landing-card-head">
              <h2 id="create-event-title">
                <i className="fa fa-plus-circle" aria-hidden="true" />
                Create a New Event
              </h2>
              {creating && (
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => setCreating(false)}
                >
                  Cancel
                </button>
              )}
            </div>
            <EventForm onEventCreated={onEventCreated} />
          </section>
        )}

        {/* ── Existing events ─── */}
        {hasEvents && (
          <section className="landing-card" aria-label="Your events">
            <EventList events={events} onEventsChanged={refreshEvents} />
          </section>
        )}

        {/* ── How it works — onboarding, shown only before the first event ─── */}
        {isFirstRun && (
          <div className="landing-card" aria-label="How it works">
            <h2>
              <i className="fa fa-map-signs" aria-hidden="true" />
              How it works
            </h2>
            <ol className="landing-steps">
              <li>
                <strong>Create an event</strong> above with its name, place and
                dates.
              </li>
              <li>
                <strong>Open the event</strong> and add sailors &amp; boats (one
                by one, or import a CSV file).
              </li>
              <li>
                <strong>Create heats</strong> on the Scoring page, then score
                each race there.
              </li>
              <li>
                <strong>Check the leaderboard</strong> at any time — and print
                the starting list, heats and results in PDF, Excel or HTML.
              </li>
            </ol>
          </div>
        )}
      </main>
    </div>
  );
}

export default LandingPage;
