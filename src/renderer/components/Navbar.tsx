import React, { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import HelpModal from './shared/HelpModal';
import EventHistoryDialog from './EventHistoryDialog';

interface NavbarProps {
  onOpenLeaderboard?: (() => void) | null;
  onHeatRaceClick?: (() => void) | null;
  onNavigateHome?: (() => void) | null;
  /** Shows the History button for this event. */
  historyEventId?: number | null;
}

function Navbar({
  onOpenLeaderboard = null,
  onHeatRaceClick = null,
  onNavigateHome = null,
  historyEventId = null,
}: NavbarProps) {
  const navigate = useNavigate();
  const [helpOpen, setHelpOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Pages with unsaved work (e.g. the leaderboard editor) pass their own
  // handler so the brand button goes through the same discard-changes guard as
  // the breadcrumbs instead of navigating away and silently dropping edits.
  const goHome = onNavigateHome || (() => navigate('/'));
  const closeHistory = useCallback(() => setHistoryOpen(false), []);

  return (
    <nav className="app-navbar">
      {/* Brand — always visible, clicking takes you home */}
      <button
        type="button"
        className="app-navbar-brand"
        onClick={goHome}
        aria-label="Go to home page"
      >
        <i className="fa fa-anchor" aria-hidden="true" />
        IOM Regatta Manager
      </button>

      {/* Right: contextual action buttons */}
      {onOpenLeaderboard && (
        <button
          type="button"
          onClick={onOpenLeaderboard}
          aria-label="Open leaderboard"
        >
          <i className="fa fa-trophy" aria-hidden="true" />
          Leaderboard
        </button>
      )}

      {onHeatRaceClick && (
        <button
          type="button"
          className="btn-success"
          onClick={onHeatRaceClick}
          aria-label="Go to scoring"
        >
          <i className="fa fa-flag-checkered" aria-hidden="true" />
          Go to Scoring
        </button>
      )}

      {historyEventId != null && (
        <button
          type="button"
          onClick={() => setHistoryOpen(true)}
          aria-label="Open event history"
        >
          <i className="fa fa-clock-rotate-left" aria-hidden="true" />
          History
        </button>
      )}

      {/* Always available so help is reachable from every screen. */}
      <button
        type="button"
        className="app-navbar-help"
        onClick={() => setHelpOpen(true)}
        aria-label="Open help and glossary"
      >
        <i className="fa fa-circle-question" aria-hidden="true" />
        Help
      </button>

      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
      {historyEventId != null && (
        <EventHistoryDialog
          eventId={historyEventId}
          open={historyOpen}
          onClose={closeHistory}
        />
      )}
    </nav>
  );
}

export default Navbar;
