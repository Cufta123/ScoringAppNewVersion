import React from 'react';
import {
  PENALTY_CODES,
  RDG_TYPES,
  getRaceCellDisplay,
} from '../../utils/leaderboardUtils';
import { scoringPenaltyStatuses } from '../../../shared/scoringPenalty';
import { penaltyLabel } from '../../constants/penaltyLabels';
import Rdg2Picker from './Rdg2Picker';
import { useReportInvalidCell } from './editValidity';
import {
  checkRaceCellInput,
  type RaceCellInputKind,
} from '../../utils/raceCellInput';
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
  /** Series of this cell, for RDG2 race labels (SHRS 5.6). */
  seriesPrefix?: 'Q' | 'F';
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
  seriesPrefix = 'Q',
}: ScoreCellProps) {
  const { displayText, displayColor, isPenalty, isRdgCell, isExcluded } =
    getRaceCellDisplay(
      typeof race === 'string' ? race : String(race),
      raceStatus,
    );

  const isPickerOpen =
    rdg2Picker?.boatId === boatId && rdg2Picker?.raceIndex === raceIndex;
  // Anchor the RDG2 popover to the status select so it can re-track it on scroll.
  const statusSelectRef = React.useRef<HTMLSelectElement>(null);

  // Local draft of the typed text. `draft === null` means "show the stored
  // value". Typed text is never corrected on the fly: an impossible place
  // (0, 15 in a 10-boat heat, 2.5) stays visible in red with the reason, is
  // not applied to the preview, and blocks Save until it is fixed.
  const rawNumeric =
    typeof race === 'string' ? race.replace(/[()]/g, '') : String(race);
  const [draft, setDraft] = React.useState<string | null>(null);
  const inputValue = draft ?? rawNumeric;

  const isManualRdg = raceStatus === 'RDG3';
  // DPI (RRS A10) is a PC-typed numeric score, entered exactly like manual RDG.
  const isManualDpi = raceStatus === 'DPI';
  const isManualPoints = isManualRdg || isManualDpi;
  // Position-keeping penalties (ZFP/SCP/T1) are DEFINED by their finishing
  // place, so their place stays typeable; only hard penalties (DNS/DSQ/…)
  // and computed RDG cells lock the numeric input. Manual-points cells
  // (RDG3, DPI) stay typeable.
  const keepsFinishingPlace = scoringPenaltyStatuses.has(raceStatus);
  const isInputLocked = isPenalty && !keepsFinishingPlace && !isManualPoints;
  const inputKind: RaceCellInputKind = isManualPoints ? 'points' : 'place';

  const check =
    draft === null || isInputLocked || !editMode || !isEditable
      ? null
      : checkRaceCellInput(draft, inputKind, maxPosition);
  const invalid = check && !check.ok ? check : null;
  const placeRange = maxPosition > 0 ? ` (1–${maxPosition})` : '';
  const inputHint = isManualPoints
    ? 'Points set by the protest committee (more than 0, up to 99)'
    : `Finishing place${placeRange}`;

  // Tell the leaderboard which cells cannot be saved, by sail and race.
  const reportInvalid = useReportInvalidCell();
  const cellKey = `${boatId}-${raceIndex}`;
  const cellName = `Sail ${entry.boat_number ?? boatId}, ${seriesPrefix}${raceIndex + 1}`;
  const invalidMessage = invalid ? `${cellName}: ${invalid.message}` : null;
  React.useEffect(() => {
    reportInvalid(cellKey, invalidMessage);
  }, [reportInvalid, cellKey, invalidMessage]);
  React.useEffect(
    () => () => reportInvalid(cellKey, null),
    [reportInvalid, cellKey],
  );

  // A status that locks the number (DNS, DSQ, RDG1…) makes a half-typed
  // place irrelevant: drop it.
  React.useEffect(() => {
    if (isInputLocked) setDraft(null);
  }, [isInputLocked]);
  // Leaving edit mode (Save or Cancel) forgets whatever was typed.
  React.useEffect(() => {
    if (!editMode) setDraft(null);
  }, [editMode]);

  const tdStyle: React.CSSProperties = {
    padding: '8px 12px',
    textAlign: 'center',
    ...cellStyle,
  };

  // ── Read mode ─────────────────────────────────────────────────────────────
  if (!editMode || !isEditable) {
    // Hovering a penalty/redress cell explains the code in plain language, so a
    // bare "BFD" on the printed standings never has to be recalled from memory.
    const statusTitle =
      isPenalty || isRdgCell ? penaltyLabel(raceStatus) : undefined;
    return (
      <td
        title={statusTitle}
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
        {/* Typed place or points. A text field, not type="number": a number
            field changes its value on the mouse wheel and the arrow keys, so
            scrolling the table could silently change a result. */}
        <input
          type="text"
          inputMode={isManualPoints ? 'decimal' : 'numeric'}
          autoComplete="off"
          maxLength={5}
          value={inputValue}
          disabled={isInputLocked}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            const text = e.target.value;
            setDraft(text);
            const typed = checkRaceCellInput(text, inputKind, maxPosition);
            if (!typed.ok) return;
            let statusForChange = 'FINISHED';
            if (isManualRdg) {
              statusForChange = 'RDG3';
            } else if (isManualDpi) {
              // Typing a value must not clear the DPI penalty (RRS A10).
              statusForChange = 'DPI';
            } else if (keepsFinishingPlace) {
              // Typing a new place must not clear the ZFP/SCP/T1 penalty.
              statusForChange = raceStatus;
            }
            onRaceChange(
              boatId,
              raceIndex,
              String(typed.value),
              statusForChange,
            );
          }}
          onBlur={() => {
            // Keep wrong input on screen until it is fixed.
            if (!invalid) setDraft(null);
          }}
          aria-label={`Race ${raceIndex + 1} value`}
          aria-invalid={invalid ? true : undefined}
          title={invalid ? invalid.message : inputHint}
          className={`race-cell-input${invalid ? ' is-invalid' : ''}`}
        />
        {invalid && (
          <span className="race-cell-error" role="alert">
            {invalid.short}
          </span>
        )}

        {/* Status selector */}
        <select
          ref={statusSelectRef}
          value={raceStatus === 'RAF' ? 'RET' : raceStatus}
          onChange={(e) => {
            if (e.target.value === 'RDG2') {
              const rect = e.target.getBoundingClientRect();
              setRdg2Picker({
                boatId,
                raceIndex,
                selectedIndices: new Set<number>(),
                anchorRect: rect,
              });
            } else {
              // LB-3: selecting any non-RDG2 status closes this cell's open RDG2
              // picker. Otherwise the picker stays open and clicking Apply
              // (confirmRdg2) would silently revert the user back to RDG2.
              if (isPickerOpen) setRdg2Picker(null);
              onRaceChange(boatId, raceIndex, null, e.target.value);
            }
          }}
          aria-label={`Race ${raceIndex + 1} status`}
          className="race-cell-status"
          style={{
            // eslint-disable-next-line no-nested-ternary
            color: isRdgCell
              ? 'var(--teal-hover,#0B7A63)'
              : isPenalty
                ? 'var(--danger,#e63946)'
                : 'var(--navy)',
          }}
        >
          <option value="FINISHED">Finish</option>
          {/* RAF is normalized to RET on save, so offering both would show a
              different code after saving than the one picked. Labels come from
              the shared penaltyLabels map so codes never appear bare here. */}
          {PENALTY_CODES.filter(
            (code) => !RDG_TYPES.includes(code) && code !== 'RAF',
          ).map((code) => (
            <option key={code} value={code}>
              {penaltyLabel(code)}
            </option>
          ))}
          <optgroup label="RDG – Redress">
            <option value="RDG1">{penaltyLabel('RDG1')}</option>
            <option value="RDG2">{penaltyLabel('RDG2')}</option>
            <option value="RDG3">{penaltyLabel('RDG3')}</option>
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
            seriesPrefix={seriesPrefix}
            anchorEl={statusSelectRef.current}
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
