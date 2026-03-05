import React from 'react';
import { useNavigate } from 'react-router-dom';

const navBtnBase = {
  fontSize: '.85rem',
  padding: '8px 18px',
};

function Navbar({
  onBack,
  backLabel,
  onOpenLeaderboard,
  isEventLocked,
  onHeatRaceClick,
}) {
  const navigate = useNavigate();

  return (
    <nav
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        flexWrap: 'wrap',
        padding: '12px 28px',
        background: 'linear-gradient(90deg, #0F2D4A 0%, #173B5E 100%)',
        marginBottom: '24px',
        boxShadow: '0 2px 12px rgba(15,45,74,.25)',
      }}
    >
      {/* Left: back button (if any) */}
      {onBack && (
        <button
          type="button"
          className="btn-secondary"
          style={navBtnBase}
          onClick={onBack}
        >
          <i className="fa fa-arrow-left" aria-hidden="true" style={{ marginRight: '6px' }} />
          {backLabel || 'Back'}
        </button>
      )}

      {/* Brand — always visible, clicking takes you home */}
      <button
        type="button"
        onClick={() => navigate('/')}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: '#fff',
          fontWeight: '800',
          fontSize: '1.15rem',
          letterSpacing: '-.2px',
          display: 'flex',
          alignItems: 'center',
          gap: '9px',
          opacity: '.95',
          padding: 0,
          marginRight: 'auto',
        }}
      >
        <i className="fa fa-anchor" aria-hidden="true" />
        ScoringApp
      </button>

      {/* Right: action buttons */}
      {onOpenLeaderboard && (
        <button type="button" style={navBtnBase} onClick={onOpenLeaderboard}>
          <i className="fa fa-trophy" aria-hidden="true" style={{ marginRight: '6px' }} />
          Leaderboard
        </button>
      )}

      {onHeatRaceClick && !isEventLocked && (
        <button
          type="button"
          className="btn-success"
          style={navBtnBase}
          onClick={onHeatRaceClick}
        >
          <i className="fa fa-flag-checkered" aria-hidden="true" style={{ marginRight: '6px' }} />
          Go to Scoring
        </button>
      )}
    </nav>
  );
}

export default Navbar;
