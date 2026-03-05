import React, { useState } from 'react';
import PropTypes from 'prop-types';
import Flag from 'react-world-flags';
import ScoreCell from './ScoreCell';
import SectionDivider from './SectionDivider';

/**
 * Qualifying series results table.
 * Shown only when the final series has NOT started.
 */
function QualifyingTable({
  leaderboard,
  editMode,
  compareMode,
  selectedBoatIds,
  compareInfo,
  rdg2Picker,
  setRdg2Picker,
  onCompareRowClick,
  onRaceChange,
  confirmRdg2,
  getFlagCode,
}) {
  const [showTotal, setShowTotal] = useState(false);

  if (!leaderboard.length) return null;

  const raceHeaders = leaderboard[0]?.races?.map((_, i) => `R${i + 1}`) || [];
  const columnHeaders = ['Rank', 'Name', 'Country', 'Sail #', 'Type', ...raceHeaders];

  return (
    <>
      <SectionDivider label="Qualifying Series" />
      <div style={{ display: 'flex', gap: '16px', marginBottom: '6px', fontSize: '0.8rem', color: '#555' }}>
        <label htmlFor="q-show-total" style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', userSelect: 'none' }}>
          <input
            id="q-show-total"
            type="checkbox"
            checked={showTotal}
            onChange={(e) => setShowTotal(e.target.checked)}
          />
          Show Total
        </label>
      </div>
      <div
        style={{
          border: '1px solid var(--border, #dde3ea)',
          borderRadius: '10px',
          overflow: 'hidden',
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        }}
      >
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '0.9rem',
          }}
        >
          <thead>
            <tr
              style={{
                background: 'var(--surface, #f5f7fa)',
                borderBottom: '2px solid var(--border, #dde3ea)',
              }}
            >
              {columnHeaders.map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: 'left',
                    padding: '9px 12px',
                    fontWeight: 600,
                    color: 'var(--navy)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {h}
                </th>
              ))}
              {showTotal && (
                <th
                  style={{
                    textAlign: 'center',
                    padding: '9px 12px',
                    fontWeight: 700,
                    color: 'var(--teal, #2a9d8f)',
                    whiteSpace: 'nowrap',
                    borderLeft: '2px solid rgba(42,157,143,0.3)',
                  }}
                >
                  Total
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {leaderboard.map((entry, index) => {
              const isSelected = selectedBoatIds.includes(entry.boat_id);
              return (
                <tr
                  key={`ev-${entry.boat_id}`}
                  onClick={() => onCompareRowClick(entry.boat_id)}
                  style={{
                    background: isSelected
                      ? 'rgba(42, 157, 143, 0.15)'
                      : index % 2 === 0
                        ? '#fff'
                        : 'var(--surface, #f5f7fa)',
                    borderBottom: '1px solid var(--border, #dde3ea)',
                    cursor: compareMode ? 'pointer' : 'default',
                    outline: isSelected
                      ? '2px solid var(--teal, #2a9d8f)'
                      : 'none',
                    outlineOffset: '-2px',
                  }}
                >
                  {/* Rank */}
                  <td
                    style={{
                      padding: '8px 12px',
                      fontWeight: 700,
                      color: 'var(--navy)',
                    }}
                  >
                    {index + 1}
                  </td>

                  {/* Name */}
                  <td style={{ padding: '8px 12px' }}>
                    {entry.name} {entry.surname}
                  </td>

                  {/* Country + flag */}
                  <td
                    style={{
                      padding: '8px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <Flag
                      code={getFlagCode(entry.country)}
                      style={{ width: '24px' }}
                    />
                    {entry.country}
                  </td>

                  {/* Sail number */}
                  <td style={{ padding: '8px 12px', fontWeight: 600 }}>
                    {entry.boat_number}
                  </td>

                  {/* Boat type */}
                  <td style={{ padding: '8px 12px', color: '#555' }}>
                    {entry.boat_type}
                  </td>

                  {/* Race score cells */}
                  {entry.races?.map((race, ri) => {
                    const raceStatus = entry.race_statuses?.[ri] || 'FINISHED';
                    const raceId = entry.race_ids?.[ri];
                    const isShared =
                      compareMode &&
                      (compareInfo?.sharedQualIds?.has(raceId) ?? false);
                    return (
                      <ScoreCell
                        key={`ev-${entry.boat_id}-${ri}`}
                        race={race}
                        raceStatus={raceStatus}
                        raceIndex={ri}
                        boatId={entry.boat_id}
                        entry={entry}
                        editMode={editMode}
                        isEditable
                        isShared={isShared}
                        onRaceChange={onRaceChange}
                        rdg2Picker={rdg2Picker}
                        setRdg2Picker={setRdg2Picker}
                        confirmRdg2={confirmRdg2}
                        qualifyingEntry={null}
                      />
                    );
                  })}

                  {/* Total */}
                  {showTotal && (
                    <td
                      style={{
                        padding: '8px 12px',
                        textAlign: 'center',
                        fontWeight: 700,
                        color: 'var(--teal, #2a9d8f)',
                        borderLeft: '2px solid rgba(42,157,143,0.3)',
                      }}
                    >
                      {entry.computed_total ?? entry.total_points_event}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

QualifyingTable.propTypes = {
  leaderboard: PropTypes.arrayOf(PropTypes.object).isRequired,
  editMode: PropTypes.bool.isRequired,
  compareMode: PropTypes.bool.isRequired,
  selectedBoatIds: PropTypes.arrayOf(PropTypes.number).isRequired,
  compareInfo: PropTypes.object,
  rdg2Picker: PropTypes.object,
  setRdg2Picker: PropTypes.func.isRequired,
  onCompareRowClick: PropTypes.func.isRequired,
  onRaceChange: PropTypes.func.isRequired,
  confirmRdg2: PropTypes.func.isRequired,
  getFlagCode: PropTypes.func.isRequired,
};

QualifyingTable.defaultProps = {
  compareInfo: null,
  rdg2Picker: null,
};

export default QualifyingTable;
