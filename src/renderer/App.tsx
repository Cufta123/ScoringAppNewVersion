import React from 'react';
import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import '@fortawesome/fontawesome-free/css/all.min.css';
import './App.css';
import LandingPage from './pages/LandingPage/LandingPage';
import EventPage from './pages/EventPage/EventPage';
import HeatRacePage from './pages/HeatRacePage/HeatRacePage';
import LeaderboardPage from './pages/LeaderboardPage/LeaderboardPage';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/event/:name" element={<EventPage />} />
        <Route path="/event/:eventName/heat-race" element={<HeatRacePage />} />
        <Route
          path="/event/:eventName/leaderboard"
          element={<LeaderboardPage />}
        />
      </Routes>
    </Router>
  );
}

export default App;
