/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import HeatComponent from '../renderer/components/HeatComponent';
import { confirmAction, confirmChoice } from '../renderer/utils/userFeedback';

jest.mock(
  'react-world-flags',
  () =>
    function ReactWorldFlagsMock() {
      return <span data-testid="flag" />;
    },
);
jest.mock('../renderer/utils/printNewHeats', () => jest.fn(async () => {}));

const reportInfoMock = jest.fn();
const reportErrorMock = jest.fn();
jest.mock('../renderer/utils/userFeedback', () => ({
  ...jest.requireActual('../renderer/utils/userFeedback'),
  confirmAction: jest.fn(async () => true),
  confirmChoice: jest.fn(async () => 'confirm'),
  reportInfo: (...args) => reportInfoMock(...args),
  reportError: (...args) => reportErrorMock(...args),
}));

describe('HeatComponent start final series integration (UI + IPC chain)', () => {
  const confirmActionMock = confirmAction;
  const confirmChoiceMock = confirmChoice;

  beforeEach(() => {
    const readAllHeats = jest.fn().mockResolvedValue([
      { heat_id: 11, heat_name: 'Heat A1', heat_type: 'Qualifying' },
      { heat_id: 12, heat_name: 'Heat B1', heat_type: 'Qualifying' },
    ]);

    const readAllRaces = jest
      .fn()
      .mockResolvedValue([{ race_id: 301, race_number: 1 }]);
    const readBoatsByHeat = jest.fn().mockResolvedValue([
      {
        boat_id: 'B1',
        sail_number: 1,
        country: 'CRO',
        name: 'A',
        surname: 'A',
      },
      {
        boat_id: 'B2',
        sail_number: 2,
        country: 'CRO',
        name: 'B',
        surname: 'B',
      },
    ]);

    const startFinalSeriesAtomic = jest
      .fn()
      .mockResolvedValue({ success: true, createdHeats: 2, assignedBoats: 4 });
    const readLeaderboard = jest.fn().mockResolvedValue([]);
    // Eligibility is computed in the main process; the renderer only renders
    // prompts from it. Default: two fleets, one completed race, no Rule 4.3.
    const getFinalSeriesEligibility = jest.fn().mockResolvedValue({
      ok: true,
      reason: 'OK',
      numFinalHeats: 2,
      completedQualifyingRaces: 1,
      rule43Applies: false,
      noRacesCompleted: false,
      raceCountBreakdown: [
        { name: 'Heat A1', count: 1 },
        { name: 'Heat B1', count: 1 },
      ],
    });

    window.electron = {
      sqlite: {
        heatRaceDB: {
          readAllHeats,
          readBoatsByHeat,
          readAllRaces,
          readLeaderboard,
          startFinalSeriesAtomic,
          getFinalSeriesEligibility,
        },
      },
    };

    reportInfoMock.mockReset();
    reportErrorMock.mockReset();
    confirmActionMock.mockReset();
    confirmActionMock.mockResolvedValue(true);
    confirmChoiceMock.mockReset();
    confirmChoiceMock.mockResolvedValue('confirm');
  });

  afterEach(() => {
    delete window.electron;
  });

  it('starts final series through a single atomic backend IPC call', async () => {
    render(
      <HeatComponent
        event={{ event_id: 77 }}
        clickable={false}
        onHeatSelect={jest.fn()}
        onStartScoring={jest.fn()}
        onQualifyingGroupCountChange={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /start final series/i }),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('button', { name: /start final series/i }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole('dialog', { name: /start final series\?/i }),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('button', { name: /yes, start final series/i }),
    );

    await waitFor(() => {
      expect(
        window.electron.sqlite.heatRaceDB.startFinalSeriesAtomic,
      ).toHaveBeenCalledTimes(1);
    });

    expect(
      window.electron.sqlite.heatRaceDB.startFinalSeriesAtomic,
    ).toHaveBeenCalledWith(77, false, true);

    expect(reportErrorMock).not.toHaveBeenCalled();
    expect(reportInfoMock).toHaveBeenCalledWith(
      'Final Series started successfully!',
      'Success',
    );
  });

  it('asks for SHRS 2026-1 Rule 4.3 choice at 6 races and applies it when confirmed', async () => {
    window.electron.sqlite.heatRaceDB.getFinalSeriesEligibility = jest
      .fn()
      .mockResolvedValue({
        ok: true,
        reason: 'OK',
        numFinalHeats: 2,
        completedQualifyingRaces: 6,
        rule43Applies: true,
        noRacesCompleted: false,
        raceCountBreakdown: [
          { name: 'Heat A1', count: 6 },
          { name: 'Heat B1', count: 6 },
        ],
      });

    render(
      <HeatComponent
        event={{ event_id: 77 }}
        clickable={false}
        onHeatSelect={jest.fn()}
        onStartScoring={jest.fn()}
        onQualifyingGroupCountChange={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /start final series/i }),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('button', { name: /start final series/i }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole('dialog', { name: /start final series\?/i }),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('button', { name: /yes, start final series/i }),
    );

    await waitFor(() => {
      expect(confirmChoiceMock).toHaveBeenCalledWith(
        expect.stringContaining(
          'SHRS 2026-1 Rule 4.3 applies for 6-7 completed qualifying races.',
        ),
        'Apply SHRS 2026-1 Rule 4.3?',
        {
          confirmLabel: 'Apply Rule 4.3',
          extraLabel: 'Skip Rule 4.3',
          extraClassName: 'btn-secondary',
          cancelLabel: 'Cancel',
          confirmClassName: 'btn-success',
        },
      );
    });

    expect(
      window.electron.sqlite.heatRaceDB.startFinalSeriesAtomic,
    ).toHaveBeenCalledWith(77, false, true);
  });

  it('asks SHRS 4.3 choice before showing the final start confirmation modal', async () => {
    window.electron.sqlite.heatRaceDB.getFinalSeriesEligibility = jest
      .fn()
      .mockResolvedValue({
        ok: true,
        reason: 'OK',
        numFinalHeats: 2,
        completedQualifyingRaces: 6,
        rule43Applies: true,
        noRacesCompleted: false,
        raceCountBreakdown: [
          { name: 'Heat A1', count: 6 },
          { name: 'Heat B1', count: 6 },
        ],
      });

    let resolveShs43Choice;
    const shs43ChoicePromise = new Promise((resolve) => {
      resolveShs43Choice = resolve;
    });
    confirmChoiceMock.mockImplementation(() => shs43ChoicePromise);

    render(
      <HeatComponent
        event={{ event_id: 77 }}
        clickable={false}
        onHeatSelect={jest.fn()}
        onStartScoring={jest.fn()}
        onQualifyingGroupCountChange={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /start final series/i }),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('button', { name: /start final series/i }),
    );

    await waitFor(() => {
      expect(confirmChoiceMock).toHaveBeenCalledWith(
        expect.stringContaining(
          'SHRS 2026-1 Rule 4.3 applies for 6-7 completed qualifying races.',
        ),
        'Apply SHRS 2026-1 Rule 4.3?',
        {
          confirmLabel: 'Apply Rule 4.3',
          extraLabel: 'Skip Rule 4.3',
          extraClassName: 'btn-secondary',
          cancelLabel: 'Cancel',
          confirmClassName: 'btn-success',
        },
      );
    });

    expect(
      screen.queryByRole('dialog', { name: /start final series\?/i }),
    ).not.toBeInTheDocument();

    resolveShs43Choice('confirm');

    await waitFor(() => {
      expect(
        screen.getByRole('dialog', { name: /start final series\?/i }),
      ).toBeInTheDocument();
    });
  });

  it('skips temporary second exclusion when Skip Rule 4.3 is chosen', async () => {
    window.electron.sqlite.heatRaceDB.getFinalSeriesEligibility = jest
      .fn()
      .mockResolvedValue({
        ok: true,
        reason: 'OK',
        numFinalHeats: 2,
        completedQualifyingRaces: 6,
        rule43Applies: true,
        noRacesCompleted: false,
        raceCountBreakdown: [
          { name: 'Heat A1', count: 6 },
          { name: 'Heat B1', count: 6 },
        ],
      });
    confirmChoiceMock.mockResolvedValue('extra');

    render(
      <HeatComponent
        event={{ event_id: 77 }}
        clickable={false}
        onHeatSelect={jest.fn()}
        onStartScoring={jest.fn()}
        onQualifyingGroupCountChange={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /start final series/i }),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('button', { name: /start final series/i }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole('dialog', { name: /start final series\?/i }),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('button', { name: /yes, start final series/i }),
    );

    await waitFor(() => {
      expect(
        window.electron.sqlite.heatRaceDB.startFinalSeriesAtomic,
      ).toHaveBeenCalledTimes(1);
    });

    expect(
      window.electron.sqlite.heatRaceDB.startFinalSeriesAtomic,
    ).toHaveBeenCalledWith(77, false, false);
  });

  it('asks SHRS 4.3 when leaderboard shows 7 completed races even if latest heats show 0 races', async () => {
    // 7 races ARE completed (from scores), but the latest round of heats has 0
    // races — the `latestRoundUnsailed` case, NOT `noRacesCompleted` (RULE-m3
    // removed the 0-race seeding-only path; a 0-race event is now ineligible).
    window.electron.sqlite.heatRaceDB.getFinalSeriesEligibility = jest
      .fn()
      .mockResolvedValue({
        ok: true,
        reason: 'OK',
        numFinalHeats: 2,
        completedQualifyingRaces: 7,
        rule43Applies: true,
        noRacesCompleted: false,
        latestRoundUnsailed: true,
        latestRoundNumber: 8,
        raceCountBreakdown: [
          { name: 'Heat A8', count: 0 },
          { name: 'Heat B8', count: 0 },
        ],
      });

    confirmActionMock
      .mockResolvedValueOnce(true) // Proceed past the "latest round unsailed" notice.
      .mockResolvedValueOnce(true); // Snapshot question.
    // (the SHRS 4.3 choice is confirmChoice, which answers 'confirm' by default)

    render(
      <HeatComponent
        event={{ event_id: 77 }}
        clickable={false}
        onHeatSelect={jest.fn()}
        onStartScoring={jest.fn()}
        onQualifyingGroupCountChange={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /start final series/i }),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('button', { name: /start final series/i }),
    );

    await waitFor(() => {
      expect(confirmActionMock).toHaveBeenCalledWith(
        expect.stringContaining('The latest round of heats'),
        'Latest round not sailed',
        { confirmLabel: 'Continue' },
      );
    });

    await waitFor(() => {
      expect(confirmChoiceMock).toHaveBeenCalledWith(
        expect.stringContaining(
          'SHRS 2026-1 Rule 4.3 applies for 6-7 completed qualifying races.',
        ),
        'Apply SHRS 2026-1 Rule 4.3?',
        {
          confirmLabel: 'Apply Rule 4.3',
          extraLabel: 'Skip Rule 4.3',
          extraClassName: 'btn-secondary',
          cancelLabel: 'Cancel',
          confirmClassName: 'btn-success',
        },
      );
    });
  });

  it('stops the start, and starts nothing, when the Rule 4.3 question is cancelled (Escape counts as Cancel)', async () => {
    window.electron.sqlite.heatRaceDB.getFinalSeriesEligibility = jest
      .fn()
      .mockResolvedValue({
        ok: true,
        reason: 'OK',
        numFinalHeats: 2,
        completedQualifyingRaces: 6,
        rule43Applies: true,
        noRacesCompleted: false,
        raceCountBreakdown: [
          { name: 'Heat A1', count: 6 },
          { name: 'Heat B1', count: 6 },
        ],
      });
    confirmChoiceMock.mockResolvedValue('cancel');

    render(
      <HeatComponent
        event={{ event_id: 77 }}
        clickable={false}
        onHeatSelect={jest.fn()}
        onStartScoring={jest.fn()}
        onQualifyingGroupCountChange={jest.fn()}
      />,
    );
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /start final series/i }),
      ).toBeInTheDocument();
    });
    fireEvent.click(
      screen.getByRole('button', { name: /start final series/i }),
    );

    await waitFor(() => expect(confirmChoiceMock).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByRole('dialog', { name: /start final series\?/i }),
    ).not.toBeInTheDocument();
    expect(
      window.electron.sqlite.heatRaceDB.startFinalSeriesAtomic,
    ).not.toHaveBeenCalled();
  });

  it.each([
    ['confirm', 'applied'],
    ['extra', 'not applied'],
  ])(
    'the final confirmation repeats the Rule 4.3 choice (%s -> %s)',
    async (choice, wording) => {
      window.electron.sqlite.heatRaceDB.getFinalSeriesEligibility = jest
        .fn()
        .mockResolvedValue({
          ok: true,
          reason: 'OK',
          numFinalHeats: 2,
          completedQualifyingRaces: 6,
          rule43Applies: true,
          noRacesCompleted: false,
          raceCountBreakdown: [
            { name: 'Heat A1', count: 6 },
            { name: 'Heat B1', count: 6 },
          ],
        });
      confirmChoiceMock.mockResolvedValue(choice);

      render(
        <HeatComponent
          event={{ event_id: 77 }}
          clickable={false}
          onHeatSelect={jest.fn()}
          onStartScoring={jest.fn()}
          onQualifyingGroupCountChange={jest.fn()}
        />,
      );
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /start final series/i }),
        ).toBeInTheDocument();
      });
      fireEvent.click(
        screen.getByRole('button', { name: /start final series/i }),
      );

      const dialog = await screen.findByRole('dialog', {
        name: /start final series\?/i,
      });
      expect(dialog).toHaveTextContent(`SHRS Rule 4.3: ${wording}.`);
    },
  );
});
