import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import HelpModal from './shared/HelpModal';
import HelpMenu from './HelpMenu';
import EventHistoryDialog from './EventHistoryDialog';
import {
  requestProblemReport,
  setReportEventContext,
} from '../utils/problemReport';
import type { EventRow } from '../types';

/** The three screens of an event, in the order a regatta uses them. */
export type EventSection = 'entries' | 'scoring' | 'leaderboard';

const SECTIONS: {
  id: EventSection;
  label: string;
  icon: string;
  path: (eventName: string) => string;
}[] = [
  {
    id: 'entries',
    label: 'Entries',
    icon: 'fa-users',
    path: (name) => `/event/${name}`,
  },
  {
    id: 'scoring',
    label: 'Scoring',
    icon: 'fa-flag-checkered',
    path: (name) => `/event/${name}/heat-race`,
  },
  {
    id: 'leaderboard',
    label: 'Leaderboard',
    icon: 'fa-trophy',
    path: (name) => `/event/${name}/leaderboard`,
  },
];

interface NavbarProps {
  /** The event this page is about: shows its sections and History. */
  event?: Pick<EventRow, 'event_id' | 'event_name'> | null;
  /** Which section is open (highlighted, not clickable). */
  section?: EventSection | null;
  /**
   * Pages with unsaved work (the scoring entry, the leaderboard editor) pass
   * their discard-changes check: every navigation from the bar runs through
   * it.
   */
  guardNavigation?: ((go: () => void) => void) | null;
}

/**
 * The top bar. Left: the app (home) and the event's three sections, the
 * main way around an event. Right, quieter: History and the Help menu
 * (help and "Report a problem"), which are needed now and then.
 */
function Navbar({
  event = null,
  section = null,
  guardNavigation = null,
}: NavbarProps) {
  const navigate = useNavigate();
  const [helpOpen, setHelpOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const eventId = event?.event_id ?? null;

  const go = (action: () => void) =>
    guardNavigation ? guardNavigation(action) : action();
  const closeHistory = useCallback(() => setHistoryOpen(false), []);

  // A problem report from this page is about this page's event.
  useEffect(() => {
    setReportEventContext(eventId);
  }, [eventId]);

  return (
    <header className="app-navbar">
      <button
        type="button"
        className="app-navbar-brand"
        onClick={() => go(() => navigate('/'))}
        aria-label="Go to home page"
      >
        <i className="fa fa-anchor" aria-hidden="true" />
        <span className="app-navbar-brand-name">IOM Regatta Manager</span>
      </button>

      {event && (
        <nav className="app-navbar-sections" aria-label="Event sections">
          {SECTIONS.map((item) => {
            const current = item.id === section;
            return (
              <button
                key={item.id}
                type="button"
                className="app-navbar-section"
                aria-current={current ? 'page' : undefined}
                onClick={() => {
                  if (current) return;
                  go(() =>
                    navigate(item.path(event.event_name), {
                      state: { event },
                    }),
                  );
                }}
              >
                <i className={`fa ${item.icon}`} aria-hidden="true" />
                {item.label}
              </button>
            );
          })}
        </nav>
      )}

      <div className="app-navbar-tools">
        {eventId != null && (
          <button
            type="button"
            className="app-navbar-tool"
            onClick={() => setHistoryOpen(true)}
            aria-label="Open history and backups"
            title="Every change, with undo, and the event's backup file"
          >
            <i className="fa fa-clock-rotate-left" aria-hidden="true" />
            <span className="app-navbar-tool-label">History</span>
          </button>
        )}
        <HelpMenu
          onOpenHelp={() => setHelpOpen(true)}
          onReportProblem={requestProblemReport}
        />
      </div>

      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
      {eventId != null && (
        <EventHistoryDialog
          eventId={eventId}
          open={historyOpen}
          onClose={closeHistory}
        />
      )}
    </header>
  );
}

export default Navbar;
