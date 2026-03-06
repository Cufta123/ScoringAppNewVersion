import React from 'react';
import PropTypes from 'prop-types';
import Flag from 'react-world-flags';
import ScoreCell from './ScoreCell';

// Accent colours for the qualifying series (blue scheme)
const QUAL_ACCENT = {
  border: '#4a7fc1',
  thead: '#4a7fc1',
  dot: '#1a56a0',
};

/**
 * Qualifying series results table.
 * Shown only when the final series has NOT started.
 */
function QualifyingTable({
  leaderboard,
  editMode,
  compareMode,
  selectedBoatIds,
  compareInfo = null,
  rdg2Picker = null,
  setRdg2Picker,
  onCompareRowClick,
  onRaceChange,
  confirmRdg2,
  getFlagCode,
}) {
  if (!leaderboard.length) return null;

  const identityHeaders = ['Rank', 'Name', 'Country', 'Sail #', 'Type'];
  const raceCount = leaderboard[0]?.races?.length || 0;

  return (
    <div style={{ marginBottom: '18px' }}>
      {/* Section heading */}
      <h3
        style={{
          fontSize: '0.9rem',
          color: 'var(--navy)',
          margin: '0 0 6px 0',
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <span
          style={{
            display: 'inline-block',
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            background: QUAL_ACCENT.dot,
            flexShrink: 0,
          }}
        />
        Qualifying Series
      </h3>

      <div
        style={{
          border: `1.5px solid ${QUAL_ACCENT.border}`,
          borderRadius: '10px',
          overflowX: 'auto',
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        }}
      >
        <table
          style={{
            minWidth: '100%',
            borderCollapse: 'separate',
            borderSpacing: 0,
            fontSize: '0.9rem',
          }}
        >
          <thead>
            <tr
              style={{
                background: QUAL_ACCENT.thead,
                borderBottom: `2px solid ${QUAL_ACCENT.border}`,
              }}
            >
              {/* Identity headers */}
              {identityHeaders.map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: 'left',
                    padding: '9px 12px',
                    fontWeight: 600,
                    color: 'white',
                    whiteSpace: 'nowrap',
                    background: QUAL_ACCENT.thead,
                  }}
                >
                  {h}
                </th>
              ))}

              {/* Gross column */}
              <th
                style={{
                  textAlign: 'center',
                  padding: '7px 10px',
                  fontWeight: 700,
                  color: 'rgba(255,255,255,0.75)',
                  whiteSpace: 'nowrap',
                  background: 'rgba(0,0,0,0.15)',
                  borderLeft: '1px solid rgba(255,255,255,0.2)',
                  borderRight: '1px solid rgba(255,255,255,0.1)',
                  fontSize: '0.78rem',
                }}
              >
                Gross
              </th>

              {/* Overall column */}
              <th
                style={{
                  textAlign: 'center',
                  padding: '7px 10px',
                  fontWeight: 700,
                  color: 'white',
                  whiteSpace: 'nowrap',
                  background: '#2a9d8f',
                  borderLeft: '1px solid rgba(255,255,255,0.25)',
                  borderRight: '1px solid rgba(255,255,255,0.25)',
                }}
              >
                Overall
              </th>

              {/* Race headers */}
              {Array.from({ length: raceCount }, (_, i) => (
                <th
                  key={`qh-r${i + 1}`}
                  style={{
                    textAlign: 'center',
                    padding: '7px 10px',
                    fontWeight: 600,
                    color: 'white',
                    whiteSpace: 'nowrap',
                    background: 'rgba(255,255,255,0.15)',
                    borderLeft: '1px solid rgba(255,255,255,0.18)',
                  }}
                >
                  Q{i + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {leaderboard.map((entry, index) => {
              const isSelected = selectedBoatIds.includes(entry.boat_id);
              const grossTotal = (entry.races || []).reduce((sum, r) => {
                const v = parseFloat(String(r).replace(/[()]/g, ''));
                return sum + (Number.isNaN(v) ? 0 : v);
              }, 0);
              const overallNet = entry.computed_total ?? entry.total_points_event;

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
                  <td style={{ padding: '8px 12px', fontWeight: 700, color: 'var(--navy)' }}>
                    {index + 1}
                  </td>

                  {/* Name */}
                  <td style={{ padding: '8px 12px' }}>
                    {entry.name} {entry.surname}
                  </td>

                  {/* Country + flag */}
                  <td style={{ padding: '8px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Flag code={getFlagCode(entry.country)} style={{ width: '24px' }} />
                      {entry.country}
                    </div>
                  </td>

                  {/* Sail number */}
                  <td style={{ padding: '8px 12px', fontWeight: 600 }}>
                    {entry.boat_number}
                  </td>

                  {/* Boat type */}
                  <td style={{ padding: '8px 12px', color: '#555' }}>
                    {entry.boat_type}
                  </td>

                  {/* Gross */}
                  <td
                    style={{
                      padding: '8px 10px',
                      textAlign: 'center',
                      fontWeight: 600,
                      color: '#888',
                      background: 'rgba(0,0,0,0.02)',
                      borderLeft: '2px solid rgba(0,0,0,0.1)',
                      borderRight: '1px solid rgba(0,0,0,0.08)',
                      fontSize: '0.85rem',
                    }}
                  >
                    {grossTotal > 0 ? grossTotal : '–'}
                  </td>

                  {/* Overall */}
                  <td
                    style={{
                      padding: '8px 10px',
                      textAlign: 'center',
                      fontWeight: 700,
                      color: 'var(--teal, #2a9d8f)',
                      background: 'rgba(42,157,143,0.05)',
                      borderLeft: '2px solid rgba(42,157,143,0.3)',
                      borderRight: '2px solid rgba(42,157,143,0.3)',
                    }}
                  >
                    {overallNet != null && !Number.isNaN(overallNet) ? overallNet : '–'}
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
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
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

export default QualifyingTable;
