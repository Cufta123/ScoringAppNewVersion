import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import EventForm, { EventList } from '../../components/EventForm';
import Navbar from '../../components/Navbar';
import { reportError } from '../../utils/userFeedback';
import './LandingPage.css';

function LandingPage() {
  const navigate = useNavigate();
  // null = not loaded yet; [] = loaded and empty
  const [events, setEvents] = useState(null);

  const refreshEvents = useCallback(async () => {
    try {
      const allEvents = await window.electron.sqlite.eventDB.readAllEvents();
      setEvents(Array.isArray(allEvents) ? allEvents : []);
    } catch (error) {
      reportError('Could not load events.', error);
      setEvents([]);
    }
  }, []);

  useEffect(() => {
    refreshEvents();
  }, [refreshEvents]);

  const isFirstRun = Array.isArray(events) && events.length === 0;

  return (
    <div>
      <Navbar onOpenGlobalLeaderboard={() => navigate('/global-leaderboard')} />

      <main id="main-content" className="landing-page" tabIndex={-1}>
        {/* ── Hero ─── */}
        <div className="landing-hero">
          <h1>
            <i className="fa fa-anchor" aria-hidden="true" />
            IOM Regatta Manager
          </h1>
          <p>Sailing event management &amp; race scoring</p>
        </div>

        {/* ── Existing events — the common case comes first ─── */}
        {Array.isArray(events) && events.length > 0 && (
          <div className="landing-card">
            <h2>
              <i className="fa fa-list" aria-hidden="true" />
              Your Events
            </h2>
            <EventList events={events} onEventsChanged={refreshEvents} />
          </div>
        )}

        {/* ── Create event ─── */}
        <div className="landing-card">
          <h2>
            <i className="fa fa-plus-circle" aria-hidden="true" />
            Create a New Event
          </h2>
          <EventForm onEventCreated={refreshEvents} />
        </div>

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
                <strong>Create heats</strong> on the event page, then go to{' '}
                <em>Heat Race</em> to score each race.
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
