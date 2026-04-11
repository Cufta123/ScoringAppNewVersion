import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';

function getStepStatusClass(resolved) {
  if (resolved === true) return 'compare-step-resolved';
  if (resolved === false) return 'compare-step-unresolved';
  return 'compare-step-neutral';
}

function getStepStatusText(resolved) {
  if (resolved === true) return 'resolved';
  if (resolved === false) return 'unresolved';
  return 'info';
}

function ComparePanel({ show, compareInfo, selectedBoatIds }) {
  const [displayed, setDisplayed] = useState(compareInfo);
  const [fading, setFading] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!show) {
      setDisplayed(compareInfo);
      setFading(false);
      return;
    }

    if (compareInfo === displayed) return;

    if (!displayed && compareInfo) {
      setDisplayed(compareInfo);
      return;
    }

    clearTimeout(timerRef.current);
    setFading(true);
    timerRef.current = setTimeout(() => {
      setDisplayed(compareInfo);
      setFading(false);
    }, 160);
  }, [compareInfo, displayed, show]);

  useEffect(() => {
    setShowDetail(false);
  }, [compareInfo]);

  const renderScoreValue = (value, excluded) => {
    if (value === undefined || value === null) return '–';
    if (!excluded) return value;
    return `(${value})`;
  };

  const inner = (() => {
    if (!displayed) {
      return (
        <div className="compare-hint">
          {selectedBoatIds.length === 0
            ? 'Click two rows to compare (SHRS 5.6 tie-breaking).'
            : 'Select one more competitor to compare.'}
        </div>
      );
    }

    const {
      boatA,
      boatB,
      totalA,
      totalB,
      tied,
      tieBreak,
      routeStep,
      raceGrid = [],
      sharedRacePairs,
      sharedQualRacePairs,
      sharedIds,
      otherTiedCount = 0,
      tiedGroupEntries = [],
    } = displayed;

    const boatAName = `${boatA.name} ${boatA.surname}`;
    const boatBName = `${boatB.name} ${boatB.surname}`;

    const routeFallback =
      tieBreak?.steps?.find((step) =>
        String(step.rule || '').startsWith('SHRS'),
      ) || null;

    const visibleSteps =
      tieBreak?.steps?.filter(
        (step) => !String(step.rule || '').startsWith('SHRS'),
      ) || [];

    const route =
      routeStep ||
      (routeFallback
        ? {
            rule: routeFallback.rule,
            note: routeFallback.note,
          }
        : null);

    const boatAWins = tieBreak?.winner?.boat_id === boatA.boat_id;

    return (
      <div className="compare-panel-card">
        <div className="compare-header">
          <span className="compare-boat-name">{boatAName}</span>
          <span className="compare-total-pill">{totalA}</span>
          <span className="compare-vs">vs</span>
          <span className="compare-boat-name">{boatBName}</span>
          <span className="compare-total-pill">{totalB}</span>
        </div>

        {!tied && (
          <div className="compare-status compare-status-ok">
            <strong>Status: NOT TIED.</strong>{' '}
            <strong>{totalA < totalB ? boatAName : boatBName}</strong> leads by{' '}
            <strong>
              {Math.abs(totalA - totalB)} pt
              {Math.abs(totalA - totalB) !== 1 ? 's' : ''}
            </strong>
            . No tie and no tie-break required.
          </div>
        )}

        {tied && otherTiedCount > 0 && (
          <div className="compare-status compare-status-warn">
            <strong>
              {otherTiedCount} other boat{' '}
              {otherTiedCount !== 1 ? 's are' : 'is'} also tied at {totalA} pts.
            </strong>{' '}
            Pairwise detail is shown below, while final ordering for this tie
            group is resolved winner-first and then recalculated for remaining
            tied boats (SHRS 5.7(ii)(3)).
            {tiedGroupEntries.length > 2 && (
              <div className="compare-tied-group-wrap">
                <div className="compare-tied-group-title">
                  Current order of this tied group:
                </div>
                <div className="compare-tied-group-list">
                  {tiedGroupEntries.map((entry) => {
                    const rank = entry.overall_rank ?? entry.place ?? '–';
                    return (
                      <span
                        key={`tg-${entry.boat_id}`}
                        className="compare-tied-group-chip"
                      >
                        #{rank} {entry.name} {entry.surname}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

          </div>
        )}

        {tied && tieBreak && (
          <div className="compare-status compare-status-tied">
            <span className="compare-status-title">Status: TIED</span>{' '}
            {tieBreak.winner ? (
              <span>
                Tie broken in favour of{' '}
                <strong>
                  {tieBreak.winner.name} {tieBreak.winner.surname}
                </strong>
                .
              </span>
            ) : (
              <span className="compare-muted">Tie could not be broken.</span>
            )}
            {route && (
              <div className="compare-route-banner">
                <span className="compare-route-rule">{route.rule}</span>
                <span>{route.note}</span>
              </div>
            )}
            {visibleSteps.length > 0 && (
              <div className="compare-steps-wrap">
                <div className="compare-steps-title">Rule resolution</div>
                {visibleSteps.map((step) => {
                  const statusClass = getStepStatusClass(step.resolved);
                  const statusText = getStepStatusText(step.resolved);

                  let comparisonLine = null;
                  if (step.comparison?.mode === 'A8.1') {
                    comparisonLine = (
                      <div className="compare-step-detail">
                        <span
                          className={
                            boatAWins
                              ? 'compare-name-winner'
                              : 'compare-name-loser'
                          }
                        >
                          {boatAName}
                        </span>{' '}
                        {step.comparison.scoreA} vs{' '}
                        <span
                          className={
                            !boatAWins
                              ? 'compare-name-winner'
                              : 'compare-name-loser'
                          }
                        >
                          {boatBName}
                        </span>{' '}
                        {step.comparison.scoreB} at sorted position{' '}
                        {step.comparison.position}.
                      </div>
                    );
                  }

                  if (step.comparison?.mode === 'A8.2') {
                    const breaker = raceGrid.find((race) => race.isBreaker);
                    comparisonLine = (
                      <div className="compare-step-detail">
                        <span
                          className={
                            boatAWins
                              ? 'compare-name-winner'
                              : 'compare-name-loser'
                          }
                        >
                          {boatAName}
                        </span>{' '}
                        {step.comparison.scoreA} vs{' '}
                        <span
                          className={
                            !boatAWins
                              ? 'compare-name-winner'
                              : 'compare-name-loser'
                          }
                        >
                          {boatBName}
                        </span>{' '}
                        {step.comparison.scoreB}
                        {breaker ? ` at ${breaker.label}` : ''}.
                      </div>
                    );
                  }

                  return (
                    <div
                      key={`${step.rule}-${String(step.resolved)}`}
                      className={`compare-step-card ${statusClass}`}
                    >
                      <div className="compare-step-head">
                        <span className="compare-step-rule">{step.rule}</span>
                        <span className="compare-step-state">{statusText}</span>
                      </div>
                      {step.subtitle && (
                        <div className="compare-step-subtitle">
                          {step.subtitle}
                        </div>
                      )}
                      {comparisonLine || (
                        <div className="compare-step-note">{step.note}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {raceGrid.length > 0 && (
              <div className="compare-detail-section">
                <button
                  type="button"
                  className="compare-detail-toggle"
                  onClick={() => setShowDetail((prev) => !prev)}
                  aria-expanded={showDetail}
                >
                  {showDetail
                    ? 'Hide race-by-race detail'
                    : 'Show race-by-race detail'}
                </button>

                <div
                  className={`compare-grid-shell ${showDetail ? 'open' : ''}`}
                >
                  <div
                    className="compare-grid-inner"
                    style={{
                      gridTemplateColumns: `120px repeat(${raceGrid.length}, minmax(52px, auto))`,
                    }}
                  >
                    <div className="compare-grid-header-cell compare-grid-row-label" />
                    {raceGrid.map((race) => (
                      <div
                        key={`h-${race.key}`}
                        className={`compare-grid-header-cell ${
                          race.isBreaker ? 'compare-grid-breaker' : ''
                        }`}
                      >
                        {race.label}
                      </div>
                    ))}

                    <div className="compare-grid-row-label compare-grid-row-a">
                      {boatAName}
                    </div>
                    {raceGrid.map((race) => (
                      <div
                        key={`a-${race.key}`}
                        className={`compare-grid-score ${
                          race.isBreaker ? 'compare-grid-breaker' : ''
                        } ${race.excludedA ? 'compare-grid-excluded' : ''}`}
                      >
                        {renderScoreValue(race.scoreA, race.excludedA)}
                      </div>
                    ))}

                    <div className="compare-grid-row-label compare-grid-row-b">
                      {boatBName}
                    </div>
                    {raceGrid.map((race) => (
                      <div
                        key={`b-${race.key}`}
                        className={`compare-grid-score ${
                          race.isBreaker ? 'compare-grid-breaker' : ''
                        } ${race.excludedB ? 'compare-grid-excluded' : ''}`}
                      >
                        {renderScoreValue(race.scoreB, race.excludedB)}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {sharedQualRacePairs?.length > 0 || sharedIds.size > 0 ? (
          <div className="compare-badges-wrap">
            <span className="compare-badges-label">Shared heat races:</span>
            {sharedQualRacePairs?.map((pair, i) => (
              <span
                key={`q-${pair.raceId}`}
                className="compare-badge compare-badge-qual"
              >
                Q{i + 1}: {pair.displayA} <span className="compare-vs">vs</span>{' '}
                {pair.displayB}
              </span>
            ))}
            {sharedRacePairs.map((pair, i) => (
              <span
                key={`f-${pair.raceId}`}
                className="compare-badge compare-badge-final"
              >
                F{i + 1}: {pair.displayA} <span className="compare-vs">vs</span>{' '}
                {pair.displayB}
              </span>
            ))}
          </div>
        ) : (
          <div className="compare-muted compare-no-shared">
            No shared heats found.
            {tied
              ? ' SHRS 5.6(ii)(b): full RRS A8.1 and A8.2 apply without modification.'
              : ''}
          </div>
        )}
      </div>
    );
  })();

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateRows: show ? '1fr' : '0fr',
        transition:
          'grid-template-rows 0.3s cubic-bezier(0.4, 0, 0.2, 1), margin-top 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        marginTop: show ? '10px' : '0px',
      }}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div
        style={{
          overflow: 'hidden',
          opacity: show && !fading ? 1 : 0,
          transform: show && !fading ? 'translateY(0)' : 'translateY(-5px)',
          transition: 'opacity 0.18s ease, transform 0.18s ease',
          minHeight: 0,
        }}
      >
        {inner}
      </div>
    </div>
  );
}

const boatShape = PropTypes.shape({
  boat_id: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  name: PropTypes.string,
  surname: PropTypes.string,
});

const tieStepShape = PropTypes.shape({
  rule: PropTypes.string,
  note: PropTypes.string,
  subtitle: PropTypes.string,
  resolved: PropTypes.bool,
  comparison: PropTypes.shape({
    mode: PropTypes.string,
    scoreA: PropTypes.number,
    scoreB: PropTypes.number,
    position: PropTypes.number,
    raceId: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  }),
});

ComparePanel.propTypes = {
  show: PropTypes.bool.isRequired,
  compareInfo: PropTypes.oneOfType([
    PropTypes.shape({
      boatA: boatShape,
      boatB: boatShape,
      totalA: PropTypes.number,
      totalB: PropTypes.number,
      tied: PropTypes.bool,
      tieBreak: PropTypes.shape({
        winner: boatShape,
        steps: PropTypes.arrayOf(tieStepShape),
      }),
      routeStep: PropTypes.shape({
        rule: PropTypes.string,
        note: PropTypes.string,
      }),
      raceGrid: PropTypes.arrayOf(
        PropTypes.shape({
          key: PropTypes.string,
          label: PropTypes.string,
          scoreA: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
          scoreB: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
          excludedA: PropTypes.bool,
          excludedB: PropTypes.bool,
          isBreaker: PropTypes.bool,
        }),
      ),
      sharedIds: PropTypes.instanceOf(Set),
      sharedRacePairs: PropTypes.arrayOf(PropTypes.object),
      sharedQualRacePairs: PropTypes.arrayOf(PropTypes.object),
      otherTiedCount: PropTypes.number,
      tiedGroupEntries: PropTypes.arrayOf(boatShape),
    }),
    PropTypes.oneOf([null]),
  ]).isRequired,
  selectedBoatIds: PropTypes.arrayOf(
    PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  ).isRequired,
};

export default ComparePanel;
