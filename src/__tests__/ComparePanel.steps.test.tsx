/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen } from './helpers/renderWithQuery';
import ComparePanel from '../renderer/components/leaderboard/ComparePanel';
import type { CompareInfo, LeaderboardEntry } from '../renderer/types';

const boat = (id: number, name: string) =>
  ({
    boat_id: id,
    name,
    surname: 'Test',
    races: [],
  }) as unknown as LeaderboardEntry;

const info = (overrides: Partial<CompareInfo>): CompareInfo => ({
  boatA: boat(1, 'Ana'),
  boatB: boat(2, 'Ivo'),
  totalA: 10,
  totalB: 10,
  tied: true,
  tieBreak: {
    steps: [
      {
        rule: 'RRS A8.1, SHRS 5.7(ii)(1)-(2)',
        note: 'In the races they sailed in the same heat: no difference.',
        resolved: false,
      },
      {
        rule: 'SHRS 5.7(ii)(3)',
        note: 'No rule separates these two directly, but other boats are tied with them.',
        resolved: true,
      },
    ],
    winner: boat(1, 'Ana'),
    rule: 'SHRS 5.7(ii)',
    detail: '',
  },
  routeStep: { rule: 'SHRS 5.7(ii)', note: 'Several heats.' },
  raceGrid: [],
  sharedRacePairs: [],
  sharedQualRacePairs: [],
  sharedIds: new Set(),
  sharedQualIds: new Set(),
  otherTiedCount: 1,
  tiedGroupEntries: [],
  ...overrides,
});

describe('ComparePanel: the rule steps', () => {
  it('shows an SHRS step when the route comes on its own (5.7(ii)(3))', () => {
    render(
      <ComparePanel show compareInfo={info({})} selectedBoatIds={[1, 2]} />,
    );
    expect(
      screen.getByText(/other boats are tied with them/),
    ).toBeInTheDocument();
    expect(screen.getByText('Several heats.')).toBeInTheDocument();
  });

  it('takes the route from the first SHRS step when none is sent', () => {
    const steps = [
      {
        rule: 'SHRS 5.7(i)',
        note: 'A single-heat event.',
        resolved: false,
      },
      {
        rule: 'RRS A8.1',
        note: 'Scores best first: no difference.',
        resolved: false,
      },
    ];
    render(
      <ComparePanel
        show
        compareInfo={info({
          routeStep: null,
          tieBreak: { steps, winner: null, rule: 'SHRS 5.7', detail: '' },
        })}
        selectedBoatIds={[1, 2]}
      />,
    );
    // Once, as the route, not again as a step.
    expect(screen.getAllByText('A single-heat event.')).toHaveLength(1);
    expect(screen.getByText(/Scores best first/)).toBeInTheDocument();
  });
});
