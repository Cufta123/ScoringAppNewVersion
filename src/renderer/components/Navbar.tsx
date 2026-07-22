import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import HelpModal from './shared/HelpModal';

interface NavbarProps {
  onOpenGlobalLeaderboard?: (() => void) | null;
  onOpenLeaderboard?: (() => void) | null;
  onHeatRaceClick?: (() => void) | null;
  onNavigateHome?: (() => void) | null;
}

function Navbar({
  onOpenGlobalLeaderboard = null,
  onOpenLeaderboard = null,
  onHeatRaceClick = null,
  onNavigateHome = null,
}: NavbarProps) {
  const navigate = useNavigate();
  const [helpOpen, setHelpOpen] = useState(false);

  // Pages with unsaved work (e.g. the leaderboard editor) pass their own
  // handler so the brand button goes through the same discard-changes guard as
  // the breadcrumbs instead of navigating away and silently dropping edits.
  const goHome = onNavigateHome || (() => navigate('/'));

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
      {onOpenGlobalLeaderboard && (
        <button
          type="button"
          onClick={onOpenGlobalLeaderboard}
          aria-label="Open global leaderboard"
        >
          <i className="fa fa-trophy" aria-hidden="true" />
          Global Leaderboard
        </button>
      )}

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
    </nav>
  );
}

export default Navbar;
