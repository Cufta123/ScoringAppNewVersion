import React from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../../components/Navbar';
import Breadcrumbs from '../../components/shared/Breadcrumbs';
import GlobalLeaderboardComponent from '../../components/GlobalLeaderboard';

function GlobalLeaderboardPage() {
  const navigate = useNavigate();

  return (
    <div>
      <Navbar />
      <main id="main-content" className="page-wrapper" tabIndex={-1}>
        <Breadcrumbs
          items={[
            { label: 'Home', onClick: () => navigate('/') },
            { label: 'Global Leaderboard' },
          ]}
        />
        <GlobalLeaderboardComponent />
      </main>
    </div>
  );
}

export default GlobalLeaderboardPage;
