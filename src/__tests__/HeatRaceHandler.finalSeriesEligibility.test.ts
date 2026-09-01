/* eslint-disable camelcase */
/**
 * Tests for getFinalSeriesEligibility (via its IPC handler) — the SHRS
 * validation that decides whether the Final Series can start. The renderer
 * only renders prompts from this result, so the rule logic is verified here.
 */
export {};

const handlerRegistry: Record<string, (...args: any[]) => any> = {};

jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn((channel: string, callback: (...args: any[]) => any) => {
      handlerRegistry[channel] = callback;
    }),
  },
}));

type Scenario = {
  heats: { heat_name: string; heat_id: number }[];
  raceCounts: Record<number, number>;
  maxScores: number | null;
};

let scenario: Scenario;

jest.mock('../../public/Database/DBManager', () => ({
  db: {
    prepare: jest.fn((sql: string) => {
      const flat = sql.replace(/\s+/g, ' ');
      return {
        all: () => {
          // startFinalSeriesAtomic re-reads Heats without a SQL-side
          // heat_type filter (it filters in JS instead), so it needs
          // heat_type on each row too.
          if (flat.includes('heat_id, heat_name, heat_type FROM Heats')) {
            return scenario.heats.map((h) => ({
              ...h,
              heat_type: 'Qualifying',
            }));
          }
          if (
            flat.includes('FROM Heats') &&
            flat.includes("heat_type = 'Qualifying'")
          ) {
            return scenario.heats.map((h) => ({ ...h }));
          }
          return [];
        },
        get: (arg: unknown) => {
          if (flat.includes('race_count FROM Races')) {
            return { race_count: scenario.raceCounts[arg as number] ?? 0 };
          }
          if (flat.includes('MAX(cnt)')) {
            return { maxcnt: scenario.maxScores };
          }
          return undefined;
        },
      };
    }),
  },
}));

describe('getFinalSeriesEligibility', () => {
  beforeAll(() => {
    require('../main/ipcHandlers/HeatRaceHandler');
  });

  const run = (eventId = 1) =>
    handlerRegistry.getFinalSeriesEligibility({}, eventId);

  it('reports NO_HEATS when there are no qualifying heats', async () => {
    scenario = { heats: [], raceCounts: {}, maxScores: 0 };
    const res = await run();
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('NO_HEATS');
  });

  it('reports SINGLE_FLEET when there is only one qualifying group', async () => {
    scenario = {
      heats: [{ heat_name: 'Heat A1', heat_id: 11 }],
      raceCounts: { 11: 3 },
      maxScores: 3,
    };
    const res = await run();
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('SINGLE_FLEET');
    expect(res.numFinalHeats).toBe(1);
  });

  it('reports UNEQUAL_RACE_COUNTS when latest heats differ in race count', async () => {
    scenario = {
      heats: [
        { heat_name: 'Heat A1', heat_id: 11 },
        { heat_name: 'Heat B1', heat_id: 12 },
      ],
      raceCounts: { 11: 4, 12: 3 },
      maxScores: 4,
    };
    const res = await run();
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('UNEQUAL_RACE_COUNTS');
    expect(res.raceCountBreakdown).toEqual([
      { name: 'Heat A1', count: 4 },
      { name: 'Heat B1', count: 3 },
    ]);
  });

  it('is eligible with no Rule 4.3 below 6 completed races', async () => {
    scenario = {
      heats: [
        { heat_name: 'Heat A1', heat_id: 11 },
        { heat_name: 'Heat B1', heat_id: 12 },
      ],
      raceCounts: { 11: 5, 12: 5 },
      maxScores: 5,
    };
    const res = await run();
    expect(res.ok).toBe(true);
    expect(res.numFinalHeats).toBe(2);
    expect(res.completedQualifyingRaces).toBe(5);
    expect(res.rule43Applies).toBe(false);
    expect(res.noRacesCompleted).toBe(false);
  });

  it('flags Rule 4.3 for 6-7 completed races', async () => {
    scenario = {
      heats: [
        { heat_name: 'Heat A1', heat_id: 11 },
        { heat_name: 'Heat B1', heat_id: 12 },
      ],
      raceCounts: { 11: 6, 12: 6 },
      maxScores: 6,
    };
    const res = await run();
    expect(res.ok).toBe(true);
    expect(res.rule43Applies).toBe(true);
    expect(res.completedQualifyingRaces).toBe(6);
  });

  it('prefers scored-race count over created races, catching the 4.3 window', async () => {
    // Latest heats have 0 races created, but boats are scored in 7 races.
    scenario = {
      heats: [
        { heat_name: 'Heat A1', heat_id: 11 },
        { heat_name: 'Heat B1', heat_id: 12 },
      ],
      raceCounts: { 11: 0, 12: 0 },
      maxScores: 7,
    };
    const res = await run();
    expect(res.ok).toBe(true);
    expect(res.completedQualifyingRaces).toBe(7);
    expect(res.rule43Applies).toBe(true);
    // Regression: 7 races ARE completed, so noRacesCompleted must be false even
    // though the latest (unsailed) round of heats has 0 races. Otherwise the
    // renderer fires the contradictory "no qualifying races completed" prompt
    // alongside the Rule 4.3 (6-7 completed races) prompt.
    expect(res.noRacesCompleted).toBe(false);
    // Latest round (suffix 1) created with 0 races but 7 are scored ⇒ the
    // "latest round not sailed" path, not the "no races" path.
    expect(res.latestRoundUnsailed).toBe(true);
    expect(res.latestRoundNumber).toBe(1);
  });

  it('noRacesCompleted stays consistent with rule43Applies (6 scored, new round unsailed)', async () => {
    // Exact reported scenario: 6 qualifying races scored, then a 7th round of
    // heats created but with 0 races yet. The two flags must not contradict.
    scenario = {
      heats: [
        { heat_name: 'Heat A7', heat_id: 71 },
        { heat_name: 'Heat B7', heat_id: 72 },
      ],
      raceCounts: { 71: 0, 72: 0 },
      maxScores: 6,
    };
    const res = await run();
    expect(res.ok).toBe(true);
    expect(res.completedQualifyingRaces).toBe(6);
    expect(res.rule43Applies).toBe(true);
    expect(res.noRacesCompleted).toBe(false);
    // Round 7 exists but is unsailed; the renderer tells the user round 6 is used.
    expect(res.latestRoundUnsailed).toBe(true);
    expect(res.latestRoundNumber).toBe(7);
  });

  it('rejects the Final Series when nothing has been scored (RULE-m3 / SHRS 4.2)', async () => {
    scenario = {
      heats: [
        { heat_name: 'Heat A1', heat_id: 11 },
        { heat_name: 'Heat B1', heat_id: 12 },
      ],
      raceCounts: { 11: 0, 12: 0 },
      maxScores: 0,
    };
    const res = await run();
    // SHRS 4.2 needs a Qualifying ranking, which needs a completed race, so a
    // 0-race event is NOT eligible for a Final Series.
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('NO_RACES_COMPLETED');
    expect(res.completedQualifyingRaces).toBe(0);
    expect(res.rule43Applies).toBe(false);
    expect(res.noRacesCompleted).toBe(true);
    // Nothing scored anywhere ⇒ NOT the "latest round unsailed" case.
    expect(res.latestRoundUnsailed).toBe(false);
  });

  it('does not flag latestRoundUnsailed when the latest round has been sailed', async () => {
    scenario = {
      heats: [
        { heat_name: 'Heat A1', heat_id: 11 },
        { heat_name: 'Heat B1', heat_id: 12 },
      ],
      raceCounts: { 11: 6, 12: 6 },
      maxScores: 6,
    };
    const res = await run();
    expect(res.ok).toBe(true);
    expect(res.latestRoundUnsailed).toBe(false);
    expect(res.noRacesCompleted).toBe(false);
  });

  describe('Rule 4.3 window boundaries (5/6/7/8 completed races)', () => {
    it('5 completed races: window closed (below the >5 threshold)', async () => {
      scenario = {
        heats: [
          { heat_name: 'Heat A1', heat_id: 11 },
          { heat_name: 'Heat B1', heat_id: 12 },
        ],
        raceCounts: { 11: 5, 12: 5 },
        maxScores: 5,
      };
      const res = await run();
      expect(res.completedQualifyingRaces).toBe(5);
      expect(res.rule43Applies).toBe(false);
    });

    it('6 completed races: window open (lower edge)', async () => {
      scenario = {
        heats: [
          { heat_name: 'Heat A1', heat_id: 11 },
          { heat_name: 'Heat B1', heat_id: 12 },
        ],
        raceCounts: { 11: 6, 12: 6 },
        maxScores: 6,
      };
      const res = await run();
      expect(res.completedQualifyingRaces).toBe(6);
      expect(res.rule43Applies).toBe(true);
    });

    it('7 completed races: window open (upper edge)', async () => {
      scenario = {
        heats: [
          { heat_name: 'Heat A1', heat_id: 11 },
          { heat_name: 'Heat B1', heat_id: 12 },
        ],
        raceCounts: { 11: 7, 12: 7 },
        maxScores: 7,
      };
      const res = await run();
      expect(res.completedQualifyingRaces).toBe(7);
      expect(res.rule43Applies).toBe(true);
    });

    it('8 completed races: window closed again (at the <8 threshold)', async () => {
      scenario = {
        heats: [
          { heat_name: 'Heat A1', heat_id: 11 },
          { heat_name: 'Heat B1', heat_id: 12 },
        ],
        raceCounts: { 11: 8, 12: 8 },
        maxScores: 8,
      };
      const res = await run();
      expect(res.completedQualifyingRaces).toBe(8);
      expect(res.rule43Applies).toBe(false);
    });
  });

  it('ignores qualifying heats whose name does not match "Heat <LETTERS>" when counting groups', async () => {
    // A malformed/legacy heat_name must not be silently counted as its own
    // fleet group — only heats matching /Heat ([A-Z]+)/ contribute.
    scenario = {
      heats: [
        { heat_name: 'Heat A1', heat_id: 11 },
        { heat_name: 'Heat B1', heat_id: 12 },
        { heat_name: 'Malformed Group', heat_id: 13 },
      ],
      raceCounts: { 11: 5, 12: 5, 13: 5 },
      maxScores: 5,
    };
    const res = await run();
    expect(res.ok).toBe(true);
    expect(res.numFinalHeats).toBe(2);
  });

  it('reports latestRoundNumber as null when the latest heat name has no numeric suffix', async () => {
    scenario = {
      heats: [
        { heat_name: 'Heat A', heat_id: 11 },
        { heat_name: 'Heat B', heat_id: 12 },
      ],
      raceCounts: { 11: 6, 12: 6 },
      maxScores: 6,
    };
    const res = await run();
    expect(res.ok).toBe(true);
    expect(res.latestRoundNumber).toBeNull();
  });

  // RULE-m3 (FIXED): getFinalSeriesEligibility used to report ok:true with 0
  // completed qualifying races while startFinalSeriesAtomic threw — an
  // inconsistency. Per SHRS 4.2 (fleet assignment needs a Qualifying ranking)
  // eligibility now rejects the 0-race case up front, so BOTH functions agree
  // the Final Series cannot start.
  it('m3: eligibility rejects 0 completed races, consistent with startFinalSeriesAtomic (SHRS 4.2)', async () => {
    scenario = {
      heats: [
        { heat_name: 'Heat A1', heat_id: 11 },
        { heat_name: 'Heat B1', heat_id: 12 },
      ],
      raceCounts: { 11: 0, 12: 0 },
      maxScores: 0,
    };

    const eligibility = await run();
    // Eligibility now says NO (was ok:true) — consistent with the start handler.
    expect(eligibility.ok).toBe(false);
    expect(eligibility.reason).toBe('NO_RACES_COMPLETED');
    expect(eligibility.completedQualifyingRaces).toBe(0);
    expect(eligibility.noRacesCompleted).toBe(true);

    // The start handler still rejects the same state, so the two agree.
    await expect(handlerRegistry.startFinalSeriesAtomic({}, 1)).rejects.toThrow(
      'Cannot start final series without qualifying leaderboard data.',
    );
  });
});
