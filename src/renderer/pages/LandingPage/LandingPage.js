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

      {/* ── How it works ─── */}
      <div
        className="landing-card"
        aria-label="How it works"
        style={{ padding: '16px 20px' }}
      >
        <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>
          <i className="fa fa-map-signs" aria-hidden="true" style={{ marginRight: '8px' }} />
          How it works
        </h2>
        <ol style={{ margin: 0, paddingLeft: '22px', lineHeight: 1.7 }}>
          <li>
            <strong>Create an event</strong> below with its name, place and dates.
          </li>
          <li>
            <strong>Open the event</strong> and add sailors &amp; boats (one by one, or import a CSV file).
          </li>
          <li>
            <strong>Create heats</strong> on the event page, then go to <em>Heat Race</em> to score each race.
          </li>
          <li>
            <strong>Check the leaderboard</strong> at any time — and lock the event when racing is finished.
          </li>
        </ol>
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
