/* eslint-disable prettier/prettier */
// src/pages/LandingPage/LandingPage.js
import React, { useState, } from 'react';
import EventForm from '../../components/EventForm';
import GlobalLeaderboardComponent from '../../components/GlobalLeaderboard';
import Navbar from '../../components/Navbar';
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
        <div className="page-wrapper">
          <GlobalLeaderboardComponent />
        </div>
      </div>
    );
  }

  return (
    <div className="landing-page">
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

    </div>
  );
}

export default LandingPage;
