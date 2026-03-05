import React from 'react';
import { useNavigate } from 'react-router-dom';

const navStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  flexWrap: 'wrap',
  padding: '12px 28px',
  background: 'linear-gradient(90deg, #0F2D4A 0%, #173B5E 100%)',
  marginBottom: '24px',
  boxShadow: '0 2px 12px rgba(15,45,74,.25)',
};

const brandStyle = {
  color: '#fff',
  fontWeight: '800',
  fontSize: '1.15rem',
  letterSpacing: '-.2px',
  marginRight: 'auto',
  display: 'flex',
  alignItems: 'center',
  gap: '9px',
  opacity: '.95',
};

const navBtnBase = {
  fontSize: '.85rem',
  padding: '8px 18px',
};

const Navbar = ({
  onBack,
  backLabel,
  onOpenLeaderboard,
  isEventLocked,
  onHeatRaceClick,
}) => {
  const navigate = useNavigate();

  return (
    <nav style={navStyle}>
      <span style={brandStyle}>
        <i className="fa fa-anchor" aria-hidden="true" />
        ScoringApp
      </span>

      {/* Back button — shown when onBack is provided */}
      {onBack && (
        <button
          type="button"
          className="btn-secondary"
          style={navBtnBase}
          onClick={onBack}
        >
          <i className="fa fa-arrow-left" aria-hidden="true" />{' '}
          {backLabel || 'Back'}
        </button>
      )}

      {/* Home button — shown when no back button is active */}
      {!onBack && (
        <button
          type="button"
          className="btn-secondary"
          style={navBtnBase}
          onClick={() => navigate('/')}
        >
          <i className="fa fa-home" aria-hidden="true" /> Home
        </button>
      )}

      {onOpenLeaderboard && (
        <button type="button" style={navBtnBase} onClick={onOpenLeaderboard}>
          <i className="fa fa-trophy" aria-hidden="true" /> Leaderboard
        </button>
      )}

      {onHeatRaceClick && !isEventLocked && (
        <button
          type="button"
          className="btn-success"
          style={navBtnBase}
          onClick={onHeatRaceClick}
        >
          <i className="fa fa-flag-checkered" aria-hidden="true" /> Go to
          Scoring
        </button>
      )}
    </nav>
  );
};

export default Navbar;
