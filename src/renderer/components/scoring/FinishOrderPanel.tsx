/* eslint-disable no-nested-ternary */
import React, { useEffect, useRef, useState } from 'react';
import FinishOrderList from './FinishOrderList';
import type { ScoringProgress } from '../../utils/finishEntry';
import type {
  ScoringHeat,
  ScoringInputState,
} from '../../hooks/useScoringInput';

/** The shortcut that submits the race from anywhere on the scoring screen. */
const SUBMIT_SHORTCUT =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
    ? 'Cmd+Enter'
    : 'Ctrl+Enter';

interface SubmitBarProps extends ScoringProgress {
  submitting: boolean;
  onSubmit: () => void;
}

/**
 * Sticky action bar: progress + submit stay visible no matter how long the
 * finish list grows.
 */
function SubmitBar({
  scoredCount,
  totalBoats,
  allScored,
  isEmpty,
  submitting,
  onSubmit,
}: SubmitBarProps) {
  return (
    <div className="finish-actionbar">
      {/* Progress indicator so the user always knows how many boats remain */}
      <p
        id="finish-progress-status"
        aria-live="polite"
        className={`finish-progress${allScored ? ' is-done' : ''}`}
      >
        {isEmpty
          ? 'No boats in this heat'
          : allScored
            ? `All ${totalBoats} boats scored — ready to submit ✓`
            : `${scoredCount} of ${totalBoats} boats scored — ${totalBoats - scoredCount} remaining`}
      </p>
      {/* The button stays actionable even when not all boats are scored: a
          click surfaces a warning naming the missing boats, which is more
          helpful than a dead disabled control. So it must NOT claim
          aria-disabled (that would tell assistive tech it's inert while it
          still acts). Readiness is conveyed by the aria-live status above,
          referenced here via aria-describedby. */}
      <button
        type="button"
        className={`btn-success submit-scores-btn${allScored ? '' : ' is-unavailable'}`}
        aria-describedby="finish-progress-status"
        disabled={submitting}
        title={
          isEmpty
            ? 'No boats to score in this heat'
            : allScored
              ? `Submit the scores (${SUBMIT_SHORTCUT})`
              : `Score every boat (a place or a penalty) before submitting (${SUBMIT_SHORTCUT})`
        }
        onClick={onSubmit}
      >
        {submitting ? 'Saving…' : 'Submit Scores'}
      </button>
    </div>
  );
}

/**
 * The manual sail-number field. It keeps what is being typed to itself, so a
 * keystroke redraws this row and not the boat table and finish list.
 */
function AddSailRow({ onAdd }: { onAdd: (text: string) => void }) {
  const [text, setText] = useState('');
  // Focus the field as soon as a heat opens for scoring, so an RO can read the
  // finish order aloud and type straight away without reaching for the mouse.
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const add = () => {
    onAdd(text);
    setText('');
  };

  return (
    <div className="finish-add-row">
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          // Ctrl/Cmd+Enter on an empty field submits the race (the panel
          // listens for it); with numbers typed it only adds them, so a
          // half-entered finish is never submitted without them.
          if ((e.ctrlKey || e.metaKey) && text.trim() === '') return;
          e.preventDefault();
          add();
        }}
        placeholder="Type sail numbers (e.g. 101 205 88), press Enter"
        aria-label="Add sail numbers manually"
      />
      <button
        type="button"
        className="finish-add-btn"
        onClick={add}
        aria-label="Add sail number to finish order"
      >
        Add
      </button>
    </div>
  );
}

interface FinishOrderPanelProps {
  heat: ScoringHeat;
  scoring: ScoringInputState;
}

/** Right panel: progress + submit, the sail-number field and the finish order. */
export default function FinishOrderPanel({
  heat,
  scoring,
}: FinishOrderPanelProps) {
  const invalidCount = scoring.invalidBoatNumbers.length;

  // Ctrl/Cmd+Enter submits from anywhere on the screen, so a whole race can be
  // scored from the keyboard: type the sail numbers, Enter, Ctrl+Enter. The
  // same checks as the button run (missing boats are named, not submitted).
  const submitRef = useRef(scoring.submit);
  submitRef.current = scoring.submit;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
      if (event.defaultPrevented || event.repeat) return;
      // A dialog (confirmation, help, history) has its own keys.
      if (document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      submitRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="scoring-panel scoring-panel-right">
      <h2 className="scoring-panel-title">
        Finish Order
        {typeof heat.raceNumber === 'number'
          ? ` — Race ${heat.raceNumber + 1}`
          : ''}
      </h2>

      <SubmitBar
        scoredCount={scoring.scoredCount}
        totalBoats={scoring.totalBoats}
        allScored={scoring.allScored}
        isEmpty={scoring.isEmpty}
        submitting={scoring.submitting}
        onSubmit={scoring.submit}
      />

      {/* Keyed by heat: a new heat starts with an empty, focused field. */}
      <AddSailRow key={heat.heat_id} onAdd={scoring.addTyped} />

      <FinishOrderList
        boatNumbers={scoring.boatNumbers}
        penalties={scoring.penalties}
        ties={scoring.ties}
        placeNumbers={scoring.placeNumbers}
        boatByKey={scoring.boatByKey}
        isInvalidSail={scoring.isInvalidSail}
        onMove={scoring.moveBoat}
        onToggleTie={scoring.toggleBoatTie}
        onRemove={scoring.removeBoat}
      />

      {invalidCount > 0 && (
        <div role="alert" className="invalid-count-pill">
          {invalidCount} invalid sail{invalidCount === 1 ? '' : 's'} in finish
          order
        </div>
      )}
    </div>
  );
}
