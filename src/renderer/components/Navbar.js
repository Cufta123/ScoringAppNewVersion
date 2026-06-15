import React from 'react';
import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';

function Navbar({
  onOpenGlobalLeaderboard = null,
  onOpenLeaderboard = null,
  onHeatRaceClick = null,
  onNavigateHome = null,
}) {
  const navigate = useNavigate();

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
    </nav>
  );
}

Navbar.propTypes = {
  onOpenGlobalLeaderboard: PropTypes.func,
  onOpenLeaderboard: PropTypes.func,
  onHeatRaceClick: PropTypes.func,
  onNavigateHome: PropTypes.func,
};

export default Navbar;
