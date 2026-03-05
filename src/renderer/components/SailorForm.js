/* eslint-disable camelcase */
import React, { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import Autosuggest from 'react-autosuggest';
import { toast } from 'react-toastify';

import iocCountries from '../constants/iocCountries.json';

function SailorForm({ onAddSailor, eventId }) {
  SailorForm.propTypes = {
    onAddSailor: PropTypes.func.isRequired,
    eventId: PropTypes.number.isRequired,
  };

  const [name, setName] = useState('');
  const [surname, setSurname] = useState('');
  const [birthday, setBirthday] = useState('');
  const [club, setClub] = useState('');
  const [clubs, setClubs] = useState([]);
  const [selectedCountry, setSelectedCountry] = useState('');
  const [sailNumber, setSailNumber] = useState('');
  const [model, setModel] = useState('');
  const [boats, setBoats] = useState([]);
  const [raceHappened, setRaceHappened] = useState(false);
  const [suggestions, setSuggestions] = useState([]);

  const fetchSailors = async () => {
    try {
      const allSailors = await window.electron.sqlite.sailorDB.readAllSailors();
      console.log('Fetched sailors:', allSailors);
    } catch (error) {
      console.error('Error fetching sailors:', error);
    }
  };

  const fetchClubs = async () => {
    try {
      const allClubs = await window.electron.sqlite.sailorDB.readAllClubs();
      setClubs(allClubs);
    } catch (error) {
      console.error('Error fetching clubs:', error);
    }
  };

  const fetchBoats = async () => {
    try {
      const allBoats = await window.electron.sqlite.sailorDB.readAllBoats();
      console.log('Fetched boats:', allBoats); // Log the structure of the fetched boats
      setBoats(allBoats);
    } catch (error) {
      console.error('Error fetching boats:', error);
    }
  };

  const checkIfRaceHappened = useCallback(async () => {
    try {
      const heats =
        await window.electron.sqlite.heatRaceDB.readAllHeats(eventId);
      const racePromises = heats.map((heat) =>
        window.electron.sqlite.heatRaceDB.readAllRaces(heat.heat_id),
      );
      const races = await Promise.all(racePromises);
      const anyRaceHappened = races.some((raceArray) => raceArray.length > 0);
      setRaceHappened(anyRaceHappened);
    } catch (error) {
      console.error('Error checking if race happened:', error);
    }
  }, [eventId]);

  useEffect(() => {
    fetchSailors();
    fetchClubs();
    fetchBoats();
    checkIfRaceHappened();
  }, [checkIfRaceHappened]);

  const calculateCategory = () => {
    const birthYear = new Date(birthday).getFullYear();
    const currentYear = new Date().getFullYear();
    const age = currentYear - birthYear;

    if (age <= 12) return 1; // Kadet
    if (age <= 18) return 2; // Junior
    if (age <= 35) return 3; // Senior
    if (age <= 50) return 4; // Master
    return 5; // Grand Master
  };

  const handleSubmit = async (e) => {
    e.preventDefault();


    if (raceHappened) {
      toast.error(
        'No more sailors can be added as a race has already happened.',
      );
      return;
    }
    try {
      const category_id = calculateCategory(birthday);
      console.log(`Category ID calculated: ${category_id}`);

      // Check if the club already exists
      console.log('Existing clubs:', clubs); // Log the existing clubs
      let club_id = clubs.find(
        (c) => c.club_name === club && c.country === selectedCountry,
      )?.club_id;
      if (!club_id) {
        try {
          const result = await window.electron.sqlite.sailorDB.insertClub(
            club,
            selectedCountry,
          );
          club_id = result.lastInsertRowid;
          console.log(`Club inserted with ID: ${club_id}`);

          // Update the clubs state with the newly added club
          setClubs([
            ...clubs,
            { club_id, club_name: club, country: selectedCountry },
          ]);
        } catch (error) {
          if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            const existingClub = clubs.find(
              (c) => c.club_name === club && c.country === selectedCountry,
            );
            if (existingClub) {
              club_id = existingClub.club_id;
              console.log(`Club already exists with ID: ${club_id}`);
            } else {
              throw new Error('Club exists but could not retrieve its ID');
            }
          } else {
            console.error('Error inserting club:', error);
            alert('There was an error inserting the club.');
            return; // Exit the function gracefully
          }
        }
      } else {
        console.log(`Club found with ID: ${club_id}`);
      }

      const allSailors = await window.electron.sqlite.sailorDB.readAllSailors();
      let sailor_id = allSailors.find(
        (s) =>
          s.name === name && s.surname === surname && s.birthday === birthday,
      )?.sailor_id;

      if (!sailor_id) {
        try {
          const sailorResult =
            await window.electron.sqlite.sailorDB.insertSailor(
              name,
              surname,
              birthday,
              category_id,
              club_id,
            );
          sailor_id = sailorResult.lastInsertRowid;
          console.log(`Sailor inserted with ID: ${sailor_id}`);
        } catch (error) {
          console.error('Error inserting sailor:', error);
          alert('There was an error inserting the sailor.');
          return; // Exit the function gracefully
        }
      } else {
        console.log(`Sailor found with ID: ${sailor_id}`);
      }

      const sailorBoats = boats.filter((b) => b.sailor_id === sailor_id);
      console.log(`Boats for sailor ID ${sailor_id}:`, sailorBoats);

      const existingBoatForSailor = sailorBoats.find(
        (b) => b.sail_number.toString().trim() === sailNumber.toString().trim(),
      );
      if (existingBoatForSailor) {
        console.warn(
          `Sailor ID ${sailor_id} already owns a boat with sail number ${sailNumber}`,
        );
        toast.error(
          `This sailor already owns a boat with sail number ${sailNumber}.`,
        );
        return; // Exit the function gracefully
      }
      const eventBoats =
        await window.electron.sqlite.eventDB.readBoatsByEvent(eventId);
      console.log(`Boats for event ID ${eventId}:`, eventBoats);

      const existingBoatInEvent = eventBoats.find(
        (b) => b.sail_number.toString().trim() === sailNumber.toString().trim(),
      );

      if (existingBoatInEvent) {
        console.warn(
          `Boat with sail number ${sailNumber} already exists in event ID ${eventId}`,
        );
        toast.error(
          'A boat with the same sail number already exists in this event.',
        );
        return; // Exit the function gracefully
      }

      let boat_id = null;

      const existingBoat = sailorBoats.find(
        (b) => b.sail_number === sailNumber,
      );

      if (existingBoat) {
        boat_id = existingBoat.boat_id;
        console.log(
          `Using existing boat ID ${boat_id} for sail number ${sailNumber}`,
        );
      } else {
        try {
          const boatResult = await window.electron.sqlite.sailorDB.insertBoat(
            sailNumber,
            selectedCountry,
            model,
            sailor_id,
          );
          boat_id = boatResult.lastInsertRowid;
          console.log(`Boat inserted with ID: ${boat_id}`);
        } catch (error) {
          console.error('Error inserting boat:', error);
          alert('There was an error inserting the boat.');
          return; // Exit the function gracefully
        }
      }

      const existingAssociation = eventBoats.find((b) => b.boat_id === boat_id);

      if (existingAssociation) {
        console.log(
          `Boat ID ${boat_id} is already associated with event ID ${eventId}`,
        );
      } else {
        try {
          await window.electron.sqlite.eventDB.associateBoatWithEvent(
            boat_id,
            eventId,
          );
          console.log(`Boat ID ${boat_id} associated with event ID ${eventId}`);
        } catch (error) {
          console.error('Error associating boat with event:', error);
          alert('There was an error associating the boat with the event.');
          return; // Exit the function gracefully
        }
      }
      await onAddSailor({
        name,
        surname,
        birthday,
        club_id,
        selectedCountry,
        sailNumber,
        model,
      });
      setName('');
      setSurname('');
      setBirthday('');
      setClub('');
      setSelectedCountry('');
      setSailNumber('');
      setModel('');

      fetchSailors();
      fetchBoats();
      onAddSailor();
    } catch (error) {
      console.error('Unexpected error during submission:', error);
      alert('An unexpected error occurred.');
    }
  };
  const getSuggestions = (value) => {
    const inputValue = value.trim().toLowerCase();
    const inputLength = inputValue.length;

    return inputLength === 0
      ? []
      : clubs.filter(
          (c) => c.club_name.toLowerCase().slice(0, inputLength) === inputValue,
        );
  };

  const getSuggestionValue = (suggestion) => suggestion.club_name;

  const renderSuggestion = (suggestion) => (
    <div>
      {suggestion.club_name} ({suggestion.country})
    </div>
  );

  const onSuggestionsFetchRequested = ({ value }) => {
    setSuggestions(getSuggestions(value));
  };

  const onSuggestionsClearRequested = () => {
    setSuggestions([]);
  };

  const onClubChange = (event, { newValue }) => {
    setClub(newValue);
  };
  const inputFieldStyle = {
    width: '100%',
    maxWidth: '400px',
    margin: '5px',
    boxSizing: 'border-box',
  };

  const autosuggestStyles = {
    container: {
      position: 'relative',
    },
    input: {
      width: '100%',
      maxWidth: '400px',
      padding: '2px 2px', // Adjust padding to match other inputs
      fontSize: '13px', // Ensure this matches the other fields
      lineHeight: '1', // Adjust line height for consistent height
      border: '1px solid #ccc',
      borderRadius: '4px',
      boxSizing: 'border-box', // Ensures padding doesn't affect height
    },
    suggestionsContainer: {
      position: 'absolute',
      zIndex: 1000,
      width: '100%',
      maxWidth: '400px',
      background: '#fff',
      border: '1px solid #ccc',
      borderTop: 'none',
      maxHeight: '200px',
      overflowY: 'auto',
      boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
    },
    suggestion: {
      padding: '8px',
      cursor: 'pointer',
      backgroundColor: '#fff',
    },
    suggestionHighlighted: {
      backgroundColor: '#f0f0f0',
    },
  };

  const formRowStyle = {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
  };

  const formFieldStyle = {
    flex: '1 1 calc(33.33% - 10px)',
    margin: '5px',
    boxSizing: 'border-box',
    ...inputFieldStyle, // Ensure existing input field styles are applied
  };

  return (
    <div>
      {raceHappened ? (
        <p>No more sailors can be added as a race has already happened.</p>
      ) : (
        <form onSubmit={handleSubmit}>
          <div style={formRowStyle}>
            <input
              type="text"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              style={formFieldStyle}
            />
            <input
              type="text"
              placeholder="Surname"
              value={surname}
              onChange={(e) => setSurname(e.target.value)}
              required
              style={formFieldStyle}
            />
            <input
              type="date"
              placeholder="Birthdate"
              value={birthday}
              onChange={(e) => setBirthday(e.target.value)}
              required
              style={formFieldStyle}
            />
          </div>
          <div style={formRowStyle}>
            <input
              type="text"
              placeholder="Sail Number"
              value={sailNumber}
              onChange={(e) => setSailNumber(e.target.value)}
              required
              style={formFieldStyle}
            />
            <select
              value={selectedCountry}
              onChange={(e) => setSelectedCountry(e.target.value)}
              required
              style={formFieldStyle}
            >
              <option value="" disabled>
                Select Country
              </option>
              {Object.entries(iocCountries).map(([code, countryName]) => (
                <option key={code} value={code}>
                  {countryName} ({code})
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              style={formFieldStyle}
            />
          </div>
          <Autosuggest
            suggestions={suggestions}
            onSuggestionsFetchRequested={onSuggestionsFetchRequested}
            onSuggestionsClearRequested={onSuggestionsClearRequested}
            getSuggestionValue={getSuggestionValue}
            renderSuggestion={renderSuggestion}
            inputProps={{
              placeholder: 'Club name',
              value: club,
              onChange: onClubChange,
              required: true,
              style: inputFieldStyle,
            }}
            theme={{
              container: autosuggestStyles.container,
              input: autosuggestStyles.input,
              suggestionsContainer: autosuggestStyles.suggestionsContainer,
              suggestion: autosuggestStyles.suggestion,
              suggestionHighlighted: autosuggestStyles.suggestionHighlighted,
            }}
          />
          <button type="submit">Add Sailor</button>
        </form>
      )}
    </div>
  );
}

export default SailorForm;
