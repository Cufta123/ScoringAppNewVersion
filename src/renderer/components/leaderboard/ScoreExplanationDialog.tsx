import React, { useEffect, useRef, useState } from 'react';
import { heatRaceDB } from '../../api/db';
import type {
  BoatScoreExplanation,
  ExplainedRace,
  Reason,
  SeriesBlock,
} from '../../../shared/scoring/explain';
import { roundPoints } from '../../../shared/points';

export interface ExplainTarget {
  boatId: number;
  sail: string;
  name: string;
  place?: number | null;
}

interface ScoreExplanationDialogProps {
  eventId: number;
  target: ExplainTarget | null;
  onClose: () => void;
}

function RuleTag({ rule }: { rule: string }) {
  if (!rule) return null;
  return <span className="explain-rule">{rule}</span>;
}

function ReasonText({ reason }: { reason: Reason }) {
  return (
    <>
      {reason.text} <RuleTag rule={reason.rule} />
    </>
  );
}

const resultOf = (race: ExplainedRace) => {
  if (race.status === 'FINISHED') return String(race.position);
  if (['ZFP', 'SCP', 'T1'].includes(race.status)) {
    return `${race.position} ${race.status}`;
  }
  return race.status;
};

function SeriesSection({
  title,
  block,
  boatId,
  sail,
}: {
  title: string;
  block: SeriesBlock;
  boatId: number;
  sail: string;
}) {
  const excludedPoints = roundPoints(block.gross - block.total);
  return (
    <section>
      <h4>
        {title}: {block.total} points
      </h4>
      {block.races.length === 0 ? (
        <p>{block.discards.text}</p>
      ) : (
        <>
          <table className="explain-table">
            <thead>
              <tr>
                <th scope="col">Race</th>
                <th scope="col">Result</th>
                <th scope="col">Points</th>
                <th scope="col">Why</th>
              </tr>
            </thead>
            <tbody>
              {block.races.map((race) => (
                <tr
                  key={race.race_id}
                  className={race.excluded ? 'explain-excluded' : undefined}
                >
                  <th scope="row">{race.label}</th>
                  <td>{resultOf(race)}</td>
                  <td>
                    {race.excluded ? `(${race.points})` : race.points}
                    {race.excluded && (
                      <span className="explain-excluded-tag">excluded</span>
                    )}
                  </td>
                  <td>
                    <ReasonText reason={race.reason} />
                    {race.exclusionNote && (
                      <div className="explain-note">
                        <ReasonText reason={race.exclusionNote} />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            <ReasonText reason={block.discards} />
          </p>
          <p className="explain-sum">
            {block.discards.count > 0
              ? `All races ${block.gross} − excluded ${excludedPoints} = ${block.total} points.`
              : `All races added up: ${block.total} points.`}
          </p>
        </>
      )}
      {block.ties.length > 0 && (
        <div className="explain-ties">
          <h5>Tied on points</h5>
          <ul>
            {block.ties.map((tie) => {
              let outcome = `${sail} and ${tie.sail} could not be separated, so they share the place.`;
              if (tie.winnerBoatId === String(boatId)) {
                outcome = `${sail} is ranked ahead of ${tie.sail}.`;
              } else if (tie.winnerBoatId != null) {
                outcome = `${tie.sail} is ranked ahead of ${sail}.`;
              }
              return (
                <li key={tie.boat_id}>
                  {outcome} {tie.note} <RuleTag rule={tie.rule} />
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

/**
 * "How was this score calculated?" for one boat. Everything shown comes from
 * the main process, which explains with the same scoring core that ranks the
 * boats, so the explanation cannot drift from the leaderboard.
 */
function ScoreExplanationDialog({
  eventId,
  target,
  onClose,
}: ScoreExplanationDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [explanation, setExplanation] = useState<BoatScoreExplanation | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return undefined;
    let cancelled = false;
    setExplanation(null);
    setError(null);
    Promise.resolve()
      .then(() => heatRaceDB.explainBoatScore(eventId, target.boatId))
      .then((result) => {
        if (!cancelled) setExplanation(result);
        return null;
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, target]);

  useEffect(() => {
    if (!target) return undefined;
    const lastFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (typeof lastFocused?.focus === 'function') lastFocused.focus();
    };
  }, [target, onClose]);

  if (!target) return null;

  const title = `How ${target.sail}'s score was calculated`;
  let body: React.ReactNode = <p>Loading…</p>;
  if (error) {
    body = <p role="alert">Could not explain this score: {error}</p>;
  } else if (explanation) {
    body = (
      <>
        {explanation.overall && (
          <section>
            <h4>Overall: {explanation.overall.points} points</h4>
            <p>
              {explanation.overall.text}{' '}
              <RuleTag rule={explanation.overall.rule} />
            </p>
          </section>
        )}
        {explanation.final && (
          <SeriesSection
            title={`Final series (${explanation.final.fleet})`}
            block={explanation.final}
            boatId={target.boatId}
            sail={target.sail}
          />
        )}
        {explanation.qualifying && (
          <SeriesSection
            title="Qualifying series"
            block={explanation.qualifying}
            boatId={target.boatId}
            sail={target.sail}
          />
        )}
        {!explanation.qualifying && !explanation.final && (
          <p>No races have been scored for this boat yet.</p>
        )}
      </>
    );
  }

  return (
    <div
      className="feedback-modal-overlay"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="feedback-modal help-modal explain-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <h3 className="feedback-modal-title">{title}</h3>
        <p className="explain-subtitle">
          {target.name}
          {target.place != null ? ` — place ${target.place}` : ''}
        </p>
        <div className="help-modal-body">{body}</div>
        <div className="feedback-modal-actions">
          <button
            ref={closeRef}
            type="button"
            className="btn-outline"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default ScoreExplanationDialog;
