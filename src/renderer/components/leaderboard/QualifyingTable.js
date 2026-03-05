import React from 'react';
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
    <>
      <SectionDivider label="Qualifying Series" />
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
              {/* Identity headers */}
              {identityHeaders.map((h) => (
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

              {/* Gross column */}
              <th
                style={{
                  textAlign: 'center',
                  padding: '7px 10px',
                  fontWeight: 700,
                  color: '#888',
                  whiteSpace: 'nowrap',
                  background: 'rgba(0,0,0,0.03)',
                  borderLeft: '2px solid rgba(0,0,0,0.1)',
                  borderRight: '1px solid rgba(0,0,0,0.08)',
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
                  color: 'var(--teal, #2a9d8f)',
                  whiteSpace: 'nowrap',
                  background: 'rgba(42,157,143,0.1)',
                  borderLeft: '2px solid rgba(42,157,143,0.3)',
                  borderRight: '2px solid rgba(42,157,143,0.3)',
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
                    color: '#1a56a0',
                    whiteSpace: 'nowrap',
                    background: 'rgba(41,98,255,0.08)',
                    borderLeft:
                      i === 0
                        ? '2px solid rgba(41,98,255,0.35)'
                        : '1px solid rgba(41,98,255,0.12)',
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

export default QualifyingTable;
