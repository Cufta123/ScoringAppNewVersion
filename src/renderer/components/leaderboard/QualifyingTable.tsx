import React from 'react';
import Flag from 'react-world-flags';
import ScoreCell from './ScoreCell';
import ComparePanel from './ComparePanel';
import type {
  CompareInfo,
  LeaderboardEntry,
  RaceChangeHandler,
  Rdg2PickerState,
} from '../../types';

// Accent colours for the qualifying series (blue scheme)
const QUAL_ACCENT = {
  border: '#4a7fc1',
  thead: '#4a7fc1',
  dot: '#1a56a0',
};

interface QualifyingTableProps {
  leaderboard: LeaderboardEntry[];
  editMode: boolean;
  compareMode: boolean;
  selectedBoatIds: number[];
  compareInfo?: CompareInfo | null;
  rdg2Picker?: Rdg2PickerState | null;
  setRdg2Picker: React.Dispatch<React.SetStateAction<Rdg2PickerState | null>>;
  onCompareRowClick: (boatId: number) => void;
  onRaceChange: RaceChangeHandler;
  confirmRdg2: () => void;
  getFlagCode: (iocCode: string) => string;
}

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
}: QualifyingTableProps) {
  if (!leaderboard.length) return null;

  const identityHeaders = ['Rank', 'Name', 'Country', 'Sail #', 'Type'];
  const raceCount = leaderboard[0]?.races?.length || 0;

  // Boats sharing a race_id are the ones in the same physical race (heat). Used
  // to cap a finishing-place input at that race's boat count — across multiple
  // qualifying heats the same column index maps to different races.
  const raceIdCounts = new Map<string, number>();
  leaderboard.forEach((entry) => {
    (entry.race_ids || []).forEach((id) => {
      if (id == null) return;
      const key = String(id);
      raceIdCounts.set(key, (raceIdCounts.get(key) || 0) + 1);
    });
  });

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
                  fontSize: '0.88rem',
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
              {Array.from({ length: raceCount }, (_, i) => {
                const colRaceId = leaderboard[0]?.race_ids?.[i];
                const colIsShared =
                  compareMode &&
                  selectedBoatIds.length === 2 &&
                  colRaceId != null &&
                  (compareInfo?.sharedQualIds?.has(colRaceId) ||
                    compareInfo?.sharedIds?.has(colRaceId) ||
                    false);
                return (
                  <th
                    key={`qh-r${i + 1}`}
                    aria-label={
                      colIsShared ? `Q${i + 1} shared race` : `Q${i + 1}`
                    }
                    title={
                      colIsShared
                        ? 'Shared race with compared competitor'
                        : undefined
                    }
                    style={{
                      textAlign: 'center',
                      padding: '7px 10px',
                      fontWeight: 600,
                      color: 'white',
                      whiteSpace: 'nowrap',
                      background: colIsShared
                        ? 'rgba(255, 210, 0, 0.55)'
                        : 'rgba(255,255,255,0.15)',
                      borderLeft: '1px solid rgba(255,255,255,0.18)',
                    }}
                  >
                    Q{i + 1}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {leaderboard.map((entry, index) => {
              const isSelected = selectedBoatIds.includes(entry.boat_id);
              const grossSource = entry.race_points || entry.races || [];
              const grossTotal = grossSource.reduce((sum, r) => {
                const v = parseFloat(String(r).replace(/[()]/g, ''));
                return sum + (Number.isNaN(v) ? 0 : v);
              }, 0);
              const overallNet =
                entry.computed_total ?? entry.total_points_event;
              const stripeBackground =
                index % 2 === 0 ? '#fff' : 'var(--surface, #f5f7fa)';

              return (
                <tr
                  key={`ev-${entry.boat_id}`}
                  onClick={() => onCompareRowClick(entry.boat_id)}
                  style={{
                    background: isSelected
                      ? 'rgba(42, 157, 143, 0.15)'
                      : stripeBackground,
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
                    {entry.place ?? index + 1}
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
                        code={getFlagCode(entry.country ?? '')}
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
                    {overallNet != null && !Number.isNaN(overallNet)
                      ? overallNet
                      : '–'}
                  </td>

                  {/* Race score cells */}
                  {entry.races?.map((race, ri) => {
                    const raceStatus = entry.race_statuses?.[ri] || 'FINISHED';
                    const raceId = entry.race_ids?.[ri];
                    const isShared =
                      compareMode &&
                      selectedBoatIds.includes(entry.boat_id) &&
                      raceId != null &&
                      (compareInfo?.sharedQualIds?.has(raceId) ||
                        compareInfo?.sharedIds?.has(raceId) ||
                        false);
                    return (
                      <ScoreCell
                        key={`ev-${entry.boat_id}-${raceId}`}
                        race={race}
                        raceStatus={raceStatus}
                        raceIndex={ri}
                        boatId={entry.boat_id}
                        entry={entry}
                        editMode={editMode}
                        isEditable
                        isShared={isShared}
                        maxPosition={
                          raceId != null
                            ? raceIdCounts.get(String(raceId))
                            : leaderboard.length
                        }
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
      <ComparePanel
        show={compareMode}
        compareInfo={compareInfo}
        selectedBoatIds={selectedBoatIds}
      />
    </div>
  );
}

export default QualifyingTable;
