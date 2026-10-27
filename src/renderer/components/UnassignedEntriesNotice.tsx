import React, { useEffect, useState } from 'react';
import { eventDB, heatRaceDB } from '../api/db';
import type { EventBoatRow } from '../types';
import { reportError } from '../utils/userFeedback';
import { findUnassignedEntries, suggestHeat } from '../utils/unassignedEntries';
import type { HeatForAssignment } from '../utils/unassignedEntries';

interface UnassignedEntriesNoticeProps {
  eventId: number;
  heats: HeatForAssignment[];
  raceHappened: boolean;
  finalSeriesStarted: boolean;
  /** Bumped by the parent whenever heats or entries may have changed. */
  refreshKey: unknown;
  /** Disables the Add buttons while another heat action runs. */
  busy: boolean;
  runExclusive: (action: () => Promise<void>) => Promise<unknown>;
  onAssigned: () => void;
}

/**
 * Warns when an entered boat is in no heat of the current qualifying round —
 * typically a late entry added after the heats were built. Without a heat she
 * is scored DNC for every round (RRS A5.1), which is right only if she is
 * really not racing. Before the first race the fix is "Recreate Heats"; after
 * it, she can be added to any current-round heat that has not raced yet
 * (smallest first, SHRS 2.2).
 */
export default function UnassignedEntriesNotice({
  eventId,
  heats,
  raceHappened,
  finalSeriesStarted,
  refreshKey,
  busy,
  runExclusive,
  onAssigned,
}: UnassignedEntriesNoticeProps) {
  const [entries, setEntries] = useState<EventBoatRow[]>([]);
  const [targets, setTargets] = useState<Record<number, number>>({});

  useEffect(() => {
    let cancelled = false;
    // Through a promise chain so even a synchronous throw from the IPC layer
    // lands in the catch: this notice is advisory and must never take the
    // heats view down with it.
    Promise.resolve()
      .then(() => eventDB.readBoatsByEvent(eventId))
      .then((rows) => {
        if (!cancelled) setEntries(Array.isArray(rows) ? rows : []);
        return null;
      })
      .catch(() => {
        // Advisory only; the heats view itself reports load failures.
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, refreshKey]);

  const { unassigned, openHeats } = findUnassignedEntries(
    entries,
    heats,
    finalSeriesStarted,
  );
  if (unassigned.length === 0) return null;

  const suggested = suggestHeat(openHeats);
  const label = (boat: EventBoatRow) =>
    `${boat.boat_country ?? ''} ${boat.sail_number} — ${boat.name} ${boat.surname}`.trim();

  const addToHeat = (boat: EventBoatRow) =>
    runExclusive(async () => {
      const heatId = targets[boat.boat_id] ?? suggested;
      if (heatId == null) return;
      try {
        await heatRaceDB.insertHeatBoat(heatId, boat.boat_id);
        onAssigned();
      } catch (error) {
        reportError(
          `Could not add sail ${boat.sail_number} to the heat.`,
          error,
        );
      }
    });

  let guidance: React.ReactNode;
  if (!raceHappened) {
    guidance = (
      <>
        Press <strong>Recreate Heats</strong> to divide the fleet again with
        them included.
      </>
    );
  } else if (openHeats.length > 0) {
    guidance =
      'Add them to a heat of the current round that has not raced yet. ' +
      'Until then they are scored DNC for every round they miss (RRS A5.1).';
  } else {
    guidance =
      'Every heat of the current round has raced, so they are scored DNC for ' +
      'it (RRS A5.1). You can add them once the next round of heats is created.';
  }

  return (
    <div className="info-banner" role="status">
      <i
        className="fa fa-exclamation-triangle"
        aria-hidden="true"
        style={{ marginRight: '8px' }}
      />
      <strong>
        {unassigned.length === 1
          ? '1 entered boat is not in any heat'
          : `${unassigned.length} entered boats are not in any heat`}{' '}
        of the current round.
      </strong>{' '}
      {guidance}
      <ul style={{ margin: '8px 0 0 24px' }}>
        {unassigned.map((boat) => (
          <li key={boat.boat_id} style={{ marginBottom: '4px' }}>
            {label(boat)}
            {raceHappened && openHeats.length > 0 && (
              <>
                {' '}
                <select
                  aria-label={`Heat for sail ${boat.sail_number}`}
                  value={targets[boat.boat_id] ?? suggested ?? ''}
                  onChange={(event) =>
                    setTargets((prev) => ({
                      ...prev,
                      [boat.boat_id]: Number(event.target.value),
                    }))
                  }
                  disabled={busy}
                >
                  {openHeats.map((heat) => (
                    <option key={heat.heat_id} value={heat.heat_id}>
                      {heat.heat_name} ({heat.boats.length} boats)
                    </option>
                  ))}
                </select>{' '}
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => addToHeat(boat)}
                  disabled={busy}
                >
                  Add to heat
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
