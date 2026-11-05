/* eslint-disable jsx-a11y/label-has-associated-control */
import React, { useState } from 'react';
import Autosuggest from 'react-autosuggest';
import { useQuery } from '@tanstack/react-query';
import {
  confirmAction,
  reportError,
  reportInfo,
  reportWarning,
  getErrorMessage,
} from '../utils/userFeedback';

import IOC_NATIONS from '../constants/iocNations';
import { SUBGROUP_OPTIONS } from '../../shared/subgroups';
import { sailorDB } from '../api/db';
import { queries, useReportQueryError } from '../api/queries';
import { useWrite } from '../api/writes';
import type { ClubRow } from '../types';

interface SailorFormProps {
  eventId: number;
}

function SailorForm({ eventId }: SailorFormProps) {
  const [name, setName] = useState('');
  const [surname, setSurname] = useState('');
  const [subgroup, setSubgroup] = useState('');
  const [club, setClub] = useState('');
  const [selectedCountry, setSelectedCountry] = useState('');
  const [sailNumber, setSailNumber] = useState('');
  const [model, setModel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [suggestions, setSuggestions] = useState<ClubRow[]>([]);
  const nameInputRef = React.useRef<HTMLInputElement>(null);

  const clubsQuery = useQuery(queries.clubs());
  useReportQueryError(clubsQuery, 'Could not load clubs.');
  const clubs = clubsQuery.data ?? [];
  const raceHappenedQuery = useQuery(queries.raceHappened(eventId));
  useReportQueryError(raceHappenedQuery, 'Could not check race status.');
  const raceHappened = raceHappenedQuery.data ?? false;

  // The entries are read again, and a new club or boat shows up on file
  // (the club suggestions for the next sailor).
  const enterSailor = useWrite(
    (...args: Parameters<typeof sailorDB.enterSailorInEvent>) =>
      sailorDB.enterSailorInEvent(...args),
    { eventId, onFile: true },
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Guard against a second submission while the first is still in flight.
    // handleSubmit chains several sequential DB round-trips, so without this a
    // fast double-click (or a slow IPC/SQLite response) can run the handler
    // twice and pile up duplicate club/boat rows.
    if (submitting) return;

    if (raceHappened) {
      reportInfo(
        'No more sailors can be added as a race has already happened.',
        'Action blocked',
      );
      return;
    }
    // Stray spaces typed around a name or club must not make a second sailor
    // or club ("Ana " is not "Ana"), and a field of spaces is still empty.
    const firstName = name.trim();
    const lastName = surname.trim();
    const clubName = club.trim();
    if (!firstName || !lastName || !clubName) {
      reportWarning(
        'First name, surname and club cannot be empty or only spaces.',
        'Missing information',
      );
      return;
    }

    const selectedSubgroup = SUBGROUP_OPTIONS.find(
      (option) => option.value === subgroup,
    );
    if (!selectedSubgroup) {
      reportWarning('Please select a subgroup.', 'Missing information');
      return;
    }

    setSubmitting(true);
    try {
      // One call: club, sailor, boat and entry are written together or not
      // at all (main/functions/sailorEntry.ts). It writes nothing when the
      // boat is registered to someone else; then we ask and call again.
      const entry = {
        name: firstName,
        surname: lastName,
        clubName,
        country: selectedCountry,
        sailNumber: sailNumber.trim(),
        model: model.trim(),
        categoryId: selectedSubgroup.categoryId,
      };
      let outcome;
      try {
        outcome = await enterSailor(entry, eventId);
        if (outcome.status === 'ownerConflict') {
          const typedName = `${firstName} ${lastName}`;
          const proceed = await confirmAction(
            `Sail ${entry.sailNumber} (${selectedCountry}) is already registered to ` +
              `${outcome.ownerName}. If you add it now, this entry will be scored under ` +
              `${outcome.ownerName}, not ${typedName}.\n\n` +
              `Choose "Use existing sailor" to enter ${outcome.ownerName}, or Cancel to ` +
              `correct the sail number or country.`,
            'Sail number already in use',
            { confirmLabel: 'Use existing sailor', cancelLabel: 'Cancel' },
          );
          if (!proceed) return;
          outcome = await enterSailor(entry, eventId, {
            useRegisteredSailor: true,
          });
        }
      } catch (error) {
        const message = getErrorMessage(error);
        const reason = message.match(/Sail .* is already entered[^.]*\./);
        if (reason) {
          reportWarning(reason[0], 'Already entered');
        } else {
          reportError('Could not add the sailor and boat.', error);
        }
        return;
      }

      if (outcome.status === 'alreadyEntered') {
        reportInfo(
          `Sail ${entry.sailNumber} (${selectedCountry}) is already registered in this event.`,
          'Already registered',
        );
        return;
      }

      // Clear only the per-sailor fields. Country and Club are intentionally
      // retained: rosters are usually entered club-by-club / nation-by-nation,
      // so keeping them saves re-selecting the same values for every sailor.
      setName('');
      setSurname('');
      setSubgroup('');
      setSailNumber('');
      setModel('');
      // Return focus to the first field so the next sailor can be typed straight
      // away without reaching for the mouse.
      nameInputRef.current?.focus();

      reportInfo('Sailor and boat added successfully.', 'Success');
    } catch (error) {
      reportError('Could not add the sailor and boat.', error);
    } finally {
      setSubmitting(false);
    }
  };
  const getSuggestions = (value: string): ClubRow[] => {
    const inputValue = value.trim().toLowerCase();
    const inputLength = inputValue.length;

    return inputLength === 0
      ? []
      : clubs.filter(
          (c) => c.club_name.toLowerCase().slice(0, inputLength) === inputValue,
        );
  };

  const getSuggestionValue = (suggestion: ClubRow): string =>
    suggestion.club_name;

  const renderSuggestion = (suggestion: ClubRow) => (
    <div>
      {suggestion.club_name} ({suggestion.country})
    </div>
  );

  const onClubChange = (
    _event: React.FormEvent<HTMLElement>,
    { newValue }: { newValue: string },
  ) => {
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
                ref={nameInputRef}
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
                {Object.entries(IOC_NATIONS).map(([code, nation]) => (
                  <option key={code} value={code}>
                    {nation.name} ({code})
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
            <button type="submit" className="btn-success" disabled={submitting}>
              {submitting ? (
                <>
                  <i className="fa fa-spinner fa-spin" aria-hidden="true" />{' '}
                  Saving…
                </>
              ) : (
                <>
                  <i className="fa fa-plus" aria-hidden="true" /> Add Sailor
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default SailorForm;
