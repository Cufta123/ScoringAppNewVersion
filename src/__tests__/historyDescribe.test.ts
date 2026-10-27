/**
 * Change-journal rows as sentences (src/shared/history/describe.ts).
 */
import {
  HistoryChange,
  actionLabel,
  describeChange,
  netChanges,
  summarizeAction,
} from '../shared/history/describe';

let nextId = 1;
const change = (
  table_name: string,
  op: HistoryChange['op'],
  old_row: Record<string, unknown> | null,
  new_row: Record<string, unknown> | null,
  context: Record<string, unknown> = {},
  row_key = '1',
): HistoryChange => {
  nextId += 1;
  return {
    change_id: nextId,
    table_name,
    op,
    row_key,
    old_row,
    new_row,
    context,
  };
};

const where = { sail: 'CRO 12', heat_name: 'Heat B2', race_number: 3 };
const score = (status: string, position: number, points: number) => ({
  score_id: 1,
  race_id: 7,
  boat_id: 4,
  status,
  position,
  points,
});

describe('describeChange', () => {
  it('a score: finish, scored penalty, non-finisher', () => {
    expect(
      describeChange(
        change('Scores', 'insert', null, score('FINISHED', 1, 1), where),
      ),
    ).toBe('CRO 12, Heat B2 race 3: 1 (1 point)');
    expect(
      describeChange(
        change(
          'Scores',
          'update',
          score('FINISHED', 4, 4),
          score('ZFP', 4, 5.2),
          where,
        ),
      ),
    ).toBe('CRO 12, Heat B2 race 3: 4 (4 points) → 4 ZFP (5.2 points)');
    expect(
      describeChange(
        change('Scores', 'delete', score('DNF', 9, 9), null, where),
      ),
    ).toBe('CRO 12, Heat B2 race 3: score removed (was DNF (9 points))');
  });

  it('still reads when the boat or heat is unknown', () => {
    expect(
      describeChange(
        change('Scores', 'insert', null, score('FINISHED', 2, 2), {}),
      ),
    ).toBe('boat 4, a heat that no longer exists: 2 (2 points)');
  });

  it('heats, races, heat places and entries', () => {
    const heat = { heat_id: 3, heat_name: 'Final Gold', heat_type: 'Final' };
    expect(describeChange(change('Heats', 'insert', null, heat))).toBe(
      'Final Gold (Final) created',
    );
    expect(describeChange(change('Heats', 'delete', heat, null))).toBe(
      'Final Gold (Final) deleted',
    );
    expect(
      describeChange(
        change(
          'Races',
          'insert',
          null,
          { race_id: 1, heat_id: 3, race_number: 2 },
          { heat_name: 'Final Gold' },
        ),
      ),
    ).toBe('Final Gold race 2 added');
    expect(
      describeChange(
        change('Heat_Boat', 'delete', { heat_id: 3, boat_id: 4 }, null, {
          sail: 'CRO 12',
          heat_name: 'Heat A1',
        }),
      ),
    ).toBe('CRO 12 taken out of Heat A1');
    expect(
      describeChange(
        change('Boat_Event', 'delete', { boat_id: 4, event_id: 1 }, null, {
          sail: 'CRO 12',
        }),
      ),
    ).toBe('CRO 12 removed from the entry list');
  });

  it('event settings, field by field', () => {
    expect(
      describeChange(
        change(
          'Events',
          'update',
          {
            event_name: 'Kup',
            shrs_discard_profile_qualifying: 'standard',
            shrs_discard_locked_final: 0,
          },
          {
            event_name: 'Kup',
            shrs_discard_profile_qualifying: 'never',
            shrs_discard_locked_final: 1,
          },
        ),
      ),
    ).toBe(
      'Discards (qualifying): standard → never; Final discards locked: no → yes',
    );
  });
});

describe('netChanges', () => {
  it('one row written several times shows once, before → after', () => {
    const net = netChanges([
      change('Scores', 'insert', null, score('DNS', 3, 3), where),
      change(
        'Scores',
        'update',
        score('DNS', 3, 3),
        score('FINISHED', 1, 1),
        where,
      ),
    ]);
    expect(net).toHaveLength(1);
    expect(describeChange(net[0])).toBe('CRO 12, Heat B2 race 3: 1 (1 point)');
  });

  it('drops a row created and removed again, or changed back', () => {
    expect(
      netChanges([
        change('Heats', 'insert', null, { heat_name: 'X' }),
        change('Heats', 'delete', { heat_name: 'X' }, null),
        change('Scores', 'update', score('DNS', 3, 3), score('DNF', 3, 3)),
        change('Scores', 'update', score('DNF', 3, 3), score('DNS', 3, 3)),
      ]),
    ).toEqual([]);
  });

  it('a row deleted and put back with new values is an update', () => {
    const [net] = netChanges([
      change(
        'Heat_Boat',
        'delete',
        { heat_id: 1, boat_id: 4 },
        null,
        {},
        '1:4',
      ),
      change(
        'Heat_Boat',
        'insert',
        null,
        { heat_id: 1, boat_id: 4 },
        {},
        '1:4',
      ),
      change('Scores', 'delete', score('DNF', 9, 9), null, where),
      change('Scores', 'insert', null, score('DNF', 8, 8), where),
    ]).slice(-1);
    expect(net.op).toBe('update');
    expect(describeChange(net)).toBe(
      'CRO 12, Heat B2 race 3: DNF (9 points) → DNF (8 points)',
    );
  });

  it('keeps rows of different tables with the same key apart', () => {
    expect(
      netChanges([
        change('Heats', 'insert', null, { heat_name: 'A' }),
        change('Races', 'insert', null, { race_number: 1 }),
      ]),
    ).toHaveLength(2);
  });
});

describe('actions', () => {
  it('names actions by what the user did', () => {
    expect(actionLabel('submitHeatRaceScoresAtomic')).toBe('Race scored');
    expect(actionLabel(null)).toBe('Automatic change');
    expect(actionLabel('somethingNew')).toBe('somethingNew');
  });

  it('summarizes an action with its net changes', () => {
    expect(
      summarizeAction({
        action_id: 1,
        channel: 'updateRaceResult',
        at: '2026-05-01T10:00:00.000Z',
        changes: [
          change(
            'Scores',
            'update',
            score('FINISHED', 2, 2),
            score('DSQ', 2, 9),
            where,
          ),
        ],
      }),
    ).toEqual({
      label: 'Result changed',
      lines: ['CRO 12, Heat B2 race 3: 2 (2 points) → DSQ (9 points)'],
    });
  });
});
