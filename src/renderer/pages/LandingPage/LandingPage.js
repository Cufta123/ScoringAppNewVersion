/* eslint-disable prettier/prettier */
// src/pages/LandingPage/LandingPage.js
import React, { useState, } from 'react';
import EventForm from '../../components/EventForm';
import GlobalLeaderboardComponent from '../../components/GlobalLeaderboard';
import Navbar from '../../components/Navbar';
import Breadcrumbs from '../../components/shared/Breadcrumbs';
import './LandingPage.css';


function LandingPage() {
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  if (showLeaderboard) {
    return (
      <div>
        <Navbar
          onBack={() => setShowLeaderboard(false)}
          backLabel="Back to Home"
        />
        <main id="main-content" className="page-wrapper" tabIndex={-1}>
          <Breadcrumbs
            items={[
              { label: 'Home', onClick: () => setShowLeaderboard(false) },
              { label: 'Global Leaderboard' },
            ]}
          />
          <GlobalLeaderboardComponent />
        </main>
      </div>
    );
  }

  return (
    <main id="main-content" className="landing-page" tabIndex={-1}>
      <Navbar />

      {/* ── Hero ─── */}
      <div className="landing-hero">
        <p>Sailing event management &amp; race scoring</p>
      </div>

      {/* ── Global leaderboard shortcut ─── */}
      <div className="landing-actions">
        <button type="button" onClick={() => setShowLeaderboard(true)}>
          <i className="fa fa-trophy" aria-hidden="true" /> View Global Leaderboard
        </button>
      </div>

      {/* ── Create event ─── */}
      <div className="landing-card">
        <h2 style={{ marginTop: 0 }}>
          <i className="fa fa-plus-circle" aria-hidden="true" style={{ marginRight: '8px' }} />
          Create a New Event
        </h2>
        <EventForm />
      </div>

    </main>
  );
}

export default LandingPage;
