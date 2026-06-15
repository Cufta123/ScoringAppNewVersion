/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { render } from '@testing-library/react';

import App from '../renderer/App';

jest.mock(
  '../renderer/pages/LandingPage/LandingPage',
  () =>
    function () {
      return <div>Landing Page Mock</div>;
    },
);
jest.mock(
  '../renderer/pages/EventPage/EventPage',
  () =>
    function () {
      return <div>Event Page Mock</div>;
    },
);
jest.mock(
  '../renderer/pages/HeatRacePage/HeatRacePage',
  () =>
    function () {
      return <div>Heat Race Page Mock</div>;
    },
);
jest.mock(
  '../renderer/pages/LeaderboardPage/LeaderboardPage',
  () =>
    function () {
      return <div>Leaderboard Page Mock</div>;
    },
);

describe('App', () => {
  it('should render', () => {
    expect(render(<App />)).toBeTruthy();
  });
});
