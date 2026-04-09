import React from 'react';
import PropTypes from 'prop-types';

/**
 * Floating popover for selecting races to average for an RDG2 redress.
 * Supports qualifying races (qualifyingEntry) and/or final-series races (entry).
 */
function Rdg2Picker({
  entry,
  raceIndex,
  rdg2Picker,
  setRdg2Picker,
  confirmRdg2,
  qualifyingEntry,
}) {
  if (!rdg2Picker?.anchorRect) return null;

  const totalSelected =
    (rdg2Picker.selectedIndices?.size ?? 0) +
    (rdg2Picker.selectedQualIndices?.size ?? 0);

  const hasQual = qualifyingEntry?.races?.length > 0;

  return (
    <div
      style={{
        position: 'fixed',
        top: rdg2Picker.anchorRect.bottom + 4,
        left: rdg2Picker.anchorRect.left,
        zIndex: 9999,
        background: '#fff',
        border: '1px solid var(--teal,#2a9d8f)',
        borderRadius: '8px',
        padding: '10px 14px',
        minWidth: '240px',
        width: 'max-content',
        boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
        textAlign: 'left',
      }}
    >
      <div
        style={{
          fontWeight: 700,
          fontSize: '0.9rem',
          marginBottom: '8px',
          color: 'var(--teal,#2a9d8f)',
        }}
      >
        Select races for RDG2
      </div>

      <div
        style={{ maxHeight: '300px', overflowY: 'auto', marginBottom: '8px' }}
      >
        {/* Qualifying races (if final series context) */}
        {hasQual && (
          <>
            <div
              style={{
                fontSize: '0.85rem',
                fontWeight: 700,
                color: '#888',
                marginBottom: '4px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Qualifying
            </div>
            {qualifyingEntry.races.map((_, qIdx) => {
              const checked =
                rdg2Picker.selectedQualIndices?.has(qIdx) ?? false;
              return (
                <label
                  // eslint-disable-next-line react/no-array-index-key
                  key={`q-${qIdx}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    marginBottom: '5px',
                    padding: '3px 4px',
                    borderRadius: '4px',
                    background: checked
                      ? 'rgba(42,157,143,0.08)'
                      : 'transparent',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      const newSet = new Set(
                        rdg2Picker.selectedQualIndices || [],
                      );
                      if (checked) newSet.delete(qIdx);
                      else newSet.add(qIdx);
                      setRdg2Picker({
                        ...rdg2Picker,
                        selectedQualIndices: newSet,
                      });
                    }}
                  />
                  Q{qIdx + 1}
                </label>
              );
            })}
            <div
              style={{
                fontSize: '0.85rem',
                fontWeight: 700,
                color: '#888',
                margin: '6px 0 4px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Final
            </div>
          </>
        )}

        {/* Final (or qualifying-only) races */}
        {entry.races.map((_, rIdx) => {
          if (rIdx === raceIndex) return null;
          const checked = rdg2Picker.selectedIndices.has(rIdx);
          const label = hasQual ? `F${rIdx + 1}` : `Q${rIdx + 1}`;
          return (
            <label
              // eslint-disable-next-line react/no-array-index-key
              key={`f-${rIdx}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '0.85rem',
                cursor: 'pointer',
                marginBottom: '5px',
                padding: '3px 4px',
                borderRadius: '4px',
                background: checked
                  ? 'rgba(42,157,143,0.08)'
                  : 'transparent',
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => {
                  const newSet = new Set(rdg2Picker.selectedIndices);
                  if (checked) newSet.delete(rIdx);
                  else newSet.add(rIdx);
                  setRdg2Picker({ ...rdg2Picker, selectedIndices: newSet });
                }}
              />
              {label}
            </label>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: '6px' }}>
        <button
          type="button"
          onClick={confirmRdg2}
          disabled={totalSelected === 0}
          style={{
            flex: 1,
            fontSize: '0.9rem',
            padding: '8px 10px',
            borderRadius: '5px',
            background: 'var(--teal,#2a9d8f)',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            fontWeight: 600,
            opacity: totalSelected === 0 ? 0.4 : 1,
          }}
        >
          Apply
        </button>
        <button
          type="button"
          onClick={() => setRdg2Picker(null)}
          style={{
            flex: 1,
            fontSize: '0.9rem',
            padding: '8px 10px',
            borderRadius: '5px',
            background: 'var(--surface,#f5f7fa)',
            border: '1px solid var(--border,#dde3ea)',
            color: 'var(--navy,#1a2e44)',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

Rdg2Picker.propTypes = {
  entry: PropTypes.shape({
    races: PropTypes.arrayOf(PropTypes.oneOfType([PropTypes.string, PropTypes.number])),
  }).isRequired,
  raceIndex: PropTypes.number.isRequired,
  rdg2Picker: PropTypes.shape({
    anchorRect: PropTypes.shape({ bottom: PropTypes.number, left: PropTypes.number }),
    selectedIndices: PropTypes.instanceOf(Set),
    selectedQualIndices: PropTypes.instanceOf(Set),
  }).isRequired,
  setRdg2Picker: PropTypes.func.isRequired,
  confirmRdg2: PropTypes.func.isRequired,
  qualifyingEntry: PropTypes.shape({
    races: PropTypes.array,
  }),
};

Rdg2Picker.defaultProps = {
  qualifyingEntry: null,
};

export default Rdg2Picker;
