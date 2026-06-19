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
  /** Number of boats in this race/fleet — caps the finishing place input. */
  maxPosition?: number;
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
  maxPosition = 0,
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

  // Local draft of the numeric input so the user can freely clear and retype a
  // place even when the cell already shows the heat's maximum. Without it the
  // field is fully controlled by `race`: an empty value snaps back and an
  // appended digit (7 -> 75) clamps straight back to the max, so the cell looks
  // frozen. `draft === null` means "mirror the derived value".
  const rawNumeric =
    typeof race === 'string' ? race.replace(/[()]/g, '') : String(race);
  const [draft, setDraft] = React.useState<string | null>(null);
  const inputValue = draft ?? rawNumeric;

  const isManualRdg = raceStatus === 'RDG3';

  // Manual RDG caps at 2 digits (99); a normal finish caps at the heat size.
  let numericMax: number | undefined;
  if (isManualRdg) {
    numericMax = 99;
  } else if (maxPosition > 0) {
    numericMax = maxPosition;
  }

  // Manual RDG (RDG3) skips the heat-size clamp, so cap the typed value at two
  // integer digits (max 99) to stop runaway entries. Decimals are kept.
  const capManualRdg = (value: string): string => {
    if (!isManualRdg) return value;
    const dot = value.indexOf('.');
    const intPart = (dot === -1 ? value : value.slice(0, dot)).replace(
      /\D/g,
      '',
    );
    const cappedInt = intPart.slice(0, 2);
    if (dot === -1) return cappedInt;
    return `${cappedInt}.${value.slice(dot + 1).replace(/\D/g, '')}`;
  };

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
          min={1}
          max={numericMax}
          step={1}
          value={inputValue}
          disabled={isPenalty && raceStatus !== 'RDG3'}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            const nextValue = capManualRdg(e.target.value);
            setDraft(nextValue);
            onRaceChange(
              boatId,
              raceIndex,
              nextValue,
              isManualRdg ? 'RDG3' : 'FINISHED',
            );
          }}
          onBlur={() => setDraft(null)}
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
