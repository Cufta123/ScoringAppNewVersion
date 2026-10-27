/**
 * Which history actions can be undone, and how (src/shared/history/revert.ts).
 */
import { HistoryAction, HistoryChange } from '../shared/history/describe';
import {
  changesToRevert,
  isUntouchedSince,
  revertSteps,
  undoneActionIds,
  whyNotRevertable,
} from '../shared/history/revert';

let nextId = 0;
const change = (
  table_name: string,
  op: HistoryChange['op'],
  old_row: Record<string, unknown> | null,
  new_row: Record<string, unknown> | null,
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
    context: {},
  };
};

const action = (
  channel: string | null,
  changes: HistoryChange[],
): HistoryAction => ({
  action_id: 1,
  channel,
  at: '2026-05-02T12:00:00.000Z',
  changes,
});

const score = (
  score_id: number,
  status: string,
  position: number,
  points: number,
  rdg_race_ids: string | null = null,
) => ({
  score_id,
  race_id: 7,
  boat_id: score_id,
  position,
  points,
  status,
  rdg_race_ids,
});

describe('whyNotRevertable', () => {
  it('a result change can be undone', () => {
    expect(
      whyNotRevertable(
        action('updateRaceResult', [
          change(
            'Scores',
            'update',
            score(1, 'FINISHED', 1, 1),
            score(1, 'DSQ', 1, 5),
          ),
          change(
            'RaceAssignmentSnapshots',
            'insert',
            null,
            { race_id: 7, rank: 1, boat_id: 1 },
            '7:1',
          ),
          // Side effect: the first scored race locks the discard profile.
          change(
            'Events',
            'update',
            { event_name: 'Kup', shrs_discard_locked_qualifying: 0 },
            { event_name: 'Kup', shrs_discard_locked_qualifying: 1 },
          ),
        ]),
      ),
    ).toBeNull();
  });

  it('scoring a race, heats and entries go through the scoring page', () => {
    expect(
      whyNotRevertable(
        action('submitHeatRaceScoresAtomic', [
          change('Races', 'insert', null, { race_id: 7, heat_id: 1 }),
          change('Scores', 'insert', null, score(1, 'FINISHED', 1, 1)),
        ]),
      ),
    ).toMatch(/scoring page \(Undo last race\)/);
    expect(
      whyNotRevertable(
        action('associateBoatWithEvent', [
          change('Boat_Event', 'insert', null, { boat_id: 1, event_id: 1 }),
        ]),
      ),
    ).not.toBeNull();
  });

  it('a result action that also wrote other tables is not undone here', () => {
    expect(
      whyNotRevertable(
        action('updateRaceResult', [
          change(
            'Scores',
            'update',
            score(1, 'FINISHED', 1, 1),
            score(1, 'DSQ', 1, 5),
          ),
          change(
            'Heat_Boat',
            'delete',
            { heat_id: 2, boat_id: 1 },
            null,
            '2:1',
          ),
        ]),
      ),
    ).toMatch(/scoring page/);
  });

  it('event settings and automatic changes are not undone from here', () => {
    expect(
      whyNotRevertable(
        action('updateEvent', [
          change('Events', 'update', { event_name: 'A' }, { event_name: 'B' }),
        ]),
      ),
    ).toBe('Event settings are changed in the event settings.');
    expect(
      whyNotRevertable(
        action('readLeaderboard', [
          change('Scores', 'insert', null, score(1, 'DNC', 5, 5)),
        ]),
      ),
    ).toMatch(/by itself/);
    expect(whyNotRevertable(action(null, []))).toMatch(/by itself/);
  });

  it('an action whose only effect the rebuild redoes has nothing to undo', () => {
    expect(
      whyNotRevertable(
        action('updateRaceResult', [
          change(
            'Scores',
            'update',
            score(1, 'RDG1', 2, 2.3),
            score(1, 'RDG1', 2, 2.5),
          ),
        ]),
      ),
    ).toBe('This action left nothing to undo.');
  });
});

describe('changesToRevert', () => {
  it('leaves out points the standings rebuild re-derives', () => {
    const kept = changesToRevert(
      action('updateRaceResult', [
        // the edit itself
        change(
          'Scores',
          'update',
          score(1, 'FINISHED', 2, 2),
          score(1, 'DSQ', 2, 5),
        ),
        // rebuild side effects: a DNF renormalised, an RDG1 average moved
        change(
          'Scores',
          'update',
          score(2, 'DNF', 4, 4),
          score(2, 'DNF', 4, 5),
          '2',
        ),
        change(
          'Scores',
          'update',
          score(3, 'RDG1', 2, 2.3),
          score(3, 'RDG1', 3, 2.6),
          '3',
        ),
        // RDG3 points are the protest committee's: a real change
        change(
          'Scores',
          'update',
          score(4, 'RDG3', 3, 3),
          score(4, 'RDG3', 3, 2),
          '4',
        ),
      ]),
    );
    expect(kept.map((c) => c.row_key)).toEqual(['1', '4']);
  });
});

describe('revertSteps', () => {
  it('reverses each change, last first', () => {
    const steps = revertSteps(
      action('updateRaceResult', [
        change('Scores', 'insert', null, score(5, 'FINISHED', 3, 3), '5'),
        change(
          'Scores',
          'update',
          score(1, 'FINISHED', 1, 1),
          score(1, 'DSQ', 1, 5),
        ),
        change(
          'RaceAssignmentSnapshots',
          'delete',
          { race_id: 7, rank: 2, boat_id: 1 },
          null,
          '7:2',
        ),
      ]),
    );
    expect(steps.map((s) => [s.table, s.op, s.key])).toEqual([
      ['RaceAssignmentSnapshots', 'insert', { race_id: 7, rank: 2 }],
      ['Scores', 'update', { score_id: 1 }],
      ['Scores', 'delete', { score_id: 5 }],
    ]);
    expect(steps[1].row).toEqual(score(1, 'FINISHED', 1, 1));
  });
});

describe('isUntouchedSince', () => {
  const [step] = revertSteps(
    action('updateRaceResult', [
      change(
        'Scores',
        'update',
        score(1, 'FINISHED', 4, 4),
        score(1, 'DNF', 4, 5),
      ),
    ]),
  );

  it('is true while the row is as the action left it', () => {
    expect(isUntouchedSince(step, score(1, 'DNF', 4, 5))).toBe(true);
  });

  it('ignores points the rebuild has re-derived since', () => {
    expect(isUntouchedSince(step, score(1, 'DNF', 4, 7))).toBe(true);
  });

  it('is false once someone changed the result again, or removed it', () => {
    expect(isUntouchedSince(step, score(1, 'DSQ', 4, 5))).toBe(false);
    expect(isUntouchedSince(step, null)).toBe(false);
  });

  it('an undone insert expects the row to still exist; an undone delete, not', () => {
    const [undoInsert] = revertSteps(
      action('insertScore', [
        change('Scores', 'insert', null, score(9, 'FINISHED', 1, 1)),
      ]),
    );
    expect(isUntouchedSince(undoInsert, null)).toBe(false);
    const [undoDelete] = revertSteps(
      action('deleteScore', [
        change('Scores', 'delete', score(9, 'FINISHED', 1, 1), null),
      ]),
    );
    expect(isUntouchedSince(undoDelete, null)).toBe(true);
    expect(isUntouchedSince(undoDelete, score(9, 'FINISHED', 1, 1))).toBe(
      false,
    );
  });
});

describe('undoneActionIds', () => {
  const a = (action_id: number, reverts_action_id: number | null = null) => ({
    action_id,
    reverts_action_id,
  });

  it('an action is undone until its undo is undone', () => {
    expect([...undoneActionIds([a(1), a(2, 1)])]).toEqual([1]);
    // 3 undoes the undo: 1 stands again, 2 is undone.
    expect([...undoneActionIds([a(1), a(2, 1), a(3, 2)])]).toEqual([2]);
    // ...and undoing 1 a second time makes it undone again.
    expect(
      [...undoneActionIds([a(1), a(2, 1), a(3, 2), a(4, 1)])].sort(),
    ).toEqual([1, 2]);
  });
});
