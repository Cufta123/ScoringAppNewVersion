import React from 'react';
import Flag from 'react-world-flags';
import { getFlagCode } from '../../utils/leaderboardUtils';
import { BOAT_DRAG_MIME, serializeBoatDrag } from '../../utils/heatView';
import type { HeatWithBoats } from '../../utils/heatView';
import { sailorFullName } from '../../utils/sailorName';

interface HeatColumnProps {
  heat: HeatWithBoats;
  /** Boats may be dragged to another heat (no race scored, no final series). */
  boatsDraggable: boolean;
  onBoatDrop: (e: React.DragEvent, toHeatId: number) => void;
  /**
   * Passed when the event status offers the action for this heat (a heat
   * of the round being sailed, or a fleet); older heats are done.
   */
  onScore?: ((heat: HeatWithBoats) => void) | null;
  onUndoLastRace?: ((heat: HeatWithBoats) => void) | null;
  /** Why the rules refuse it now (the button is disabled with this title). */
  scoreRefused?: string | null;
  undoRefused?: string | null;
  actionsDisabled?: boolean;
}

const allowDrop = (e: React.DragEvent) => {
  e.preventDefault();
};

/**
 * One heat card: its name and scored state, the boat table, and for the
 * current round its own Score / Undo buttons (no select-then-act step).
 * Memoised: a heat view can hold
 * 26 heats of 20 boats, and none of them should redraw because a button
 * elsewhere on the page went busy.
 */
function HeatColumn({
  heat,
  boatsDraggable,
  onBoatDrop,
  onScore = null,
  onUndoLastRace = null,
  scoreRefused = null,
  undoRefused = null,
  actionsDisabled = false,
}: HeatColumnProps) {
  const nextRace = heat.raceNumber + 1;
  return (
    <section
      className="heat-column"
      aria-label={heat.heat_name}
      onDrop={(e) => onBoatDrop(e, heat.heat_id)}
      onDragOver={allowDrop}
    >
      <h4 className="heat-card-title">
        <span>{heat.heat_name}</span>
        {/* Whether this heat still has to sail, readable at a glance. */}
        {heat.raceNumber > 0 ? (
          <span className="heat-status heat-status-done">
            <i className="fa fa-check" aria-hidden="true" />{' '}
            {heat.raceNumber === 1
              ? 'Scored'
              : `${heat.raceNumber} races scored`}
          </span>
        ) : (
          <span className="heat-status heat-status-waiting">
            Not scored yet
          </span>
        )}
      </h4>
      <table>
        <thead>
          <tr>
            <th scope="col" className="heat-name-cell">
              Sailor Name
            </th>
            <th scope="col" className="heat-country-cell">
              Country
            </th>
            <th scope="col" className="heat-sail-cell">
              Sail #
            </th>
          </tr>
        </thead>
        <tbody>
          {heat.boats.map((boat) => (
            <tr
              key={boat.boat_id}
              draggable={boatsDraggable}
              onDragStart={(e) =>
                e.dataTransfer.setData(
                  BOAT_DRAG_MIME,
                  serializeBoatDrag(boat, heat.heat_id),
                )
              }
              style={boatsDraggable ? { cursor: 'grab' } : undefined}
              title={
                boatsDraggable
                  ? 'Drag this boat onto another heat to move it'
                  : undefined
              }
            >
              <td className="heat-name-cell">{sailorFullName(boat)}</td>
              {/* Flag and code stay on one line: nowrap in the stylesheet. */}
              <td className="heat-country-cell">
                <Flag
                  code={getFlagCode(boat.country ?? '')}
                  className="heat-flag"
                />
                {boat.country}
              </td>
              <td className="heat-sail-cell heat-sail-number">
                {boat.sail_number}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {(onScore || onUndoLastRace) && (
        <div className="heat-card-actions">
          {onScore && (
            <button
              type="button"
              className="btn-outline"
              onClick={() => onScore(heat)}
              disabled={actionsDisabled || scoreRefused !== null}
              title={scoreRefused ?? undefined}
              aria-label={`Score race ${nextRace} in ${heat.heat_name}`}
            >
              <i className="fa fa-play" aria-hidden="true" /> Score race{' '}
              {nextRace}
            </button>
          )}
          {onUndoLastRace && (
            <button
              type="button"
              className="btn-ghost"
              title={
                undoRefused ??
                `Delete Race ${heat.raceNumber} in ${heat.heat_name}`
              }
              disabled={actionsDisabled || undoRefused !== null}
              aria-busy={actionsDisabled}
              onClick={() => onUndoLastRace(heat)}
            >
              <i className="fa fa-undo" aria-hidden="true" /> Undo race{' '}
              {heat.raceNumber}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export default React.memo(HeatColumn);
