import React from 'react';
import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';

function Navbar({
  onOpenGlobalLeaderboard,
  onOpenLeaderboard,
  isEventLocked,
  onHeatRaceClick,
}) {
  const navigate = useNavigate();

  return (
    <nav className="app-navbar">
      {/* Brand — always visible, clicking takes you home */}
      <button
        type="button"
        className="app-navbar-brand"
        onClick={() => navigate('/')}
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

      {onHeatRaceClick && !isEventLocked && (
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
  isEventLocked: PropTypes.bool,
  onHeatRaceClick: PropTypes.func,
};

Navbar.defaultProps = {
  onOpenGlobalLeaderboard: null,
  onOpenLeaderboard: null,
  isEventLocked: false,
  onHeatRaceClick: null,
};

export default Navbar;
