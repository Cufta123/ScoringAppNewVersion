/* eslint-disable prettier/prettier */
// src/pages/LandingPage/LandingPage.js
import React, { useState, } from 'react';
import EventForm from '../../components/EventForm';
import GlobalLeaderboardComponent from '../../components/GlobalLeaderboard';


function LandingPage() {
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  console.log("LandingPage component rendered");

  const handleOpenLeaderboard = () => {
    setShowLeaderboard(true);
  };

  const handleCloseLeaderboard = () => {
    setShowLeaderboard(false);
  };
  if (showLeaderboard) {
    return (
      <div>
        <button type="button" onClick={handleCloseLeaderboard}>
          Back
        </button>
        <GlobalLeaderboardComponent />
      </div>
    );
  }

  return (
    <div>
      <button type="button" onClick={handleOpenLeaderboard}>
        Open Leaderboard
      </button>
      <h1>Create a New Event</h1>
      <EventForm />
    </div>
  );
}

export default LandingPage;
