import React, { useState } from 'react';
import PropTypes from 'prop-types';
import Flag from 'react-world-flags';
import ScoreCell from './ScoreCell';
import { FLEET_COLORS } from '../../utils/leaderboardUtils';

/**
 * Table for one fleet's final-series results.
 *
 * Columns: identity info | qualifying races (read-only) + Q-Tot | final races
 * (editable) + F-Tot | Overall (SHRS 5.4 combined total).
 */
function FinalFleetTable({
  group,
  entries,
  editMode,
  compareMode,
  selectedBoatIds,
  eventLeaderboard,
  compareInfo,
  rdg2Picker,
  setRdg2Picker,
  onCompareRowClick,
  onRaceChange,
  confirmRdg2,
  getFlagCode,
}) {
  const [showTotals, setShowTotals] = useState(false);

  if (!entries?.length) return null;

  const fleetAccent = FLEET_COLORS[group] || FLEET_COLORS.General;

  const qualRaceCount = eventLeaderboard[0]?.races?.length || 0;
  const finalRaceCount = entries[0]?.races?.length || 0;

  return (
    <div style={{ marginBottom: '18px' }}>
      <div style={{ display: 'flex', gap: '16px', marginBottom: '6px', fontSize: '0.8rem', color: '#555' }}>
        <label htmlFor={`${group}-show-totals`} style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', userSelect: 'none' }}>
          <input
            id={`${group}-show-totals`}
            type="checkbox"
            checked={showTotals}
            onChange={(e) => setShowTotals(e.target.checked)}
          />
          Show Totals
        </label>
      </div>
      {/* Fleet name heading */}
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
            background: fleetAccent.border,
            flexShrink: 0,
          }}
        />
        {group} Fleet
      </h3>

      <div
        style={{
          border: `1.5px solid ${fleetAccent.border}`,
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
            {/* Row 1: section group headers */}
            <tr style={{ borderBottom: 'none' }}>
              {['Rank', 'Name', 'Country', 'Sail #', 'Type'].map((h) => (
                <th
                  key={h}
                  rowSpan={2}
                  style={{
                    textAlign: 'left',
                    padding: '9px 12px',
                    fontWeight: 600,
                    color: 'var(--navy)',
                    whiteSpace: 'nowrap',
                    background: fleetAccent.thead,
                    borderBottom: `2px solid ${fleetAccent.border}`,
                    verticalAlign: 'bottom',
                  }}
                >
                  {h}
                </th>
              ))}

              {/* Overall column header — right after Type */}
              <th
                rowSpan={2}
                style={{
                  textAlign: 'center',
                  padding: '7px 10px',
                  fontWeight: 700,
                  color: 'var(--teal, #2a9d8f)',
                  whiteSpace: 'nowrap',
                  background: 'rgba(42,157,143,0.1)',
                  borderLeft: '2px solid rgba(42,157,143,0.3)',
                  borderRight: '2px solid rgba(42,157,143,0.3)',
                  borderBottom: `2px solid ${fleetAccent.border}`,
                  verticalAlign: 'bottom',
                }}
              >
                Overall
              </th>

              {/* Qualifying section header */}
              {qualRaceCount > 0 && (
                <th
                  colSpan={showQTot ? qualRaceCount + 1 : qualRaceCount}
                  style={{
                    textAlign: 'center',
                    padding: '4px 10px',
                    fontWeight: 700,
                    fontSize: '0.72rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: '#1a56a0',
                    background: 'rgba(41,98,255,0.1)',
                    borderLeft: '2px solid rgba(41,98,255,0.35)',
                    borderBottom: '1px solid rgba(41,98,255,0.2)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Qualifying Series
                </th>
              )}

              {/* Final section header */}
              {finalRaceCount > 0 && (
                <th
                  colSpan={showTotals ? finalRaceCount + 1 : finalRaceCount}
                  style={{
                    textAlign: 'center',
                    padding: '4px 10px',
                    fontWeight: 700,
                    fontSize: '0.72rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: 'var(--navy)',
                    background: fleetAccent.thead,
                    borderLeft: '3px solid rgba(0,0,0,0.12)',
                    borderBottom: '1px solid rgba(0,0,0,0.1)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Final Series
                </th>
              )}
            </tr>

            {/* Row 2: individual column headers */}
            <tr
              style={{
                background: fleetAccent.thead,
                borderBottom: `2px solid ${fleetAccent.border}`,
              }}
            >
              {/* Qualifying race headers */}
              {Array.from({ length: qualRaceCount }, (_, i) => (
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

              {/* Qualifying total header */}
              {qualRaceCount > 0 && showTotals && (
                <th
                  style={{
                    textAlign: 'center',
                    padding: '7px 10px',
                    fontWeight: 700,
                    color: '#1a56a0',
                    whiteSpace: 'nowrap',
                    background: 'rgba(41,98,255,0.15)',
                    borderLeft: '1px solid rgba(41,98,255,0.15)',
                    borderRight: '3px solid rgba(41,98,255,0.35)',
                  }}
                >
                  Q-Tot
                </th>
              )}

              {/* Final race headers */}
              {Array.from({ length: finalRaceCount }, (_, i) => (
                <th
                  key={`fh-r${i + 1}`}
                  style={{
                    textAlign: 'center',
                    padding: '7px 10px',
                    fontWeight: 600,
                    color: 'var(--navy)',
                    whiteSpace: 'nowrap',
                    background: fleetAccent.thead,
                    borderLeft: '1px solid rgba(0,0,0,0.08)',
                  }}
                >
                  F{i + 1}
                </th>
              ))}

              {/* Final total header */}
              {finalRaceCount > 0 && showTotals && (
                <th
                  style={{
                    textAlign: 'center',
                    padding: '7px 10px',
                    fontWeight: 700,
                    color: 'var(--navy)',
                    whiteSpace: 'nowrap',
                    background: fleetAccent.thead,
                    borderLeft: '1px solid rgba(0,0,0,0.12)',
                  }}
                >
                  F-Tot
                </th>
              )}
            </tr>
          </thead>

          <tbody>
            {entries.map((entry, index) => {
              const qualifyingEntry = eventLeaderboard.find(
                (e) => e.boat_id === entry.boat_id,
              );
              const isSelected = selectedBoatIds.includes(entry.boat_id);

              return (
                <tr
                  key={`boat-${entry.boat_id}-${index}`}
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
                  <td style={{ padding: '8px 12px' }}>
                    <div
                      style={{
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

                  {/* Overall combined total (SHRS 5.4) — right after Type */}
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
                    {entry.total_points_combined != null &&
                    !Number.isNaN(entry.total_points_combined)
                      ? entry.total_points_combined
                      : '–'}
                  </td>

                  {/* Qualifying race cells — always read-only */}
                  {Array.from({ length: qualRaceCount }, (_, ri) => {
                    const qRace = qualifyingEntry?.races?.[ri];
                    const qStatus =
                      qualifyingEntry?.race_statuses?.[ri] || 'FINISHED';
                    const qRaceId = qualifyingEntry?.race_ids?.[ri];
                    const qIsShared =
                      compareMode &&
                      (compareInfo?.sharedQualIds?.has(qRaceId) ?? false);

                    return (
                      <ScoreCell
                        key={`q-cell-${ri}`}
                        race={qRace ?? '–'}
                        raceStatus={qStatus}
                        raceIndex={ri}
                        boatId={entry.boat_id}
                        entry={qualifyingEntry || entry}
                        editMode={editMode}
                        isEditable={false}
                        isShared={qIsShared}
                        cellStyle={{
                          background: qIsShared
                            ? 'rgba(255, 210, 0, 0.3)'
                            : 'rgba(41,98,255,0.05)',
                          borderLeft:
                            ri === 0
                              ? '2px solid rgba(41,98,255,0.35)'
                              : '1px solid rgba(41,98,255,0.1)',
                        }}
                        onRaceChange={onRaceChange}
                        rdg2Picker={rdg2Picker}
                        setRdg2Picker={setRdg2Picker}
                        confirmRdg2={confirmRdg2}
                      />
                    );
                  })}

                  {/* Qualifying total cell */}
                  {qualRaceCount > 0 && showTotals && (
                    <td
                      style={{
                        padding: '8px 10px',
                        textAlign: 'center',
                        fontWeight: 700,
                        color: '#1a56a0',
                        background: 'rgba(41,98,255,0.1)',
                        borderLeft: '1px solid rgba(41,98,255,0.15)',
                        borderRight: '3px solid rgba(41,98,255,0.35)',
                      }}
                    >
                      {qualifyingEntry?.computed_total ?? '–'}
                    </td>
                  )}

                  {/* Final race cells — editable */}
                  {entry.races?.map((race, raceIndex) => {
                    const raceStatus =
                      entry.race_statuses?.[raceIndex] || 'FINISHED';
                    const isShared =
                      compareMode &&
                      selectedBoatIds.length === 2 &&
                      selectedBoatIds.includes(entry.boat_id);
                    return (
                      <ScoreCell
                        key={`f-cell-${entry.boat_id}-${raceIndex}`}
                        race={race}
                        raceStatus={raceStatus}
                        raceIndex={raceIndex}
                        boatId={entry.boat_id}
                        entry={entry}
                        editMode={editMode}
                        isEditable
                        isShared={isShared}
                        onRaceChange={onRaceChange}
                        rdg2Picker={rdg2Picker}
                        setRdg2Picker={setRdg2Picker}
                        confirmRdg2={confirmRdg2}
                        qualifyingEntry={qualifyingEntry}
                      />
                    );
                  })}

                  {/* Final series total */}
                  {finalRaceCount > 0 && showTotals && (
                    <td
                      style={{
                        padding: '8px 10px',
                        textAlign: 'center',
                        fontWeight: 700,
                        color: 'var(--navy)',
                        borderLeft: '1px solid rgba(0,0,0,0.1)',
                      }}
                    >
                      {entry.computed_total ?? '–'}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

FinalFleetTable.propTypes = {
  group: PropTypes.string.isRequired,
  entries: PropTypes.arrayOf(PropTypes.object).isRequired,
  editMode: PropTypes.bool.isRequired,
  compareMode: PropTypes.bool.isRequired,
  selectedBoatIds: PropTypes.arrayOf(PropTypes.number).isRequired,
  eventLeaderboard: PropTypes.arrayOf(PropTypes.object).isRequired,
  compareInfo: PropTypes.object,
  rdg2Picker: PropTypes.object,
  setRdg2Picker: PropTypes.func.isRequired,
  onCompareRowClick: PropTypes.func.isRequired,
  onRaceChange: PropTypes.func.isRequired,
  confirmRdg2: PropTypes.func.isRequired,
  getFlagCode: PropTypes.func.isRequired,
};

FinalFleetTable.defaultProps = {
  compareInfo: null,
  rdg2Picker: null,
};

export default FinalFleetTable;
