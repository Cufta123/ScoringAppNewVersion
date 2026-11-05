import React from 'react';
import type { RoundStatus } from '../../utils/roundStatus';
import type { HeatWithBoats } from '../../utils/heatView';

interface RoundBarProps {
  status: RoundStatus<HeatWithBoats> | null;
  /** SHRS 1.1: 2+ qualifying groups and no Final Series yet. */
  canStartFinalSeries: boolean;
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
 * The top of the heats: where the series stands, then its one next step (the
 * green button, first) and the less frequent round actions after it, quieter.
 * Replaces a card of round buttons above the heats, a hint saying which
 * buttons appear where, and Start Final Series at the bottom.
 */
export default function RoundBar({
  status,
  canStartFinalSeries,
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
  return (
    <div className="round-bar">
      <div className="round-bar-status">
        <h2>
          <i className="fa fa-flag" aria-hidden="true" />
          Heats
        </h2>
        {status && (
          <p role="status">
            <span
              className={`round-bar-phase ${
                status.phase === 'final' ? 'is-final' : 'is-qualifying'
              }`}
            >
              {status.phase === 'final' ? 'Final Series' : 'Qualifying'}
            </span>
            {status.summary}
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
        {next?.kind === 'score' && (
          <button
            type="button"
            className="btn-success"
            onClick={() => onScore(next.heat)}
            disabled={busy}
          >
            <i className="fa fa-play" aria-hidden="true" />
            Score {next.heat.heat_name}
            {next.race > 1 ? ` · race ${next.race}` : ''}
          </button>
        )}
        {next?.kind === 'createRound' && onCreateRound && (
          <button
            type="button"
            className="btn-success"
            onClick={onCreateRound}
            disabled={busy}
            title="Build the next round's heats from the current leaderboard"
          >
            <i className="fa fa-shuffle" aria-hidden="true" />
            Create Round {next.round}
          </button>
        )}
        {canStartFinalSeries && (
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
        {status?.canUndoRedistribution && onUndoRedistribution && (
          <button
            type="button"
            className="btn-ghost"
            onClick={onUndoRedistribution}
            disabled={busy}
            title="Delete the latest round's heats (built from the leaderboard)"
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
