import React from 'react';
import type { EventStatusView } from '../../../shared/eventStatus';
import type { HeatWithBoats } from '../../utils/heatView';

interface RoundBarProps {
  /** Where the event stands and what may be done (readEventStatus). */
  status: EventStatusView | null;
  /** The heats on screen, to open the next heat's scoring. */
  heats: HeatWithBoats[];
  busy: boolean;
  noHeats: boolean;
  onScore: (heat: HeatWithBoats) => void;
  onCreateRound?: (() => void) | null;
  onUndoRedistribution?: (() => void) | null;
  onStartFinalSeries: () => void;
  onExport: () => void;
  /** Earlier rounds exist: offer to show them too. */
  hasMultipleRounds?: boolean;
  displayLastHeats?: boolean;
  onToggleDisplayMode?: () => void;
}

/**
 * One line on where the series stands, worded from the status: "Round 4 ·
 * 1 of 3 heats scored", or for one heat or the fleets the race being sailed.
 */
export function roundSummary(status: EventStatusView): string | null {
  const { heats, next } = status;
  if (status.series === 'entries' || heats.length === 0) return null;
  if (status.series === 'qualifying' && heats.length > 1) {
    const scored = heats.filter((heat) => heat.races > 0).length;
    return `Round ${status.round} · ${scored} of ${heats.length} heats scored`;
  }
  const race = next.kind === 'score' ? next.race : 1;
  if (heats.length === 1) return `Race ${race} next`;
  const done = heats.filter((heat) => heat.races >= race).length;
  const unit = status.series === 'final' ? 'fleets' : 'heats';
  return `Race ${race} · ${done} of ${heats.length} ${unit} scored`;
}

/**
 * The top of the heats: where the series stands, then its one next step (the
 * green button, first) and the less frequent round actions after it, quieter.
 * What is offered, and whether it may be done, is the status's
 * (regatta-core's eventStatus); a refused action is shown disabled with the
 * reason as its title.
 */
export default function RoundBar({
  status,
  heats,
  busy,
  noHeats,
  onScore,
  onCreateRound = null,
  onUndoRedistribution = null,
  onStartFinalSeries,
  onExport,
  hasMultipleRounds = false,
  displayLastHeats = true,
  onToggleDisplayMode = () => {},
}: RoundBarProps) {
  const next = status?.next ?? null;
  const summary = status ? roundSummary(status) : null;
  const nextHeat =
    next?.kind === 'score'
      ? heats.find((heat) => heat.heat_id === next.heat_id)
      : undefined;
  const createRound = status?.createRound;
  const undoRound = status?.undoRound;
  return (
    <div className="round-bar">
      <div className="round-bar-status">
        <h2>
          <i className="fa fa-flag" aria-hidden="true" />
          Heats
        </h2>
        {status && summary && (
          <p role="status">
            <span
              className={`round-bar-phase ${
                status.series === 'final' ? 'is-final' : 'is-qualifying'
              }`}
            >
              {status.series === 'final' ? 'Final Series' : 'Qualifying'}
            </span>
            {summary}
            {hasMultipleRounds && (
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={onToggleDisplayMode}
              >
                {displayLastHeats
                  ? 'Show earlier rounds'
                  : 'Show this round only'}
              </button>
            )}
          </p>
        )}
      </div>

      <div className="round-bar-actions">
        {next?.kind === 'score' && nextHeat && (
          <button
            type="button"
            className="btn-success"
            onClick={() => onScore(nextHeat)}
            disabled={busy}
          >
            <i className="fa fa-play" aria-hidden="true" />
            Score {next.heat_name}
            {next.race > 1 ? ` · race ${next.race}` : ''}
          </button>
        )}
        {next?.kind === 'createRound' &&
          createRound?.offered &&
          onCreateRound && (
            <button
              type="button"
              className="btn-success"
              onClick={onCreateRound}
              disabled={busy || !createRound.ok}
              title={
                createRound.ok
                  ? "Build the next round's heats from the current leaderboard"
                  : createRound.reason
              }
            >
              <i className="fa fa-shuffle" aria-hidden="true" />
              Create Round {next.round}
            </button>
          )}
        {status?.startFinal.offered && (
          <button
            type="button"
            className={
              next?.kind === 'createRound' ? 'btn-outline' : 'btn-ghost'
            }
            onClick={onStartFinalSeries}
            disabled={busy}
            title="Split the boats into final fleets (Gold, Silver, …) by the current standings"
          >
            <i className="fa fa-flag-checkered" aria-hidden="true" />
            Start Final Series
          </button>
        )}
        {undoRound?.offered && onUndoRedistribution && (
          <button
            type="button"
            className="btn-ghost"
            onClick={onUndoRedistribution}
            disabled={busy || !undoRound.ok}
            title={
              undoRound.ok
                ? "Delete the latest round's heats (built from the leaderboard)"
                : undoRound.reason
            }
          >
            <i className="fa fa-undo" aria-hidden="true" />
            Undo round
          </button>
        )}
        <button
          type="button"
          className="btn-ghost"
          onClick={onExport}
          disabled={noHeats || busy}
          title={noHeats ? 'Create the heats first' : undefined}
        >
          <i className="fa fa-print" aria-hidden="true" />
          Export heats…
        </button>
      </div>
    </div>
  );
}
