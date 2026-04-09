import React, { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';

/**
 * Compare mode panel. Shows a hint when waiting for boat selection, or the
 * full side-by-side tie-breaking breakdown once two boats are selected.
 *
 * Uses a CSS grid-template-rows trick to animate height smoothly without
 * needing to know the content height in advance.
 * When the content changes (hint → full breakdown), it cross-fades so the
 * height swap happens while the panel is invisible.
 */
function ComparePanel({ show, compareInfo = null, selectedBoatIds }) {
  // `displayed` is what's actually rendered; it lags behind compareInfo
  // by one fade-out cycle so the height change isn't visible.
  const [displayed, setDisplayed] = useState(compareInfo);
  const [fading, setFading] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    // When the panel is hidden, sync immediately with no animation.
    if (!show) {
      setDisplayed(compareInfo);
      setFading(false);
      return;
    }
    // Don't animate if content hasn't changed.
    if (compareInfo === displayed) return;

    // Expanding (hint → full comparison): swap immediately so the panel
    // just grows — no fake close/reopen.
    if (!displayed && compareInfo) {
      setDisplayed(compareInfo);
      return;
    }

    // Shrinking (full → hint, or different comparison): fade out first so
    // the height change isn't jarring.
    clearTimeout(timerRef.current);
    setFading(true);
    timerRef.current = setTimeout(() => {
      setDisplayed(compareInfo);
      setFading(false);
    }, 160);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareInfo, show]);

  const inner = (() => {
    // Waiting for selection
    if (!displayed) {
      return (
        <div
          style={{
            padding: '9px 14px',
            borderRadius: '8px',
            border: '1px solid var(--border, #dde3ea)',
            background: 'var(--surface, #f5f7fa)',
            fontSize: '0.9rem',
            color: '#888',
          }}
        >
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
      sharedRacePairs,
      sharedQualRacePairs,
      sharedIds,
      otherTiedCount = 0,
    } = displayed;

    return (
      <div
        style={{
          padding: '14px 16px',
          borderRadius: '8px',
          border: '1px solid var(--border, #dde3ea)',
          background: 'var(--surface, #f5f7fa)',
          fontSize: '0.85rem',
          color: 'var(--navy)',
        }}
      >
        {/* ── Header: names + totals ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
            marginBottom: '10px',
          }}
        >
          <span
            style={{
              fontWeight: 700,
              fontSize: '0.95rem',
              color: 'var(--teal, #2a9d8f)',
            }}
          >
            {boatA.name} {boatA.surname}
          </span>
          <span
            style={{
              padding: '1px 8px',
              borderRadius: '4px',
              background: 'var(--navy, #1d3557)',
              color: '#fff',
              fontWeight: 700,
              fontSize: '0.92rem',
            }}
          >
            {totalA}
          </span>
          <span style={{ color: '#aaa', fontWeight: 400 }}>vs</span>
          <span
            style={{
              fontWeight: 700,
              fontSize: '0.95rem',
              color: 'var(--teal, #2a9d8f)',
            }}
          >
            {boatB.name} {boatB.surname}
          </span>
          <span
            style={{
              padding: '1px 8px',
              borderRadius: '4px',
              background: 'var(--navy, #1d3557)',
              color: '#fff',
              fontWeight: 700,
              fontSize: '0.92rem',
            }}
          >
            {totalB}
          </span>
        </div>

        {/* ── Not tied ── */}
        {!tied && (
          <div
            style={{
              padding: '6px 10px',
              borderRadius: '6px',
              background: 'rgba(42,157,143,0.1)',
              border: '1px solid rgba(42,157,143,0.25)',
              marginBottom: '8px',
            }}
          >
            <strong style={{ marginRight: '6px' }}>Status: NOT TIED.</strong>
            <strong>
              {totalA < totalB
                ? `${boatA.name} ${boatA.surname}`
                : `${boatB.name} ${boatB.surname}`}
            </strong>{' '}
            leads by{' '}
            <strong>
              {Math.abs(totalA - totalB)} pt
              {Math.abs(totalA - totalB) !== 1 ? 's' : ''}
            </strong>
            . No tie — tie-breaking not required.
          </div>
        )}

        {/* ── Multi-boat tie warning ── */}
        {tied && otherTiedCount > 0 && (
          <div
            style={{
              padding: '6px 10px',
              borderRadius: '6px',
              background: 'rgba(180,0,0,0.06)',
              border: '1px solid rgba(180,0,0,0.22)',
              marginBottom: '8px',
              fontSize: '0.88rem',
              lineHeight: 1.5,
              color: '#7a1010',
            }}
          >
            <strong>
              ⚠️ {otherTiedCount} other boat{' '}
              {otherTiedCount !== 1 ? 's are' : 'is'} also tied at {totalA} pts.
            </strong>{' '}
            This pairwise comparison shows who wins the direct matchup, but the{' '}
            <strong>
              overall ranking sorts all {otherTiedCount + 2} tied boats together
            </strong>
            . In a 3-way (or more) tie with different shared heats, the pairwise
            result can differ from the final standings if a cyclic dominance
            exists (A beats B, B beats C, C beats A).
          </div>
        )}

        {/* ── Tied ── */}
        {tied && tieBreak && (
          <div
            style={{
              padding: '6px 10px',
              borderRadius: '6px',
              background: 'rgba(255,150,0,0.08)',
              border: '1px solid rgba(255,150,0,0.3)',
              marginBottom: '8px',
              lineHeight: 1.5,
            }}
          >
            <span
              style={{
                fontWeight: 700,
                color: 'darkorange',
                marginRight: '6px',
              }}
            >
              Status: TIED
            </span>
            {tieBreak.winner ? (
              <span>
                — Tie broken in favour of{' '}
                <strong>
                  {tieBreak.winner.name} {tieBreak.winner.surname}
                </strong>
                .
              </span>
            ) : (
              <span style={{ color: '#888' }}>— Tie could not be broken.</span>
            )}

            {/* Rule-by-rule breakdown */}
            {tieBreak.steps && tieBreak.steps.length > 0 && (
              <div style={{ marginTop: '8px', fontSize: '0.88rem' }}>
                <div
                  style={{
                    fontWeight: 600,
                    color: '#555',
                    marginBottom: '4px',
                  }}
                >
                  Rules applied:
                </div>
                {tieBreak.steps.map((step, idx) => {
                  const stepColor =
                    // eslint-disable-next-line no-nested-ternary
                    step.resolved === true
                      ? 'var(--teal, #2a9d8f)'
                      : step.resolved === false
                        ? '#c44'
                        : '#666';
                  const iconMap = { true: '\u2713', false: '\u2717' };
                  const icon = iconMap[String(step.resolved)] || '\u2192';
                  return (
                    <div
                      key={step.rule}
                      style={{
                        display: 'flex',
                        gap: '6px',
                        padding: '3px 0',
                        borderTop:
                          idx > 0 ? '1px solid rgba(0,0,0,0.05)' : 'none',
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 600,
                          color: stepColor,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {icon} {step.rule}
                      </span>
                      <span style={{ color: '#666' }}>{step.note}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Shared race badges ── */}
        {sharedQualRacePairs?.length > 0 || sharedIds.size > 0 ? (
          <div>
            <span style={{ color: '#888', fontSize: '0.88rem' }}>
              Shared heat races (highlighted):{' '}
            </span>
            {/* Qualifying */}
            {sharedQualRacePairs?.map((pair, i) => (
              <span
                key={`q-${pair.raceId}`}
                style={{
                  display: 'inline-block',
                  margin: '2px 3px',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  background: 'rgba(41,98,255,0.15)',
                  border: '1px solid rgba(41,98,255,0.3)',
                  fontWeight: 600,
                  fontSize: '0.88rem',
                }}
              >
                Q{i + 1}: {pair.displayA}{' '}
                <span style={{ color: '#aaa', fontWeight: 400 }}>vs</span>{' '}
                {pair.displayB}
              </span>
            ))}
            {/* Final */}
            {sharedRacePairs.map((pair, i) => (
              <span
                key={`f-${pair.raceId}`}
                style={{
                  display: 'inline-block',
                  margin: '2px 3px',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  background: 'rgba(255,210,0,0.35)',
                  border: '1px solid rgba(180,150,0,0.25)',
                  fontWeight: 600,
                  fontSize: '0.88rem',
                }}
              >
                F{i + 1}: {pair.displayA}{' '}
                <span style={{ color: '#aaa', fontWeight: 400 }}>vs</span>{' '}
                {pair.displayB}
              </span>
            ))}
          </div>
        ) : (
          <div style={{ color: '#888', fontSize: '0.88rem', marginTop: '2px' }}>
            No shared heats found.
            {tied
              ? ' SHRS 5.6(ii)(b): full RRS A8.1 & A8.2 apply without modification.'
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

ComparePanel.propTypes = {
  show: PropTypes.bool.isRequired,
  compareInfo: PropTypes.shape({
    boatA: PropTypes.object,
    boatB: PropTypes.object,
    totalA: PropTypes.number,
    totalB: PropTypes.number,
    tied: PropTypes.bool,
    tieBreak: PropTypes.object,
    sharedIds: PropTypes.instanceOf(Set),
    sharedRacePairs: PropTypes.array,
    sharedQualRacePairs: PropTypes.array,
  }),
  selectedBoatIds: PropTypes.arrayOf(PropTypes.number).isRequired,
};

export default ComparePanel;
