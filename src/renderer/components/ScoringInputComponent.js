import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { reportError, reportInfo } from '../utils/userFeedback';

const POSITION_KEEPING_PENALTIES = new Set(['ZFP', 'SCP', 'T1']);
// SHRS 2023 (5.3) is the primary order used by this app.
const SHRS_PENALTY_ORDER = [
  'DNF',
  'RET',
  'NSC',
  'OCS',
  'DNS',
  'DNC',
  'WTH',
  'UFD',
  'BFD',
  'DSQ',
  'DNE',
];
const APPENDIX_FALLBACK_PENALTY_ORDER = ['DGM', 'DPI'];
const EFFECTIVE_PENALTY_ORDER = [
  ...SHRS_PENALTY_ORDER,
  ...APPENDIX_FALLBACK_PENALTY_ORDER,
];
const penaltyOrderIndex = new Map(
  EFFECTIVE_PENALTY_ORDER.map((status, index) => [status, index]),
);

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
  const getPenaltyRank = (status) =>
    penaltyOrderIndex.has(status)
      ? penaltyOrderIndex.get(status)
      : EFFECTIVE_PENALTY_ORDER.length;
  const buildPlaceNumbers = (orderedBoats) => {
    const newPlaceNumbers = {};
    orderedBoats.forEach((boat, index) => {
      newPlaceNumbers[boat] = index + 1;
    });
    return newPlaceNumbers;
  };
  const getOrderedBoatNumbers = (boats, penaltiesByBoat) => {
    const withPosition = [];
    const displaced = [];

    boats.forEach((boatNumber) => {
      const penalty = penaltiesByBoat[boatNumber];
      if (!penalty || POSITION_KEEPING_PENALTIES.has(penalty)) {
        withPosition.push(boatNumber);
        return;
      }
      displaced.push(boatNumber);
    });

    displaced.sort((a, b) => {
      const penaltyRankDiff =
        getPenaltyRank(penaltiesByBoat[a]) - getPenaltyRank(penaltiesByBoat[b]);
      if (penaltyRankDiff !== 0) return penaltyRankDiff;
      return compareBoatNumbers(a, b);
    });

    return [...withPosition, ...displaced];
  };
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
        const boats = await window.electron.sqlite.heatRaceDB.readBoatsByHeat(
          heat.heat_id,
        );
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

  // Shared logic: add a list of sail numbers to the ranked list
  const addBoatsToList = (sailNumbers) => {
    const validNew = sailNumbers.filter(
      (n) => !boatNumbers.includes(n) && validBoats.includes(n),
    );
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
    const inputNumbers = inputValue
      .split(/[\s,]+/)
      .map(Number)
      .filter((n) => !Number.isNaN(n) && n > 0);
    const unique = [...new Set(inputNumbers)];
    const invalidInput = unique.filter((n) => !isValidBoatNumber(n));
    if (invalidInput.length > 0) {
      reportInfo(
        `These sail numbers are not in ${heat.heat_name}: ${invalidInput.join(', ')}`,
        'Unknown sail numbers',
      );
    }
    addBoatsToList(unique);
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
    let penaltyPlace = finishingPlace;

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
      reportInfo(
        'All boats must be assigned a place or a penalty before submitting.',
        'Incomplete scoring',
      );
    }
  };

  const getPlaceDisplay = (sailNumber) => {
    if (penalties[sailNumber]) return penalties[sailNumber];
    return placeNumbers[sailNumber] || '—';
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        width: '100%',
        gap: '24px',
        padding: '8px 0',
      }}
    >
      {/* Left panel — boat list */}
      <div style={{ flex: '1', minWidth: 0 }}>
        <h2
          style={{
            margin: '0 0 4px 0',
            fontSize: '1.1rem',
            color: 'var(--navy)',
          }}
        >
          {heat.heat_name} — Boats
        </h2>
        <p
          style={{
            margin: '0 0 12px 0',
            fontSize: '0.88rem',
            color: 'var(--text-muted, #666)',
          }}
        >
          Click a row or select a penalty to include the boat in scoring
        </p>
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
                <th
                  style={{
                    textAlign: 'left',
                    padding: '8px 10px',
                    fontWeight: 600,
                    color: 'var(--navy)',
                  }}
                >
                  Sailor
                </th>
                <th
                  style={{
                    textAlign: 'left',
                    padding: '8px 10px',
                    fontWeight: 600,
                    color: 'var(--navy)',
                  }}
                >
                  CTR
                </th>
                <th
                  style={{
                    textAlign: 'left',
                    padding: '8px 10px',
                    fontWeight: 600,
                    color: 'var(--navy)',
                  }}
                >
                  Sail #
                </th>
                <th
                  style={{
                    textAlign: 'center',
                    padding: '8px 10px',
                    fontWeight: 600,
                    color: 'var(--navy)',
                  }}
                >
                  Place
                </th>
                <th
                  style={{
                    textAlign: 'left',
                    padding: '8px 10px',
                    fontWeight: 600,
                    color: 'var(--navy)',
                  }}
                >
                  Penalty
                </th>
              </tr>
            </thead>
            <tbody>
              {heat.boats.map((boat, i) => {
                const added = boatNumbers.includes(boat.sail_number);
                const isInvalid = invalidBoatNumbers
                  .map((n) => normalizeBoatNumber(n))
                  .includes(normalizeBoatNumber(boat.sail_number));
                let rowBackground = 'var(--surface, #f5f7fa)';
                if (added) {
                  rowBackground = 'var(--teal-light, #e8f5f1)';
                } else if (i % 2 === 0) {
                  rowBackground = '#fff';
                }
                return (
                  <tr
                    key={boat.boat_id}
                    onClick={() => handleBoatClick(boat.sail_number)}
                    style={{
                      background: rowBackground,
                      borderBottom: '1px solid var(--border, #dde3ea)',
                      outline: isInvalid
                        ? '2px solid var(--danger, #e63946)'
                        : 'none',
                      outlineOffset: '-2px',
                      cursor: added ? 'default' : 'pointer',
                      transition: 'background 0.15s',
                    }}
                    title={
                      added
                        ? `Already added at place ${getPlaceDisplay(boat.sail_number)}`
                        : 'Click to add to finish order'
                    }
                  >
                    <td style={{ padding: '8px 10px' }}>
                      {boat.name} {boat.surname}
                      {added && (
                        <span
                          style={{
                            marginLeft: 6,
                            color: 'var(--teal, #2a9d8f)',
                            fontWeight: 700,
                            fontSize: '0.8rem',
                          }}
                        >
                          ✓
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '8px 10px', color: '#555' }}>
                      {boat.country}
                    </td>
                    <td style={{ padding: '8px 10px', fontWeight: 600 }}>
                      {boat.sail_number}
                    </td>
                    <td
                      style={{
                        padding: '8px 10px',
                        textAlign: 'center',
                        fontWeight: 600,
                        color: added ? 'var(--teal, #2a9d8f)' : '#aaa',
                      }}
                    >
                      {getPlaceDisplay(boat.sail_number)}
                    </td>
                    <td style={{ padding: '6px 10px' }}>
                      <select
                        value={penalties[boat.sail_number] || ''}
                        onChange={(e) =>
                          handlePenaltyChange(boat.sail_number, e.target.value)
                        }
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Penalty for sail ${boat.sail_number}`}
                        style={{
                          padding: '4px 6px',
                          borderRadius: 'var(--radius, 6px)',
                          border: '1px solid var(--border,#dde3ea)',
                          fontSize: '0.85rem',
                        }}
                      >
                        <option value="">None</option>
                        <option value="ZFP">ZFP</option>
                        <option value="SCP">SCP</option>
                        <option value="T1">T1</option>
                        <option value="DNS">DNS</option>
                        <option value="DNF">DNF</option>
                        <option value="RET">RET</option>
                        <option value="NSC">NSC</option>
                        <option value="OCS">OCS</option>
                        <option value="DNC">DNC</option>
                        <option value="WTH">WTH</option>
                        <option value="UFD">UFD</option>
                        <option value="BFD">BFD</option>
                        <option value="DSQ">DSQ</option>
                        <option value="DNE">DNE</option>
                        <option value="DGM">DGM</option>
                        <option value="DPI">DPI</option>
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
      <div
        style={{
          flex: '1',
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <h2
          style={{
            margin: '0 0 4px 0',
            fontSize: '1.1rem',
            color: 'var(--navy)',
          }}
        >
          Finish Order
        </h2>

        {/* Manual number input */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            placeholder="Type sail number and press Enter"
            aria-label="Add sail numbers manually"
            style={{
              flex: 1,
              padding: '9px 12px',
              borderRadius: 'var(--radius, 6px)',
              border: '1px solid var(--border, #dde3ea)',
              fontSize: '0.9rem',
              outline: 'none',
            }}
          />
          <button
            type="button"
            onClick={handleAddBoats}
            aria-label="Add sail number to finish order"
            style={{
              padding: '9px 16px',
              borderRadius: 'var(--radius, 6px)',
              border: '2px solid var(--ocean, #1a6fa3)',
              background: 'transparent',
              color: 'var(--ocean, #1a6fa3)',
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              fontSize: '0.9rem',
            }}
          >
            Add
          </button>
        </div>

        {/* Ranked list */}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, flex: 1 }}>
          {boatNumbers.map((number, index) => (
            <React.Fragment key={number}>
              {dropIndex === index && (
                <div
                  style={{
                    height: '2px',
                    background: 'var(--ocean, #1a6fa3)',
                    borderRadius: '1px',
                    margin: '2px 0',
                  }}
                />
              )}
              <li
                data-invalid={invalidBoatNumbers
                  .map((n) => normalizeBoatNumber(n))
                  .includes(normalizeBoatNumber(number))}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  marginBottom: '6px',
                  padding: '8px 12px',
                  border: invalidBoatNumbers
                    .map((n) => normalizeBoatNumber(n))
                    .includes(normalizeBoatNumber(number))
                    ? '2px solid var(--danger, #e63946)'
                    : '1px solid var(--border, #dde3ea)',
                  borderRadius: 'var(--radius, 6px)',
                  background: '#fff',
                  cursor: 'grab',
                  userSelect: 'none',
                }}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={handleDragOver(index)}
                onDrop={handleDrop}
              >
                <span
                  style={{
                    fontWeight: 700,
                    color: 'var(--teal, #2a9d8f)',
                    minWidth: '28px',
                    fontSize: '1rem',
                  }}
                >
                  {penalties[number]
                    ? penalties[number]
                    : `${placeNumbers[number]}.`}
                </span>
                <span
                  style={{ flex: 1, fontSize: '0.9rem', color: 'var(--navy)' }}
                >
                  Sail #{number}
                  {invalidBoatNumbers
                    .map((n) => normalizeBoatNumber(n))
                    .includes(normalizeBoatNumber(number)) && (
                    <span
                      style={{
                        marginLeft: 8,
                        color: 'var(--danger, #e63946)',
                        fontWeight: 700,
                      }}
                    >
                      Not in this heat
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  aria-label={`Move sail ${number} up`}
                  onClick={() => handleReorderBoat(index, index - 1)}
                  disabled={index === 0}
                  style={{
                    background: 'none',
                    border: '1px solid var(--border, #dde3ea)',
                    borderRadius: '4px',
                    cursor: index === 0 ? 'not-allowed' : 'pointer',
                    color: '#666',
                    fontSize: '0.95rem',
                    lineHeight: 1,
                    padding: '4px 8px',
                  }}
                  title="Move up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move sail ${number} down`}
                  onClick={() => handleReorderBoat(index, index + 1)}
                  disabled={index === boatNumbers.length - 1}
                  style={{
                    background: 'none',
                    border: '1px solid var(--border, #dde3ea)',
                    borderRadius: '4px',
                    cursor:
                      index === boatNumbers.length - 1
                        ? 'not-allowed'
                        : 'pointer',
                    color: '#666',
                    fontSize: '0.95rem',
                    lineHeight: 1,
                    padding: '4px 8px',
                  }}
                  title="Move down"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => handleRemoveBoat(index)}
                  aria-label={`Remove sail ${number} from finish order`}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#999',
                    fontSize: '1rem',
                    padding: '0 4px',
                    lineHeight: 1,
                  }}
                  title="Remove"
                >
                  ✕
                </button>
              </li>
            </React.Fragment>
          ))}
          {dropIndex === boatNumbers.length && (
            <div
              style={{
                height: '2px',
                background: 'var(--ocean, #1a6fa3)',
                borderRadius: '1px',
                margin: '2px 0',
              }}
            />
          )}
        </ul>

        {invalidBoatNumbers.length > 0 && (
          <div
            role="alert"
            style={{
              alignSelf: 'flex-start',
              background: 'var(--danger, #e63946)',
              color: '#fff',
              padding: '6px 10px',
              borderRadius: '999px',
              fontSize: '0.8rem',
              fontWeight: 700,
              letterSpacing: '0.01em',
              boxShadow: '0 1px 4px rgba(230,57,70,0.3)',
            }}
          >
            {invalidBoatNumbers.length} invalid sail
            {invalidBoatNumbers.length === 1 ? '' : 's'} in finish order
          </div>
        )}

        {/* Submit */}
        <button
          type="button"
          onClick={handleSubmit}
          style={{
            padding: '12px 24px',
            borderRadius: 'var(--radius, 6px)',
            border: 'none',
            background: 'var(--teal, #2a9d8f)',
            color: '#fff',
            fontWeight: 700,
            fontSize: '1rem',
            cursor: 'pointer',
            letterSpacing: '0.02em',
            boxShadow: '0 2px 8px rgba(42,157,143,0.25)',
          }}
        >
          Submit Scores
        </button>
      </div>
    </div>
  );
}

ScoringInputComponent.propTypes = {
  heat: PropTypes.shape({
    heat_id: PropTypes.number.isRequired,
    heat_name: PropTypes.string.isRequired,
    boats: PropTypes.arrayOf(
      PropTypes.shape({
        boat_id: PropTypes.number.isRequired,
        name: PropTypes.string.isRequired,
        surname: PropTypes.string.isRequired,
        country: PropTypes.string.isRequired,
        sail_number: PropTypes.number.isRequired,
      }),
    ).isRequired,
  }).isRequired,
  onSubmit: PropTypes.func.isRequired,
};

export default ScoringInputComponent;
