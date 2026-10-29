import React from 'react';
import ScoreCell from './ScoreCell';
import ComparePanel from './ComparePanel';
import {
  ExplainableScore,
  GrossTotalCell,
  IdentityCells,
  IdentityHeaders,
  NetCell,
  RaceColumnHeader,
  CompareRow,
  leaderboardRowStyle,
} from './TablePieces';
import { sumPoints } from '../../../shared/points';
import {
  grossPointValues,
  hasMixedBoatTypes,
} from '../../utils/leaderboardUtils';
import type {
  CompareInfo,
  LeaderboardEntry,
  RaceChangeHandler,
  Rdg2PickerState,
} from '../../types';

// Accent colours for the qualifying series (blue scheme). `thead` is darker than
// `border` so the white header text clears WCAG AA (white on #4a7fc1 was ≈3.3:1).
const QUAL_ACCENT = {
  border: '#4a7fc1',
  thead: '#3468a8',
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
  /** Opens the score explanation; omitted while editing or comparing. */
  onExplain?: (entry: LeaderboardEntry) => void;
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
  onExplain = undefined,
}: QualifyingTableProps) {
  if (!leaderboard.length) return null;

  const showType = hasMixedBoatTypes(leaderboard);
  const raceCount = leaderboard[0]?.races?.length || 0;
  // SHRS 1.1: a race consists of all its heats. Results of a round some heats
  // have not sailed yet are shown after the counted races, greyed, and are
  // not part of any total until the round is complete.
  const pendingCount = Math.max(
    0,
    ...leaderboard.map((entry) => entry.pending_races?.length ?? 0),
  );
  const pendingTitle =
    'In progress: not every heat has sailed this race yet, so it is not counted (SHRS 1.1).';

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

      {pendingCount > 0 && (
        <p className="race-in-progress-note" role="note">
          * Round in progress: not every heat has sailed it yet. Its results are
          shown greyed and are not counted until the round is complete (SHRS
          1.1).
        </p>
      )}
      <div
        className="leaderboard-scroll"
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
            fontSize: '0.95rem',
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
              <IdentityHeaders
                showType={showType}
                background={QUAL_ACCENT.thead}
              />

              {/* Total column */}
              <th
                scope="col"
                title="Total: all race points added up, before any score is excluded (SHRS 5.4)."
                style={{
                  textAlign: 'center',
                  padding: '7px 10px',
                  fontWeight: 700,
                  color: 'rgba(255,255,255,0.9)',
                  whiteSpace: 'nowrap',
                  background: 'rgba(0,0,0,0.15)',
                  borderLeft: '1px solid rgba(255,255,255,0.2)',
                  borderRight: '1px solid rgba(255,255,255,0.1)',
                  fontSize: '0.88rem',
                  cursor: 'help',
                }}
              >
                Total
              </th>

              {/* Net column */}
              <th
                scope="col"
                title="Net: points after excluding the worst score(s) (SHRS 5.4). This decides the ranking."
                style={{
                  textAlign: 'center',
                  padding: '7px 10px',
                  fontWeight: 700,
                  color: 'white',
                  whiteSpace: 'nowrap',
                  background: 'var(--teal)',
                  borderLeft: '1px solid rgba(255,255,255,0.25)',
                  borderRight: '1px solid rgba(255,255,255,0.25)',
                  cursor: 'help',
                }}
              >
                Net
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
                  <RaceColumnHeader
                    key={`qh-r${i + 1}`}
                    label={`Q${i + 1}`}
                    shared={colIsShared}
                  />
                );
              })}
              {Array.from({ length: pendingCount }, (_, i) => (
                <th
                  scope="col"
                  key={`qh-p${i + 1}`}
                  className="race-in-progress"
                  title={pendingTitle}
                  aria-label={`Q${raceCount + i + 1} in progress, not counted`}
                >
                  Q{raceCount + i + 1}*
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {leaderboard.map((entry, index) => {
              const isSelected = selectedBoatIds.includes(entry.boat_id);
              const grossTotal = sumPoints(grossPointValues(entry));
              const overallNet =
                entry.computed_total ?? entry.total_points_event;

              return (
                <CompareRow
                  key={`ev-${entry.boat_id}`}
                  compareMode={compareMode}
                  isSelected={isSelected}
                  onPick={() => onCompareRowClick(entry.boat_id)}
                  style={leaderboardRowStyle(index, isSelected, compareMode)}
                >
                  <IdentityCells
                    rank={entry.place ?? index + 1}
                    entry={entry}
                    showType={showType}
                    getFlagCode={getFlagCode}
                  />

                  {/* Total */}
                  <GrossTotalCell total={grossTotal} />

                  {/* Net */}
                  <NetCell>
                    <ExplainableScore
                      value={overallNet}
                      entry={entry}
                      onExplain={onExplain}
                    />
                  </NetCell>

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
                        // LB-4: DNS placeholder cells have a null race_id, so
                        // keying on raceId alone collapses every such cell in a
                        // row to `ev-<boat>-undefined` (duplicate keys → DOM
                        // misreconciliation). Fall back to the race index, prefixed
                        // so a real race_id can't collide with a fallback index.
                        key={`ev-${entry.boat_id}-${raceId ?? `i${ri}`}`}
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
                      />
                    );
                  })}
                  {Array.from({ length: pendingCount }, (_, i) => {
                    const pending = entry.pending_races?.[i];
                    let text = '–';
                    if (pending) {
                      text =
                        pending.status === 'FINISHED'
                          ? String(pending.position)
                          : pending.status;
                    }
                    return (
                      <td
                        key={`ev-${entry.boat_id}-p${i}`}
                        className="race-in-progress"
                        title={
                          pending
                            ? `${pending.heat_name}: in progress, not counted yet`
                            : 'Not sailed yet in this round'
                        }
                      >
                        {text}
                      </td>
                    );
                  })}
                </CompareRow>
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
