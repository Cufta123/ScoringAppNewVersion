/**
 * Which history entries are in effect now, and what going back to one of them
 * would change. Pure; the history dialog uses it to mark undone entries and
 * to say, before anything happens, exactly what a "Go back to here" undoes
 * and what it brings back.
 *
 * The event's state is always the effect of a set of actions:
 *  - an ordinary action adds itself;
 *  - an undo (reverts_action_id = X) takes X out — and if X was itself an
 *    undo of Z, Z is back in;
 *  - going back to T (restores_to_action_id = T) makes the set exactly what
 *    it was right after T.
 */
import type { HistoryAction } from './describe';

type ActionRef = Pick<
  HistoryAction,
  'action_id' | 'reverts_action_id' | 'restores_to_action_id'
>;

/** Action ids in effect right after each action, oldest first. */
function liveAfterEach(actions: ActionRef[]): Map<number, Set<number>> {
  const chronological = actions
    .filter((a): a is ActionRef & { action_id: number } => a.action_id != null)
    .sort((a, b) => a.action_id - b.action_id);
  const liveAfter = new Map<number, Set<number>>();
  const undid = new Map<number, number>();
  let live = new Set<number>();
  chronological.forEach((action) => {
    const id = action.action_id;
    if (action.restores_to_action_id != null) {
      live = new Set(liveAfter.get(action.restores_to_action_id) ?? []);
    } else if (action.reverts_action_id != null) {
      const target = action.reverts_action_id;
      live = new Set(live);
      if (live.has(target)) {
        live.delete(target);
        const undoneByTarget = undid.get(target);
        if (undoneByTarget != null) live.add(undoneByTarget);
      }
      live.add(id);
      undid.set(id, target);
    } else {
      live = new Set(live);
      live.add(id);
    }
    liveAfter.set(id, live);
  });
  return liveAfter;
}

const isRestore = (action: ActionRef) => action.restores_to_action_id != null;

/** Actions whose effect is no longer in the event (shown as "Undone"). */
export function undoneActions(actions: ActionRef[]): Set<number> {
  const liveAfter = liveAfterEach(actions);
  const ids = [...liveAfter.keys()];
  const now = ids.length ? liveAfter.get(Math.max(...ids))! : new Set();
  return new Set(
    actions
      .filter((a) => a.action_id != null && !isRestore(a))
      .map((a) => a.action_id as number)
      .filter((id) => !now.has(id)),
  );
}

export interface RestorePreview<T> {
  /** In effect now, gone after going back (newest first). */
  undo: T[];
  /** Undone now, back in effect after going back (oldest first). */
  redo: T[];
}

/** What going back to right after `targetId` changes. */
export function restorePreview<T extends ActionRef>(
  actions: T[],
  targetId: number,
): RestorePreview<T> {
  const liveAfter = liveAfterEach(actions);
  const ids = [...liveAfter.keys()];
  const now = ids.length ? liveAfter.get(Math.max(...ids))! : new Set();
  const then = liveAfter.get(targetId) ?? new Set<number>();
  const byId = (a: T, b: T) => Number(a.action_id) - Number(b.action_id);
  const listed = actions.filter((a) => a.action_id != null && !isRestore(a));
  return {
    undo: listed
      .filter(
        (a) =>
          now.has(a.action_id as number) && !then.has(a.action_id as number),
      )
      .sort(byId)
      .reverse(),
    redo: listed
      .filter(
        (a) =>
          then.has(a.action_id as number) && !now.has(a.action_id as number),
      )
      .sort(byId),
  };
}

/** "3 × Race scored, 1 × Next round heats created", newest kind first. */
export function countByLabel<T>(
  items: T[],
  labelOf: (item: T) => string,
): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  items.forEach((item) => {
    const label = labelOf(item);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  });
  return [...counts.entries()].map(([label, count]) => ({ label, count }));
}
