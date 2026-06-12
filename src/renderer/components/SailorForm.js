/* eslint-disable jsx-a11y/label-has-associated-control */
/* eslint-disable camelcase */
import React, { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import Autosuggest from 'react-autosuggest';
import { toast } from 'react-toastify';
import { reportError, reportInfo } from '../utils/userFeedback';

import iocCountries from '../constants/iocCountries.json';

// Plain-language labels (category IDs map to the seeded Categories table).
const SUBGROUP_OPTIONS = [
  { value: 'M', label: 'M — Masters (Veteran)', categoryId: 4 },
  { value: 'GM', label: 'GM — Grand Masters (Master)', categoryId: 5 },
  { value: 'L', label: 'L — Open (Senior)', categoryId: 3 },
  { value: 'U25', label: 'U25 — Under 25 (Junior)', categoryId: 2 },
  { value: 'U16', label: 'U16 — Under 16 (Kadet)', categoryId: 1 },
];

function SailorForm({ onAddSailor, eventId }) {
  SailorForm.propTypes = {
    onAddSailor: PropTypes.func.isRequired,
    eventId: PropTypes.number.isRequired,
  };

  const [name, setName] = useState('');
  const [surname, setSurname] = useState('');
  const [subgroup, setSubgroup] = useState('');
  const [club, setClub] = useState('');
  const [clubs, setClubs] = useState([]);
  const [selectedCountry, setSelectedCountry] = useState('');
  const [sailNumber, setSailNumber] = useState('');
  const [model, setModel] = useState('');
  const [raceHappened, setRaceHappened] = useState(false);
  const [suggestions, setSuggestions] = useState([]);

  const fetchClubs = async () => {
    try {
      const allClubs = await window.electron.sqlite.sailorDB.readAllClubs();
      setClubs(allClubs);
    } catch (error) {
      reportError('Could not load clubs.', error);
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
      reportError('Could not check race status.', error);
    }
  }, [eventId]);

  useEffect(() => {
    fetchClubs();
    checkIfRaceHappened();
  }, [checkIfRaceHappened]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (raceHappened) {
      toast.error(
        'No more sailors can be added as a race has already happened.',
      );
      return;
    }
    try {
      const selectedSubgroup = SUBGROUP_OPTIONS.find(
        (option) => option.value === subgroup,
      );

      if (!selectedSubgroup) {
        reportError('Please select a subgroup.');
        return;
      }

      const category_id = selectedSubgroup.categoryId;
      const birthday = '';

      // Check if the club already exists
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
            } else {
              throw new Error('Club exists but could not retrieve its ID');
            }
          } else {
            reportError('There was an error inserting the club.', error);
            return; // Exit the function gracefully
          }
        }
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
        } catch (error) {
          reportError('There was an error inserting the sailor.', error);
          return; // Exit the function gracefully
        }
      }

      const eventBoats =
        await window.electron.sqlite.eventDB.readBoatsByEvent(eventId);

      let boat_id = null;

      try {
        const boatResult = await window.electron.sqlite.sailorDB.insertBoat(
          sailNumber,
          selectedCountry,
          model,
          sailor_id,
        );
        boat_id = boatResult.lastInsertRowid;
      } catch (error) {
        reportError('There was an error inserting the boat.', error);
        return; // Exit the function gracefully
      }

      const existingAssociation = eventBoats.find((b) => b.boat_id === boat_id);

      if (!existingAssociation) {
        try {
          await window.electron.sqlite.eventDB.associateBoatWithEvent(
            boat_id,
            eventId,
          );
        } catch (error) {
          reportError(
            'There was an error associating the boat with the event.',
            error,
          );
          return; // Exit the function gracefully
        }
      }
      setName('');
      setSurname('');
      setSubgroup('');
      setClub('');
      setSelectedCountry('');
      setSailNumber('');
      setModel('');

      onAddSailor();
      reportInfo('Sailor and boat added successfully.', 'Success');
    } catch (error) {
      reportError('An unexpected error occurred.', error);
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
              <label htmlFor="sf-subgroup">Subgroup</label>
              <select
                id="sf-subgroup"
                value={subgroup}
                onChange={(e) => setSubgroup(e.target.value)}
                required
              >
                <option value="" disabled>
                  Select subgroup...
                </option>
                {SUBGROUP_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
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
