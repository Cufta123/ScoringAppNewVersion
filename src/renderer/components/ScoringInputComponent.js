import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { reportError, reportInfo } from '../utils/userFeedback';
import {
  POSITION_KEEPING_PENALTIES,
  orderBoatsByPenalty,
} from '../utils/penaltyOrder';
import { heatRaceDB } from '../api/db';

// Plain-language labels so non-expert scorers know what each code means.
const PENALTY_OPTIONS = [
  { value: 'ZFP', label: 'ZFP — 20% penalty (keeps finish place)' },
  { value: 'SCP', label: 'SCP — Scoring penalty (keeps finish place)' },
  { value: 'T1', label: 'T1 — Post-race penalty 30% (keeps finish place)' },
  { value: 'DNS', label: 'DNS — Did not start' },
  { value: 'DNF', label: 'DNF — Did not finish' },
  { value: 'RET', label: 'RET — Retired' },
  { value: 'NSC', label: 'NSC — Did not sail the course' },
  { value: 'OCS', label: 'OCS — Over the start line early' },
  { value: 'DNC', label: 'DNC — Did not come to start area' },
  { value: 'WTH', label: 'WTH — Withdrawn from series' },
  { value: 'UFD', label: 'UFD — U-flag disqualification' },
  { value: 'BFD', label: 'BFD — Black-flag disqualification' },
  { value: 'DSQ', label: 'DSQ — Disqualified' },
  { value: 'DNE', label: 'DNE — Disqualified (cannot be discarded)' },
  { value: 'DGM', label: 'DGM — Disqualified, gross misconduct' },
  { value: 'DPI', label: 'DPI — Discretionary penalty' },
];

function ScoringInputComponent({ heat, onSubmit }) {
  const [inputValue, setInputValue] = useState('');
  const [boatNumbers, setBoatNumbers] = useState([]);
  const [validBoats, setValidBoats] = useState([]);
  const [placeNumbers, setPlaceNumbers] = useState({});
  const [penalties, setPenalties] = useState({});
  const [draggingIndex, setDraggingIndex] = useState(null);
  const [dropIndex, setDropIndex] = useState(null);
  const [invalidBoatNumbers, setInvalidBoatNumbers] = useState([]);

  const normalizeBoatNumber = (value) => String(value).trim();
  const compareBoatNumbers = (a, b) =>
    normalizeBoatNumber(a).localeCompare(normalizeBoatNumber(b), undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  const buildPlaceNumbers = (orderedBoats) => {
    const newPlaceNumbers = {};
    orderedBoats.forEach((boat, index) => {
      newPlaceNumbers[boat] = index + 1;
    });
    return newPlaceNumbers;
  };
  const getOrderedBoatNumbers = (boats, penaltiesByBoat) =>
    orderBoatsByPenalty(boats, penaltiesByBoat, compareBoatNumbers);
  const isValidBoatNumber = (boatNumber) =>
    validBoats
      .map((value) => normalizeBoatNumber(value))
      .includes(normalizeBoatNumber(boatNumber));

  useEffect(() => {
    let isActive = true;

    setInputValue('');
    setBoatNumbers([]);
    setValidBoats([]);
    setPlaceNumbers({});
    setPenalties({});
    setDraggingIndex(null);
    setDropIndex(null);
    setInvalidBoatNumbers([]);

    const fetchBoats = async () => {
      try {
        const boats = await heatRaceDB.readBoatsByHeat(heat.heat_id);
        if (!isActive) return;
        setValidBoats(boats.map((boat) => boat.sail_number));
      } catch (error) {
        if (!isActive) return;
        reportError('Could not load boats for selected heat.', error);
      }
    };

    fetchBoats();

    return () => {
      isActive = false;
    };
  }, [heat.heat_id]);

  const handleInputChange = (e) => {
    setInputValue(e.target.value);
  };

  // Shared logic: add a list of sail numbers to the ranked list.
  // Comparison is done on normalized values so typed input ("101") matches
  // sail numbers stored as either numbers or strings.
  const addBoatsToList = (sailNumbers) => {
    const existing = new Set(boatNumbers.map(normalizeBoatNumber));
    const validSet = new Set(validBoats.map(normalizeBoatNumber));
    const validNew = sailNumbers.filter((n) => {
      const normalized = normalizeBoatNumber(n);
      if (existing.has(normalized) || !validSet.has(normalized)) return false;
      existing.add(normalized);
      return true;
    });
    if (validNew.length === 0) return;

    const merged = [...boatNumbers, ...validNew];
    const ordered = getOrderedBoatNumbers(merged, penalties);
    setBoatNumbers(ordered);
    setPlaceNumbers(buildPlaceNumbers(ordered));
  };

  // Clicking a row immediately adds the boat — no separate button press needed
  const handleBoatClick = (sailNumber) => {
    if (boatNumbers.includes(sailNumber)) return;
    addBoatsToList([sailNumber]);
  };

  const handleAddBoats = () => {
    const tokens = inputValue
      .split(/[\s,]+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
    const unique = [...new Set(tokens.map(normalizeBoatNumber))];
    // Map typed values to the canonical sail number from this heat so that
    // the rest of the component works with one consistent value per boat.
    const canonicalBySail = new Map(
      validBoats.map((value) => [normalizeBoatNumber(value), value]),
    );
    const invalidInput = unique.filter((n) => !canonicalBySail.has(n));
    if (invalidInput.length > 0) {
      reportInfo(
        `These sail numbers are not in ${heat.heat_name}: ${invalidInput.join(', ')}`,
        'Unknown sail numbers',
      );
    }
    addBoatsToList(
      unique
        .filter((n) => canonicalBySail.has(n))
        .map((n) => canonicalBySail.get(n)),
    );
    setInputValue('');
  };

  const handleInputKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddBoats();
    }
  };

  const updatePlaces = (boats) => {
    setPlaceNumbers(buildPlaceNumbers(boats));
  };

  const handleRemoveBoat = (index) => {
    const updatedBoatNumbers = [...boatNumbers];
    const removedBoat = updatedBoatNumbers.splice(index, 1)[0];

    const updatedPenalties = { ...penalties };
    delete updatedPenalties[removedBoat];

    const ordered = getOrderedBoatNumbers(updatedBoatNumbers, updatedPenalties);
    setBoatNumbers(ordered);
    setPlaceNumbers(buildPlaceNumbers(ordered));
    setPenalties(updatedPenalties);
  };

  const handleReorderBoat = (fromIndex, toIndex) => {
    if (toIndex < 0 || toIndex >= boatNumbers.length || fromIndex === toIndex) {
      return;
    }
    const updatedBoatNumbers = [...boatNumbers];
    const [movedBoat] = updatedBoatNumbers.splice(fromIndex, 1);
    updatedBoatNumbers.splice(toIndex, 0, movedBoat);
    const ordered = getOrderedBoatNumbers(updatedBoatNumbers, penalties);
    setBoatNumbers(ordered);
    updatePlaces(ordered);
  };

  const handleDragStart = (index) => {
    setDraggingIndex(index);
  };

  const handleDragOver = (index) => (e) => {
    e.preventDefault();
    setDropIndex(index);
  };

  const handleDrop = () => {
    if (draggingIndex !== null && dropIndex !== null) {
      handleReorderBoat(draggingIndex, dropIndex);
      setDraggingIndex(null);
      setDropIndex(null);
    }
  };

  const handlePenaltyChange = (boatNumber, penalty) => {
    const nextBoatNumbers =
      penalty && !boatNumbers.includes(boatNumber)
        ? [...boatNumbers, boatNumber]
        : [...boatNumbers];
    const newPenalties = { ...penalties, [boatNumber]: penalty };
    if (!penalty) delete newPenalties[boatNumber];

    const ordered = getOrderedBoatNumbers(nextBoatNumbers, newPenalties);
    setBoatNumbers(ordered);
    setPlaceNumbers(buildPlaceNumbers(ordered));
    setPenalties(newPenalties);
  };

  const handleSubmit = () => {
    const submittedBoatNumbers = [
      ...new Set([...boatNumbers, ...Object.keys(penalties)]),
    ];
    const invalidSubmitted = submittedBoatNumbers.filter(
      (boatNumber) => !isValidBoatNumber(boatNumber),
    );

    if (invalidSubmitted.length > 0) {
      setInvalidBoatNumbers(invalidSubmitted.map((v) => Number(v) || v));
      reportInfo(
        `These sail numbers are not in ${heat.heat_name}: ${invalidSubmitted.join(', ')}.\n\n` +
          'Remove them from finish order and score only boats in this heat.',
        'Invalid sail numbers',
      );
      return;
    }

    setInvalidBoatNumbers([]);

    const allBoats = [...new Set([...boatNumbers, ...validBoats])];
    const orderedBoatNumbers = getOrderedBoatNumbers(boatNumbers, penalties);
    const boatPlaces = [];
    const includedBoats = new Set();
    let finishingPlace = 1;
    let penaltyPlace = null;

    orderedBoatNumbers.forEach((boatNumber) => {
      includedBoats.add(boatNumber);
      const penalty = penalties[boatNumber];
      if (!penalty) {
        boatPlaces.push({
          boatNumber,
          place: finishingPlace,
          status: 'FINISHED',
        });
        finishingPlace += 1;
        return;
      }

      if (POSITION_KEEPING_PENALTIES.has(penalty)) {
        boatPlaces.push({ boatNumber, place: finishingPlace, status: penalty });
        finishingPlace += 1;
        return;
      }

      if (penaltyPlace === null) {
        penaltyPlace = finishingPlace;
      }

      boatPlaces.push({
        boatNumber,
        place: penaltyPlace,
        status: penalty,
      });
      penaltyPlace += 1;
    });

    // Defensive safety net: if a penalty exists for a valid boat that is not in
    // the ordered list, still include it in the submitted payload.
    validBoats.forEach((boatNumber) => {
      if (includedBoats.has(boatNumber) || !penalties[boatNumber]) return;
      if (penaltyPlace === null) {
        penaltyPlace = finishingPlace;
      }
      boatPlaces.push({
        boatNumber,
        place: penaltyPlace,
        status: penalties[boatNumber],
      });
      penaltyPlace += 1;
    });

    const assignedBoatNumbers = new Set(
      [...boatNumbers, ...Object.keys(penalties)].map((value) =>
        normalizeBoatNumber(value),
      ),
    );
    const allBoatsAccountedFor = allBoats.every((boatNumber) =>
      assignedBoatNumbers.has(normalizeBoatNumber(boatNumber)),
    );

    if (allBoatsAccountedFor) {
      onSubmit(boatPlaces);
    } else {
      const missingBoats = allBoats.filter(
        (boatNumber) =>
          !assignedBoatNumbers.has(normalizeBoatNumber(boatNumber)),
      );
      reportInfo(
        `Still missing: sail ${missingBoats.join(', sail ')}.\n\n` +
          'Every boat needs a finishing place or a penalty before you can submit. ' +
          'Click the missing boats in the left table to add them, or pick a penalty (e.g. DNS if a boat did not start).',
        'Some boats are not scored yet',
      );
    }
  };

  const getPlaceDisplay = (sailNumber) => {
    if (penalties[sailNumber]) return penalties[sailNumber];
    return placeNumbers[sailNumber] || '—';
  };

  const isInvalidSail = (sailNumber) =>
    invalidBoatNumbers
      .map((n) => normalizeBoatNumber(n))
      .includes(normalizeBoatNumber(sailNumber));

  const assignedSet = new Set(
    [...boatNumbers, ...Object.keys(penalties)].map((value) =>
      normalizeBoatNumber(value),
    ),
  );
  const scoredCount = validBoats.filter((sail) =>
    assignedSet.has(normalizeBoatNumber(sail)),
  ).length;
  const totalBoats = validBoats.length;
  const allScored = totalBoats > 0 && scoredCount === totalBoats;

  return (
    <div className="scoring-layout">
      {/* Left panel — boat list */}
      <div className="scoring-panel">
        <h2 className="scoring-panel-title">{heat.heat_name} — Boats</h2>
        <p className="scoring-hint">
          Click a row or select a penalty to include the boat in scoring
        </p>
        <div className="scoring-table-wrap">
          <table className="scoring-table">
            <thead>
              <tr>
                <th>Sailor</th>
                <th>CTR</th>
                <th>Sail #</th>
                <th className="scoring-place-cell">Place</th>
                <th>Penalty</th>
              </tr>
            </thead>
            <tbody>
              {heat.boats.map((boat) => {
                const added = boatNumbers.includes(boat.sail_number);
                const invalid = isInvalidSail(boat.sail_number);
                return (
                  <tr
                    key={boat.boat_id}
                    onClick={() => handleBoatClick(boat.sail_number)}
                    className={`${added ? 'is-added' : ''}${invalid ? ' is-invalid' : ''}`}
                    title={
                      added
                        ? `Already added at place ${getPlaceDisplay(boat.sail_number)}`
                        : 'Click to add to finish order'
                    }
                  >
                    <td>
                      {boat.name} {boat.surname}
                      {/* Always rendered (hidden until added) so adding the
                          check never reflows the row. */}
                      <span
                        className={`scoring-added-check${added ? '' : ' is-placeholder'}`}
                        aria-hidden={!added}
                      >
                        ✓
                      </span>
                    </td>
                    <td>{boat.country}</td>
                    <td className="scoring-sail-cell">{boat.sail_number}</td>
                    <td
                      className={`scoring-place-cell${added ? ' is-added' : ''}`}
                    >
                      {getPlaceDisplay(boat.sail_number)}
                    </td>
                    <td>
                      <select
                        className="penalty-select"
                        value={penalties[boat.sail_number] || ''}
                        onChange={(e) =>
                          handlePenaltyChange(boat.sail_number, e.target.value)
                        }
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Penalty for sail ${boat.sail_number}`}
                      >
                        <option value="">None</option>
                        {PENALTY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Right panel — finish order */}
      <div className="scoring-panel scoring-panel-right">
        <h2 className="scoring-panel-title">
          Finish Order
          {typeof heat.raceNumber === 'number'
            ? ` — Race ${heat.raceNumber + 1}`
            : ''}
        </h2>

        {/* Sticky action bar: progress + submit stay visible no matter how
            long the finish list grows. */}
        <div className="finish-actionbar">
          {/* Progress indicator so the user always knows how many boats remain */}
          <p
            aria-live="polite"
            className={`finish-progress${allScored ? ' is-done' : ''}`}
          >
            {allScored
              ? `All ${totalBoats} boats scored — ready to submit ✓`
              : `${scoredCount} of ${totalBoats} boats scored — ${totalBoats - scoredCount} remaining`}
          </p>
          <button
            type="button"
            className={`btn-success submit-scores-btn${allScored ? '' : ' is-unavailable'}`}
            aria-disabled={!allScored}
            title={
              allScored
                ? undefined
                : 'Score every boat (a place or a penalty) before submitting'
            }
            onClick={handleSubmit}
          >
            Submit Scores
          </button>
        </div>

        {/* Manual number input */}
        <div className="finish-add-row">
          <input
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            placeholder="Type sail number and press Enter"
            aria-label="Add sail numbers manually"
          />
          <button
            type="button"
            className="finish-add-btn"
            onClick={handleAddBoats}
            aria-label="Add sail number to finish order"
          >
            Add
          </button>
        </div>

        {/* Ranked list */}
        <ul className="finish-list">
          {boatNumbers.map((number, index) => (
            <React.Fragment key={number}>
              {dropIndex === index && <div className="drop-indicator" />}
              <li
                data-invalid={isInvalidSail(number)}
                className={`finish-item${isInvalidSail(number) ? ' is-invalid' : ''}`}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={handleDragOver(index)}
                onDrop={handleDrop}
              >
                <span className="finish-place">
                  {penalties[number]
                    ? penalties[number]
                    : `${placeNumbers[number]}.`}
                </span>
                <span className="finish-label">
                  Sail #{number}
                  {isInvalidSail(number) && (
                    <span className="finish-not-in-heat">Not in this heat</span>
                  )}
                </span>
                <button
                  type="button"
                  className="finish-move-btn"
                  aria-label={`Move sail ${number} up`}
                  onClick={() => handleReorderBoat(index, index - 1)}
                  disabled={index === 0}
                  title="Move up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="finish-move-btn"
                  aria-label={`Move sail ${number} down`}
                  onClick={() => handleReorderBoat(index, index + 1)}
                  disabled={index === boatNumbers.length - 1}
                  title="Move down"
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="finish-remove-btn"
                  onClick={() => handleRemoveBoat(index)}
                  aria-label={`Remove sail ${number} from finish order`}
                  title="Remove"
                >
                  ✕
                </button>
              </li>
            </React.Fragment>
          ))}
          {dropIndex === boatNumbers.length && (
            <div className="drop-indicator" />
          )}
        </ul>

        {invalidBoatNumbers.length > 0 && (
          <div role="alert" className="invalid-count-pill">
            {invalidBoatNumbers.length} invalid sail
            {invalidBoatNumbers.length === 1 ? '' : 's'} in finish order
          </div>
        )}
      </div>
    </div>
  );
}

ScoringInputComponent.propTypes = {
  heat: PropTypes.shape({
    heat_id: PropTypes.number.isRequired,
    heat_name: PropTypes.string.isRequired,
    raceNumber: PropTypes.number,
    boats: PropTypes.arrayOf(
      PropTypes.shape({
        boat_id: PropTypes.number.isRequired,
        name: PropTypes.string.isRequired,
        surname: PropTypes.string.isRequired,
        country: PropTypes.string.isRequired,
        sail_number: PropTypes.oneOfType([PropTypes.number, PropTypes.string])
          .isRequired,
      }),
    ).isRequired,
  }).isRequired,
  onSubmit: PropTypes.func.isRequired,
};

export default ScoringInputComponent;
