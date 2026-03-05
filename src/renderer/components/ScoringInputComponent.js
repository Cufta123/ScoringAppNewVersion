import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';

function ScoringInputComponent({ heat, onSubmit }) {
  const [inputValue, setInputValue] = useState('');
  const [boatNumbers, setBoatNumbers] = useState([]);
  const [temporaryBoats, setTemporaryBoats] = useState([]);
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
        console.error('Error fetching boats:', error);
      }
    };

    fetchBoats();
  }, [heat.heat_id]);

  const handleInputChange = (e) => {
    const input = e.target.value;
    const inputNumbers = input
      .split(' ')
      .map(Number)
      .filter((n) => !Number.isNaN(n));

    const uniqueNumbers = [...new Set(inputNumbers)];
    setTemporaryBoats(uniqueNumbers); // Temporarily track boats
    setInputValue(input);
  };

  const handleBoatClick = (sailNumber) => {
    if (!temporaryBoats.includes(sailNumber)) {
      const updatedTemporaryBoats = [...temporaryBoats, sailNumber];
      setTemporaryBoats(updatedTemporaryBoats);
      setInputValue(updatedTemporaryBoats.join(' ')); // Reflect in the input field
    }
  };

  const handleAddBoats = () => {
    const validNewBoats = temporaryBoats.filter(
      (number) => !boatNumbers.includes(number) && validBoats.includes(number),
    );

    const boatsWithPenalties = validNewBoats.filter(
      (number) => penalties[number],
    );

    const boatsWithoutPenalties = validNewBoats.filter(
      (number) => !penalties[number],
    );

    const updatedBoatNumbers = [...boatNumbers, ...boatsWithoutPenalties];
    const updatedPlaceNumbers = { ...placeNumbers };

    boatsWithoutPenalties.forEach((boat) => {
      if (!updatedPlaceNumbers[boat]) {
        updatedPlaceNumbers[boat] = updatedBoatNumbers.indexOf(boat) + 1;
      }
    });

    boatsWithPenalties.forEach((boat) => {
      updatedBoatNumbers.push(boat);
      updatedPlaceNumbers[boat] = updatedBoatNumbers.length;
    });

    // Update place numbers for all boats
    updatedBoatNumbers.forEach((boat, index) => {
      if (!penalties[boat]) {
        updatedPlaceNumbers[boat] = index + 1;
      }
    });

    setBoatNumbers(updatedBoatNumbers);
    setPlaceNumbers(updatedPlaceNumbers);
    setTemporaryBoats([]); // Clear temporary state
    setInputValue(''); // Clear input field
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
    setPenalties((prevPenalties) => ({
      ...prevPenalties,
      [boatNumber]: penalty,
    }));
  };

  const handleSubmit = () => {
    const allBoats = [...new Set([...boatNumbers, ...validBoats])];
    const boatsWithPenalties = allBoats.filter(
      (boatNumber) => penalties[boatNumber],
    );
    const boatsWithoutPenalties = allBoats.filter(
      (boatNumber) => !penalties[boatNumber],
    );

    // Assign place numbers to boats without penalties
    const boatPlaces = boatsWithoutPenalties.map((boatNumber, index) => {
      const place = index + 1;
      return {
        boatNumber,
        place,
        status: 'FINISHED',
      };
    });

    // Assign place numbers to boats with penalties
    boatsWithPenalties.forEach((boatNumber) => {
      const penalty = penalties[boatNumber];
      const place = allBoats.length + 1;
      boatPlaces.push({
        boatNumber,
        place,
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

  const getPlaceNumber = (sailNumber) => {
    if (penalties[sailNumber]) {
      return penalties[sailNumber]; // Display penalty if it exists
    }
    if (temporaryBoats.includes(sailNumber)) {
      // Display temporary place
      return temporaryBoats.indexOf(sailNumber) + 1 + boatNumbers.length;
    }
    return placeNumbers[sailNumber] || ''; // Display final place
  };
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        width: '100%',
        height: '100vh',
      }}
    >
      <div style={{ flex: '1', padding: '10px', boxSizing: 'border-box' }}>
        <h2>Scoring for {heat.heat_name}</h2>
        <p>Heat ID: {heat.heat_id}</p>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '10px',
            padding: '10px',
          }}
        >
          <div
            style={{
              backgroundColor: '#f0f0f0',
              border: '1px solid #ccc',
              borderRadius: '5px',
              padding: '10px',
              width: '100%',
              boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
              cursor: 'pointer',
            }}
          >
            <h4>{heat.heat_name}</h4>
            <table>
              <thead>
                <tr>
                  <th>Sailor Name</th>
                  <th>Country</th>
                  <th>Boat Number</th>
                  <th>Place</th>
                  <th>Penalty</th>
                </tr>
              </thead>
              <tbody>
                {heat.boats.map((boat) => (
                  <tr
                    key={boat.boat_id}
                    onClick={() => handleBoatClick(boat.sail_number)}
                  >
                    <td>
                      {boat.name} {boat.surname}
                    </td>
                    <td>{boat.country}</td>
                    <td>{boat.sail_number}</td>
                    <td>{getPlaceNumber(boat.sail_number)}</td>
                    <td>
                      <select
                        value={penalties[boat.sail_number] || ''}
                        onChange={(e) =>
                          handlePenaltyChange(boat.sail_number, e.target.value)
                        }
                      >
                        <option value="">None</option>
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
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div style={{ flex: '1', padding: '10px', boxSizing: 'border-box' }}>
        <h2>Scoring Input</h2>
        <div>
          <input
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            placeholder="Enter boat number"
            style={{
              width: '100%',
              padding: '10px',
              marginBottom: '10px',
              boxSizing: 'border-box',
            }}
          />
          <button type="button" onClick={handleAddBoats}>
            Add Boat
          </button>
        </div>
        <ul>
          {boatNumbers.map((number, index) => (
            <React.Fragment key={number}>
              {dropIndex === index && (
                <div
                  style={{
                    height: '2px', // Thinner line for a subtle look
                    backgroundColor: '#007bff', // Blue color for visibility
                    width: '30%', // Half the width of the list items
                    marginLeft: '5px', // Align the line to the left
                    borderRadius: '1px', // Rounded edges for better appearance
                    alignContent: 'center', // Center the line
                  }}
                />
              )}
              <li
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  marginBottom: '10px',
                  cursor: 'move',
                  padding: '5px',
                  border: '1px solid #ccc',
                  borderRadius: '5px',
                  backgroundColor: '#f9f9f9',
                  width: 'calc(100% - 10px)',
                }}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={handleDragOver(index)}
                onDrop={handleDrop}
              >
                <span style={{ marginRight: '10px' }}>
                  Boat {number} -{' '}
                  {penalties[number]
                    ? `Penalty: ${penalties[number]}`
                    : `Place: ${placeNumbers[number]}`}
                </span>
                <button type="button" onClick={() => handleRemoveBoat(index)}>
                  Remove
                </button>
              </li>
            </React.Fragment>
          ))}
          {dropIndex === boatNumbers.length && (
            <div
              style={{
                height: '5px',
                backgroundColor: '#007bff',
                marginLeft: '0', // Align the line to the left
                width: '50%', // Half the width of the list items
              }}
            />
          )}
        </ul>
        <button type="button" onClick={handleSubmit}>
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
