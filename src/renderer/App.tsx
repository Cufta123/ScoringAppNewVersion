import React, { useEffect } from 'react';
import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import '@fortawesome/fontawesome-free/css/all.min.css';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import './App.css';
import LandingPage from './pages/LandingPage/LandingPage';
import EventPage from './pages/EventPage/EventPage';
import HeatRacePage from './pages/HeatRacePage/HeatRacePage';
import LeaderboardPage from './pages/LeaderboardPage/LeaderboardPage';
import ConfirmDialogHost from './components/shared/ConfirmDialogHost';
import ErrorBoundary from './components/ErrorBoundary';
import { reportError, reportWarning } from './utils/userFeedback';

const BACKUP_TOAST = 'automatic-backup-status';

function App() {
  useEffect(() => {
    // Anything no screen caught itself. The reason (or, for a fault in the
    // app, a code that is also in the error log) is shown with it.
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      reportError('That did not work.', event.reason);
    };

    const onWindowError = (event: ErrorEvent) => {
      // Chromium reports this layout notice as an error; it is harmless.
      if (/ResizeObserver loop/.test(event.message ?? '')) return;
      // An error nothing caught is a fault in the app, whatever it says.
      reportError(
        'That did not work.',
        event.error instanceof Error
          ? event.error
          : new TypeError(String(event.message || 'window error')),
      );
    };

    window.addEventListener('unhandledrejection', onUnhandledRejection);
    window.addEventListener('error', onWindowError);

    // The automatic backups stopped working (disk full, folder not
    // writable): say so until they work again.
    const stopWatchingBackups = window.electron?.appEvents?.onBackupStatus(
      (status) => {
        if (status.ok) {
          toast.dismiss(BACKUP_TOAST);
          toast.success('Automatic backups are working again.');
          return;
        }
        reportWarning(
          `${status.reason ?? ''} Results are still saved, but no safety copies are being made until this is fixed.`.trim(),
          'Automatic backup failed',
          { toastId: BACKUP_TOAST },
        );
      },
    );

    // A toast that closes by itself (a warning whose problem is also marked on
    // the page) waits while the keyboard is on it, as it does for the pointer.
    const onFocusIn = (event: FocusEvent) => {
      if ((event.target as Element | null)?.closest?.('.Toastify__toast')) {
        toast.pause();
      }
    };
    const onFocusOut = (event: FocusEvent) => {
      if ((event.target as Element | null)?.closest?.('.Toastify__toast')) {
        toast.play();
      }
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);

    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
      window.removeEventListener('error', onWindowError);
      stopWatchingBackups?.();
    };
  }, []);

  return (
    <Router>
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/event/:name" element={<EventPage />} />
          <Route
            path="/event/:eventName/heat-race"
            element={<HeatRacePage />}
          />
          <Route
            path="/event/:eventName/leaderboard"
            element={<LeaderboardPage />}
          />
        </Routes>
      </ErrorBoundary>
      <ToastContainer
        position="bottom-left"
        // At most four on screen; identical ones are merged (userFeedback).
        // Any more wait their turn instead of covering the page.
        limit={4}
        autoClose={5000}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        pauseOnFocusLoss
        draggable
        pauseOnHover
      />
      <ConfirmDialogHost />
    </Router>
  );
}

export default App;
