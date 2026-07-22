import React, { useEffect, useRef } from 'react';
import { PENALTY_DESCRIPTIONS } from '../../constants/penaltyLabels';

interface HelpModalProps {
  open: boolean;
  onClose: () => void;
}

// Order the glossary the way a race officer meets the codes: position-keeping
// penalties, then non-finishers, then disqualifications, then redress.
const GLOSSARY_CODES = [
  'ZFP',
  'SCP',
  'T1',
  'DNS',
  'DNF',
  'RET',
  'NSC',
  'OCS',
  'DNC',
  'WTH',
  'UFD',
  'BFD',
  'DSQ',
  'DNE',
  'DGM',
  'DPI',
  'RDG1',
  'RDG2',
  'RDG3',
];

/**
 * Task-focused help + a code glossary, opened from the Navbar. Kept intentionally
 * short: what a volunteer race officer needs mid-event, not a full manual.
 */
function HelpModal({ open, onClose }: HelpModalProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    lastFocusedRef.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (typeof lastFocusedRef.current?.focus === 'function') {
        lastFocusedRef.current.focus();
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="feedback-modal-overlay"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="feedback-modal help-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Help and glossary"
        tabIndex={-1}
      >
        <h3 className="feedback-modal-title">
          <i className="fa fa-circle-question" aria-hidden="true" /> Help &amp;
          glossary
        </h3>

        <div className="help-modal-body">
          <section>
            <h4>Getting started</h4>
            <ol>
              <li>
                <strong>Create an event</strong> with its name, place and dates.
              </li>
              <li>
                <strong>Open the event</strong> and add sailors &amp; boats —
                one by one, or import a CSV file.
              </li>
              <li>
                <strong>Create heats</strong>, then go to <em>Heat Race</em> to
                score each race by entering the finish order.
              </li>
              <li>
                <strong>Check the leaderboard</strong> any time, and export the
                starting list, heats and results as PDF, Excel or HTML.
              </li>
            </ol>
          </section>

          <section>
            <h4>Key terms</h4>
            <dl className="help-terms">
              <dt>Qualifying vs Final Series</dt>
              <dd>
                With two or more heats, boats first sail a Qualifying Series,
                then split into final fleets (Gold, Silver, …) for the Final
                Series. A single heat is scored as one fleet.
              </dd>
              <dt>Discard</dt>
              <dd>
                A boat’s worst race score(s) can be dropped from its total once
                enough races have been sailed. The number of discards grows with
                the race count.
              </dd>
              <dt>Redress (RDG)</dt>
              <dd>
                A corrected score awarded by the protest committee — an average
                of all races (RDG1), an average of selected races (RDG2), or a
                manual value (RDG3).
              </dd>
              <dt>Tie-break</dt>
              <dd>
                When two boats have equal points, the result is decided by their
                race scores. Use <em>Compare</em> on the leaderboard to see
                exactly how a tie was resolved.
              </dd>
            </dl>
          </section>

          <section>
            <h4>Result &amp; penalty codes</h4>
            <dl className="help-glossary">
              {GLOSSARY_CODES.map((code) => (
                <div className="help-glossary-row" key={code}>
                  <dt>{code}</dt>
                  <dd>{PENALTY_DESCRIPTIONS[code]}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>

        <div className="feedback-modal-actions">
          <button
            ref={closeRef}
            type="button"
            className="btn-success"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default HelpModal;
