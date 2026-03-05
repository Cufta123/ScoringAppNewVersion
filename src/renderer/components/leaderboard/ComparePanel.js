import React from 'react';
import PropTypes from 'prop-types';

/**
 * Compare mode panel. Shows a hint when waiting for boat selection, or the
 * full side-by-side tie-breaking breakdown once two boats are selected.
 */
function ComparePanel({ compareMode, compareInfo, selectedBoatIds }) {
  if (!compareMode) return null;

  // Waiting for selection
  if (!compareInfo) {
    return (
      <div
        style={{
          marginTop: '10px',
          padding: '9px 14px',
          borderRadius: '8px',
          border: '1px solid var(--border, #dde3ea)',
          background: 'var(--surface, #f5f7fa)',
          fontSize: '0.83rem',
          color: '#888',
          marginBottom: '8px',
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
  } = compareInfo;

  return (
    <div
      style={{
        marginTop: '12px',
        padding: '14px 16px',
        borderRadius: '8px',
        border: '1px solid var(--border, #dde3ea)',
        background: 'var(--surface, #f5f7fa)',
        fontSize: '0.85rem',
        color: 'var(--navy)',
        marginBottom: '8px',
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
            style={{ fontWeight: 700, color: 'darkorange', marginRight: '6px' }}
          >
            TIED — {tieBreak.rule}
          </span>
          <span style={{ color: '#666', fontSize: '0.82rem' }}>
            ({tieBreak.detail})
          </span>
          <br />
          {tieBreak.winner ? (
            <span>
              Tie broken in favour of{' '}
              <strong>
                {tieBreak.winner.name} {tieBreak.winner.surname}
              </strong>
              .
            </span>
          ) : (
            <span style={{ color: '#888' }}>
              Still tied after applying {tieBreak.rule}.
            </span>
          )}
        </div>
      )}

      {/* ── Shared race badges ── */}
      {sharedQualRacePairs?.length > 0 || sharedIds.size > 0 ? (
        <div>
          <span style={{ color: '#888', fontSize: '0.82rem' }}>
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
                fontSize: '0.83rem',
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
                fontSize: '0.83rem',
              }}
            >
              F{i + 1}: {pair.displayA}{' '}
              <span style={{ color: '#aaa', fontWeight: 400 }}>vs</span>{' '}
              {pair.displayB}
            </span>
          ))}
        </div>
      ) : (
        <div style={{ color: '#888', fontSize: '0.82rem', marginTop: '2px' }}>
          No shared heats found.
          {tied
            ? ' SHRS 5.6(ii)(b): full RRS A8.1 & A8.2 apply without modification.'
            : ''}
        </div>
      )}
    </div>
  );
}

ComparePanel.propTypes = {
  compareMode: PropTypes.bool.isRequired,
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

ComparePanel.defaultProps = {
  compareInfo: null,
};

export default ComparePanel;
