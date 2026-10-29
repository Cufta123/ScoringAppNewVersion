import React from 'react';
import Flag from 'react-world-flags';
import { getFlagCode } from '../../utils/leaderboardUtils';
import { BOAT_DRAG_MIME, serializeBoatDrag } from '../../utils/heatView';
import type { HeatWithBoats } from '../../utils/heatView';
import { sailorFullName } from '../../utils/sailorName';

interface HeatColumnProps {
  heat: HeatWithBoats;
  clickable: boolean;
  selected: boolean;
  /** Boats may be dragged to another heat (no race scored, no final series). */
  boatsDraggable: boolean;
  onSelect: (heat: HeatWithBoats) => void;
  onBoatDrop: (e: React.DragEvent, toHeatId: number) => void;
  /** Only passed for the selected heat, so the other cards stay memoised. */
  onStartScoring?: (() => void) | null;
  onUndoLastRace?: ((heat: HeatWithBoats) => void) | null;
  undoDisabled?: boolean;
}

const allowDrop = (e: React.DragEvent) => {
  e.preventDefault();
};

/**
 * One heat card: its name and scored state, the boat table, and (once
 * selected) the Start Scoring / Undo actions. Memoised: a heat view can hold
 * 26 heats of 20 boats, and none of them should redraw because a button
 * elsewhere on the page went busy.
 */
function HeatColumn({
  heat,
  clickable,
  selected,
  boatsDraggable,
  onSelect,
  onBoatDrop,
  onStartScoring = null,
  onUndoLastRace = null,
  undoDisabled = false,
}: HeatColumnProps) {
  const select = () => {
    if (clickable) onSelect(heat);
  };

  return (
    <div
      className={`heat-column${clickable ? ' clickable' : ''}${
        selected ? ' selected' : ''
      }`}
      onClick={select}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (clickable && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          select();
        }
      }}
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
      {selected && (onStartScoring || onUndoLastRace) && (
        <div className="heat-card-actions">
          {onStartScoring && (
            <button
              type="button"
              className="btn-success"
              onClick={(e) => {
                e.stopPropagation();
                onStartScoring();
              }}
            >
              <i className="fa fa-play" aria-hidden="true" /> Start Scoring
            </button>
          )}
          {onUndoLastRace && heat.raceNumber > 0 && (
            <button
              type="button"
              className="btn-secondary"
              title={`Delete Race ${heat.raceNumber} in ${heat.heat_name}`}
              disabled={undoDisabled}
              aria-busy={undoDisabled}
              onClick={(e) => {
                e.stopPropagation();
                onUndoLastRace(heat);
              }}
            >
              <i className="fa fa-undo" aria-hidden="true" /> Undo Race{' '}
              {heat.raceNumber}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default React.memo(HeatColumn);
