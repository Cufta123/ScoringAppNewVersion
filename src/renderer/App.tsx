import React, { useEffect } from 'react';
import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import '@fortawesome/fontawesome-free/css/all.min.css';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import './App.css';
import LandingPage from './pages/LandingPage/LandingPage';
import EventPage from './pages/EventPage/EventPage';
import HeatRacePage from './pages/HeatRacePage/HeatRacePage';
import LeaderboardPage from './pages/LeaderboardPage/LeaderboardPage';
import { reportError } from './utils/userFeedback';

function App() {
  useEffect(() => {
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      reportError('Unexpected application error', event.reason);
    };

    const onWindowError = (event: ErrorEvent) => {
      reportError('Unexpected application error', event.error || event.message);
    };

    window.addEventListener('unhandledrejection', onUnhandledRejection);
    window.addEventListener('error', onWindowError);

    return () => {
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
      window.removeEventListener('error', onWindowError);
    };
  }, []);

  return (
    <Router>
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/event/:name" element={<EventPage />} />
        <Route path="/event/:eventName/heat-race" element={<HeatRacePage />} />
        <Route
          path="/event/:eventName/leaderboard"
          element={<LeaderboardPage />}
        />
      </Routes>
      <ToastContainer
        position="bottom-right"
        autoClose={3500}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        pauseOnFocusLoss
        draggable
        pauseOnHover
      />
    </Router>
  );
}

export default App;
