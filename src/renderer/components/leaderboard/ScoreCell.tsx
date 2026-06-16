import React from 'react';
import {
  PENALTY_CODES,
  RDG_TYPES,
  getRaceCellDisplay,
} from '../../utils/leaderboardUtils';
import Rdg2Picker from './Rdg2Picker';
import type {
  LeaderboardEntry,
  RaceChangeHandler,
  Rdg2PickerState,
} from '../../types';

interface ScoreCellProps {
  race: string | number;
  raceStatus: string;
  raceIndex: number;
  boatId: number;
  entry: LeaderboardEntry;
  editMode: boolean;
  isEditable?: boolean;
  isShared?: boolean;
  cellStyle?: React.CSSProperties;
  onRaceChange: RaceChangeHandler;
  rdg2Picker?: Rdg2PickerState | null;
  setRdg2Picker: React.Dispatch<React.SetStateAction<Rdg2PickerState | null>>;
  confirmRdg2: () => void;
  qualifyingEntry?: LeaderboardEntry | null;
}

/**
 * A single score table cell.
 *
 * In read mode: renders a coloured <span> for the value.
 * In edit mode: renders an <input> + <select> for status, plus the RDG2 picker
 * when this is the active cell.
 *
 * Pass isEditable=false to force read-only even when the table is in edit mode
 * (used for qualifying columns inside the final-series table).
 */
function ScoreCell({
  race,
  raceStatus,
  raceIndex,
  boatId,
  entry,
  editMode,
  isEditable = true,
  isShared = false,
  cellStyle = {},
  onRaceChange,
  rdg2Picker = null,
  setRdg2Picker,
  confirmRdg2,
  qualifyingEntry = null,
}: ScoreCellProps) {
  const { displayText, displayColor, isPenalty, isRdgCell, isExcluded } =
    getRaceCellDisplay(
      typeof race === 'string' ? race : String(race),
      raceStatus,
    );

  const isPickerOpen =
    rdg2Picker?.boatId === boatId && rdg2Picker?.raceIndex === raceIndex;

  const tdStyle: React.CSSProperties = {
    padding: '8px 12px',
    textAlign: 'center',
    ...cellStyle,
  };

  // ── Read mode ─────────────────────────────────────────────────────────────
  if (!editMode || !isEditable) {
    return (
      <td
        aria-label={
          isShared
            ? `Shared race cell: ${displayText}`
            : `Race cell: ${displayText}`
        }
        style={{
          ...tdStyle,
          ...(isShared
            ? {
                background: 'rgba(255, 210, 0, 0.25)',
                boxShadow: 'inset 0 0 0 1.5px rgba(200,160,0,0.35)',
              }
            : {}),
        }}
      >
        <span
          style={{
            color: displayColor,
            fontWeight: isPenalty && !isExcluded ? 600 : 'inherit',
          }}
        >
          {displayText}
        </span>
      </td>
    );
  }

  // ── Edit mode ─────────────────────────────────────────────────────────────
  return (
    <td
      aria-label={isShared ? 'Shared race editable cell' : 'Editable race cell'}
      style={{
        ...tdStyle,
        background: isShared ? 'rgba(255,210,0,0.3)' : 'var(--surface,#f5f7fa)',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
          alignItems: 'center',
          position: 'relative',
        }}
      >
        {/* Numeric input */}
        <input
          type="number"
          value={typeof race === 'string' ? race.replace(/[()]/g, '') : race}
          disabled={isPenalty && raceStatus !== 'RDG3'}
          onChange={(e) =>
            onRaceChange(
              boatId,
              raceIndex,
              e.target.value,
              raceStatus === 'RDG3' ? 'RDG3' : 'FINISHED',
            )
          }
          aria-label={`Race ${raceIndex + 1} value`}
          style={{
            width: '70px',
            padding: '6px 8px',
            borderRadius: '4px',
            border: '1px solid var(--border,#dde3ea)',
            opacity: isPenalty && raceStatus !== 'RDG3' ? 0.35 : 1,
            fontSize: '0.88rem',
          }}
        />

        {/* Status selector */}
        <select
          value={raceStatus}
          onChange={(e) => {
            if (e.target.value === 'RDG2') {
              const rect = e.target.getBoundingClientRect();
              setRdg2Picker({
                boatId,
                raceIndex,
                selectedIndices: new Set<number>(),
                selectedQualIndices: new Set<number>(),
                anchorRect: rect,
              });
            } else {
              onRaceChange(boatId, raceIndex, null, e.target.value);
            }
          }}
          aria-label={`Race ${raceIndex + 1} status`}
          style={{
            width: '100px',
            fontSize: '0.88rem',
            borderRadius: '4px',
            border: '1px solid var(--border,#dde3ea)',
            padding: '4px 6px',
            // eslint-disable-next-line no-nested-ternary
            color: isRdgCell
              ? 'var(--teal,#2a9d8f)'
              : isPenalty
                ? 'var(--danger,#e63946)'
                : 'var(--navy)',
          }}
        >
          <option value="FINISHED">Finish</option>
          {PENALTY_CODES.filter((code) => !RDG_TYPES.includes(code)).map(
            (code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ),
          )}
          <optgroup label="RDG – Redress">
            <option value="RDG1">RDG1 – avg all</option>
            <option value="RDG2">RDG2 – avg select</option>
            <option value="RDG3">RDG3 – manual</option>
          </optgroup>
        </select>

        {/* RDG2 picker — anchored to this cell */}
        {isPickerOpen && (
          <Rdg2Picker
            entry={entry}
            raceIndex={raceIndex}
            rdg2Picker={rdg2Picker}
            setRdg2Picker={setRdg2Picker}
            confirmRdg2={confirmRdg2}
            qualifyingEntry={qualifyingEntry}
          />
        )}

        {isShared && (
          <span
            style={{
              marginTop: '2px',
              fontSize: '0.78rem',
              fontWeight: 700,
              color: 'var(--navy)',
            }}
          >
            Shared
          </span>
        )}
      </div>
    </td>
  );
}

export default ScoreCell;
