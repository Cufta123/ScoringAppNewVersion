import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { reportError } from '../utils/userFeedback';

const POSITION_KEEPING_PENALTIES = new Set(['ZFP', 'SCP']);

function ScoringInputComponent({ heat, onSubmit }) {
  const [inputValue, setInputValue] = useState('');
  const [boatNumbers, setBoatNumbers] = useState([]);
  const [validBoats, setValidBoats] = useState([]);
  const [placeNumbers, setPlaceNumbers] = useState({});
  const [penalties, setPenalties] = useState({});
  const [draggingIndex, setDraggingIndex] = useState(null);
  const [dropIndex, setDropIndex] = useState(null);

  useEffect(() => {
    const fetchBoats = async () => {
      try {
        const boats = await window.electron.sqlite.heatRaceDB.readBoatsByHeat(
          heat.heat_id,
        );
        setValidBoats(boats.map((boat) => boat.sail_number));
      } catch (error) {
        reportError('Could not load boats for selected heat.', error);
      }
    };

    fetchBoats();
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

    const withPenalty = validNew.filter((n) => penalties[n]);
    const withoutPenalty = validNew.filter((n) => !penalties[n]);

    const updatedBoatNumbers = [...boatNumbers, ...withoutPenalty];
    const updatedPlaceNumbers = { ...placeNumbers };

    updatedBoatNumbers.forEach((boat, index) => {
      if (!penalties[boat]) updatedPlaceNumbers[boat] = index + 1;
    });

    withPenalty.forEach((boat) => {
      updatedBoatNumbers.push(boat);
      updatedPlaceNumbers[boat] = updatedBoatNumbers.length;
    });

    setBoatNumbers(updatedBoatNumbers);
    setPlaceNumbers(updatedPlaceNumbers);
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
    const newPlaceNumbers = {};
    boats.forEach((boat, index) => {
      newPlaceNumbers[boat] = index + 1;
    });
    setPlaceNumbers(newPlaceNumbers);
  };

  const handleRemoveBoat = (index) => {
    const updatedBoatNumbers = [...boatNumbers];
    const removedBoat = updatedBoatNumbers.splice(index, 1)[0];

    const updatedPlaceNumbers = { ...placeNumbers };
    delete updatedPlaceNumbers[removedBoat];

    // Update place numbers for remaining boats
    updatedBoatNumbers.forEach((boat, idx) => {
      if (!penalties[boat]) {
        updatedPlaceNumbers[boat] = idx + 1;
      }
    });

    setBoatNumbers(updatedBoatNumbers);
    setPlaceNumbers(updatedPlaceNumbers);
  };

  const handleReorderBoat = (fromIndex, toIndex) => {
    const updatedBoatNumbers = [...boatNumbers];
    const [movedBoat] = updatedBoatNumbers.splice(fromIndex, 1);
    updatedBoatNumbers.splice(toIndex, 0, movedBoat);
    setBoatNumbers(updatedBoatNumbers);
    updatePlaces(updatedBoatNumbers);
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
    const newPenalties = { ...penalties, [boatNumber]: penalty };
    if (!penalty) delete newPenalties[boatNumber];
    setPenalties(newPenalties);

    // If this boat is already in the ranked list, reorder:
    // non-penalized and scoring-penalty boats keep their relative order,
    // displacing penalties move to the bottom.
    if (boatNumbers.includes(boatNumber)) {
      const withPosition = boatNumbers.filter(
        (n) =>
          !newPenalties[n] || POSITION_KEEPING_PENALTIES.has(newPenalties[n]),
      );
      const displaced = boatNumbers.filter(
        (n) => newPenalties[n] && !POSITION_KEEPING_PENALTIES.has(newPenalties[n]),
      );
      const reordered = [...withPosition, ...displaced];
      const newPlaceNumbers = {};
      withPosition.forEach((n, i) => {
        newPlaceNumbers[n] = i + 1;
      });
      displaced.forEach((n) => {
        newPlaceNumbers[n] = withPosition.length + 1;
      });
      setBoatNumbers(reordered);
      setPlaceNumbers(newPlaceNumbers);
    }
  };

  const handleSubmit = () => {
    const allBoats = [...new Set([...boatNumbers, ...validBoats])];
    const boatPlaces = [];
    let finishingPlace = 1;

    boatNumbers.forEach((boatNumber) => {
      const penalty = penalties[boatNumber];
      if (!penalty) {
        boatPlaces.push({ boatNumber, place: finishingPlace, status: 'FINISHED' });
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
        place: allBoats.length + 1,
        status: penalty,
      });
    });

    const allBoatsAccountedFor = allBoats.every(
      (boatNumber) => placeNumbers[boatNumber] || penalties[boatNumber],
    );

    if (allBoatsAccountedFor) {
      onSubmit(boatPlaces);
    } else {
      alert(
        'All boats must be assigned a place or a penalty before submitting.',
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
            fontSize: '0.82rem',
            color: 'var(--text-muted, #666)',
          }}
        >
          Click a row to add the boat to the finish order
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
                return (
                  <tr
                    key={boat.boat_id}
                    onClick={() => handleBoatClick(boat.sail_number)}
                    style={{
                      background: added
                        ? 'var(--teal-light, #e8f5f1)'
                        : i % 2 === 0
                          ? '#fff'
                          : 'var(--surface, #f5f7fa)',
                      borderBottom: '1px solid var(--border, #dde3ea)',
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
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  marginBottom: '6px',
                  padding: '8px 12px',
                  border: '1px solid var(--border, #dde3ea)',
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
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoveBoat(index)}
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
