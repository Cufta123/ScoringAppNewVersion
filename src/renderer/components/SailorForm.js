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
      const eventBoats =
        await window.electron.sqlite.eventDB.readBoatsByEvent(eventId);
      console.log(`Boats for event ID ${eventId}:`, eventBoats);

      let boat_id = null;

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
  return (
    <div>
      {raceHappened ? (
        <p>No more sailors can be added as a race has already happened.</p>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="sailor-form-grid">
            <div className="sailor-form-field">
              <label htmlFor="sf-name">First Name</label>
              <input
                id="sf-name"
                type="text"
                placeholder="e.g. Antonio"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="sailor-form-field">
              <label htmlFor="sf-surname">Surname</label>
              <input
                id="sf-surname"
                type="text"
                placeholder="e.g. Luksic"
                value={surname}
                onChange={(e) => setSurname(e.target.value)}
                required
              />
            </div>
            <div className="sailor-form-field">
              <label htmlFor="sf-birthday">Date of Birth</label>
              <input
                id="sf-birthday"
                type="date"
                value={birthday}
                onChange={(e) => setBirthday(e.target.value)}
                required
              />
            </div>
            <div className="sailor-form-field">
              <label htmlFor="sf-sail">Sail Number</label>
              <input
                id="sf-sail"
                type="text"
                placeholder="e.g. 207386"
                value={sailNumber}
                onChange={(e) => setSailNumber(e.target.value)}
                required
              />
            </div>
            <div className="sailor-form-field">
              <label htmlFor="sf-country">Country</label>
              <select
                id="sf-country"
                value={selectedCountry}
                onChange={(e) => setSelectedCountry(e.target.value)}
                required
              >
                <option value="" disabled>
                  Select country…
                </option>
                {Object.entries(iocCountries).map(([code, countryName]) => (
                  <option key={code} value={code}>
                    {countryName} ({code})
                  </option>
                ))}
              </select>
            </div>
            <div className="sailor-form-field">
              <label htmlFor="sf-model">Boat Model</label>
              <input
                id="sf-model"
                type="text"
                placeholder="e.g. ILCA"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </div>
            <div className="sailor-form-field">
              <label htmlFor="sf-club">Club</label>
              <Autosuggest
                suggestions={suggestions}
                onSuggestionsFetchRequested={({ value }) =>
                  setSuggestions(getSuggestions(value))
                }
                onSuggestionsClearRequested={() => setSuggestions([])}
                getSuggestionValue={getSuggestionValue}
                renderSuggestion={renderSuggestion}
                inputProps={{
                  id: 'sf-club',
                  placeholder: 'e.g. Opatija',
                  value: club,
                  onChange: onClubChange,
                  required: true,
                  className: 'autosuggest-input',
                }}
                theme={{
                  container: 'autosuggest-container',
                  input: 'autosuggest-input',
                  suggestionsContainer: 'autosuggest-suggestions-container',
                  suggestionsContainerOpen:
                    'autosuggest-suggestions-container--open',
                  suggestionsList: 'autosuggest-suggestions-list',
                  suggestion: 'autosuggest-suggestion',
                  suggestionHighlighted: 'autosuggest-suggestion--highlighted',
                }}
              />
            </div>
          </div>
          <div style={{ marginTop: '16px' }}>
            <button type="submit" className="btn-success">
              <i className="fa fa-plus" aria-hidden="true" /> Add Sailor
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default SailorForm;
