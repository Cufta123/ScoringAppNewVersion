/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { render } from '@testing-library/react';

jest.mock('../renderer/pages/LandingPage/LandingPage', () => () => <div>Landing Page Mock</div>);
jest.mock('../renderer/pages/EventPage/EventPage', () => () => <div>Event Page Mock</div>);
jest.mock('../renderer/pages/HeatRacePage/HeatRacePage', () => () => <div>Heat Race Page Mock</div>);
jest.mock('../renderer/pages/LeaderboardPage/LeaderboardPage', () => () => (
  <div>Leaderboard Page Mock</div>
));

import App from '../renderer/App';

describe('App', () => {
  it('should render', () => {
    expect(render(<App />)).toBeTruthy();
  });
});
