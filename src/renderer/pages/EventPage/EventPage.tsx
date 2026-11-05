import React, { useState, useEffect, useCallback } from 'react';
import Select from 'react-select';
import { useNavigate, useParams } from 'react-router-dom';
import SailorForm from '../../components/SailorForm';
import SailorList from '../../components/SailorList';
import SailorImport from '../../components/SailorImport';
import Navbar from '../../components/Navbar';
import EventHeader from '../../components/shared/EventHeader';
import LoadingState from '../../components/shared/LoadingState';
import './EventPage.css';
import HeatsSummary from '../../components/heats/HeatsSummary';
import { useEventDataChanged } from '../../utils/eventDataChanged';
import {
  reportError,
  reportInfo,
  reportWarning,
  getErrorMessage,
} from '../../utils/userFeedback';
import { checkRaceHappened } from '../../utils/raceStatus';
import { eventDB, sailorDB } from '../../api/db';
import type { EventBoatRow } from '../../types';
import useRouteEvent from '../../hooks/useRouteEvent';
import { sailorFullName } from '../../utils/sailorName';
import StartingListExportDialog from '../../components/export/StartingListExportDialog';

type MappedEventBoat = EventBoatRow & {
  sailor: string;
  club: string;
  country: string;
  category: string;
  [key: string]: unknown;
};

interface BoatOption {
  value: number;
  label: string;
}

/** The ways to add sailors, in the order a race officer uses them. */
const ADD_MODES = [
  { id: 'single', label: 'One sailor', icon: 'fa-user-plus' },
  { id: 'existing', label: 'Boats on file', icon: 'fa-ship' },
  { id: 'bulk', label: 'CSV file', icon: 'fa-table' },
] as const;

function EventPage() {
  const navigate = useNavigate();
  const { name } = useParams();
  const event = useRouteEvent(name);
  const eventId = event?.event_id;

  const [boats, setBoats] = useState<MappedEventBoat[]>([]);
  const [boatsLoading, setBoatsLoading] = useState(true);
  const [allBoats, setAllBoats] = useState<EventBoatRow[]>([]);
  const [selectedBoats, setSelectedBoats] = useState<readonly BoatOption[]>([]);
  const [addSailorMode, setAddSailorMode] = useState('single');
  const [raceHappened, setRaceHappened] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const fetchBoatsWithSailors = useCallback(async () => {
    if (!eventId) return;

    setBoatsLoading(true);
    try {
      const boatsWithSailors = await eventDB.readBoatsByEvent(eventId);
      const mappedBoats: MappedEventBoat[] = boatsWithSailors.map((boat) => ({
        ...boat,
        sailor: boat.name,
        club: boat.club_name ?? '', // Map club_name to club
        country: boat.boat_country ?? '', // Map country_name to country
        category: boat.category_name ?? '', // Map category_name to category
      }));
      setBoats(mappedBoats);
    } catch (error) {
      reportError('Could not load boats for this event.', error);
    } finally {
      setBoatsLoading(false);
    }
  }, [eventId]);

  const fetchAllBoats = useCallback(async () => {
    try {
      const fetchedBoats = await sailorDB.readAllBoats();
      setAllBoats(fetchedBoats);
    } catch (error) {
      reportError('Could not load all boats.', error);
    }
  }, []);

  const checkIfRaceHappened = useCallback(async () => {
    if (!eventId) return;

    try {
      setRaceHappened(await checkRaceHappened(eventId));
    } catch (error) {
      reportError('Could not check race status.', error);
    }
  }, [eventId]);

  useEffect(() => {
    if (event) {
      fetchBoatsWithSailors();
      fetchAllBoats();
      checkIfRaceHappened();
    }
  }, [event, fetchBoatsWithSailors, fetchAllBoats, checkIfRaceHappened]);

  // Going back in the history (or an undo there) changed entries, heats or
  // races behind this page: load them again.
  const [heatsRefreshToken, setHeatsRefreshToken] = useState(0);
  useEventDataChanged(eventId ?? undefined, () => {
    fetchBoatsWithSailors();
    checkIfRaceHappened();
    setHeatsRefreshToken((token) => token + 1);
  });

  const handleAddSailor = () => {
    fetchBoatsWithSailors();
  };

  const handleImportComplete = useCallback(() => {
    fetchBoatsWithSailors();
    fetchAllBoats();
  }, [fetchBoatsWithSailors, fetchAllBoats]);

  const handleHeatRaceClick = () => {
    if (!event) return;
    navigate(`/event/${event.event_name}/heat-race`, { state: { event } });
  };

  const handleBoatSelection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!event) return;

    if (raceHappened) {
      reportInfo(
        'No more boats can be added as a race has already happened.',
        'Action blocked',
      );
      return;
    }

    try {
      const boatIds = selectedBoats.map((option) => option.value);
      await Promise.all(
        boatIds.map((boatId) =>
          eventDB.associateBoatWithEvent(boatId, event.event_id),
        ),
      );
      fetchBoatsWithSailors();
      setAllBoats((prevBoats) =>
        prevBoats.filter((boat) => !boatIds.includes(boat.boat_id)),
      );
      setSelectedBoats([]); // Clear the selected boats
    } catch (error) {
      reportError('Could not add selected boats to the event.', error);
    }
  };

  const handleBoatChange = (selectedOptions: readonly BoatOption[]) => {
    setSelectedBoats(selectedOptions);
  };

  const handleRemoveBoat = async (boatId: number): Promise<boolean> => {
    if (!event) return false;

    // Mirror the add-boat guard: once a race has been sailed the entry list is
    // fixed — removing a boat here would orphan its heat assignments and
    // scores. A withdrawal mid-series is recorded as WTH in scoring instead.
    if (raceHappened) {
      reportInfo(
        'Boats cannot be removed after a race has happened. Record a mid-series withdrawal by scoring the boat as WTH instead.',
        'Action blocked',
      );
      return false;
    }

    try {
      await eventDB.removeBoatFromEvent(boatId, event.event_id);

      // Find the removed boat
      const removedBoat = boats.find((boat) => boat.boat_id === boatId);

      // Remove the boat from the boats state first
      setBoats((prevBoats) =>
        prevBoats.filter((boat) => boat.boat_id !== boatId),
      );

      // Then add the removed boat to the allBoats state
      if (removedBoat) {
        setAllBoats((prevBoats) => [...prevBoats, removedBoat]);
      }
      return true;
    } catch (error) {
      const message = getErrorMessage(error);
      // The main process re-checks this because `raceHappened` here can be
      // stale. Its message names the WTH alternative, so pass it through
      // rather than replacing it with a generic failure.
      if (message.includes('race has already been scored')) {
        reportWarning(message, 'Boat not removed');
        return false;
      }
      reportError('Could not remove boat from the event.', error);
      return false;
    }
  };

  if (!event) {
    // Show a spinner (not a blank window) while the event resolves after a
    // reload; a blank page reads as a freeze to a non-technical user.
    return <LoadingState label="Loading event…" />;
  }

  const availableBoats = allBoats.filter(
    (boat) => !boats.some((eventBoat) => eventBoat.boat_id === boat.boat_id),
  );

  const boatOptions = availableBoats.map((boat) => ({
    value: boat.boat_id,
    label: `${boat.boat_country} ${boat.sail_number} - ${boat.model} (Sailor: ${sailorFullName(boat)})`,
  }));

  return (
    <div>
      <Navbar event={event} section="entries" />

      <main id="main-content" className="page-wrapper" tabIndex={-1}>
        {/* The next step once the entries are in (the navbar has every
            section; this is the one a race officer looks for here). */}
        <EventHeader
          event={event}
          actions={
            <button
              type="button"
              className="btn-success"
              onClick={handleHeatRaceClick}
            >
              <i className="fa fa-flag-checkered" aria-hidden="true" />
              Go to Scoring
            </button>
          }
        />

        {/* Where the racing stands; the heats are on the Scoring page. */}
        <HeatsSummary
          eventId={event.event_id}
          refreshToken={heatsRefreshToken}
        />

        {/* ── Warning banner ─── */}
        {raceHappened && (
          <div className="warning">
            <i
              className="fa fa-exclamation-triangle"
              aria-hidden="true"
              style={{ marginRight: '8px' }}
            />
            No more sailors or boats can be added because a race has already
            been scored.
          </div>
        )}

        {!raceHappened && (
          <div className="section-block">
            <h2>
              <i className="fa fa-user-plus" aria-hidden="true" />
              Add Sailors
            </h2>

            {/* Three ways in, one at a time (one used to be a block of its
                own under this one). The pill slides behind the open one. */}
            <div className="tab-toggle" role="group" aria-label="How to add">
              <div
                className="tab-pill"
                style={{
                  transform: `translateX(${ADD_MODES.findIndex((m) => m.id === addSailorMode) * 100}%)`,
                }}
              />
              {ADD_MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  className={`tab-btn${addSailorMode === mode.id ? ' tab-active' : ''}`}
                  aria-pressed={addSailorMode === mode.id}
                  onClick={() => setAddSailorMode(mode.id)}
                >
                  <i className={`fa ${mode.icon}`} aria-hidden="true" />{' '}
                  {mode.label}
                </button>
              ))}
            </div>

            <div className="tab-panel" key={addSailorMode}>
              {addSailorMode === 'single' && (
                <SailorForm
                  onAddSailor={handleAddSailor}
                  eventId={event.event_id}
                />
              )}
              {addSailorMode === 'existing' && (
                <>
                  <p className="tab-panel-note">
                    Boats already on this computer from earlier events.
                  </p>
                  <form
                    onSubmit={handleBoatSelection}
                    className="add-boat-form"
                  >
                    <div style={{ width: '100%', maxWidth: '460px' }}>
                      <Select
                        isMulti
                        value={selectedBoats}
                        onChange={handleBoatChange}
                        options={boatOptions}
                        closeMenuOnSelect={false}
                        placeholder="Search and select boats…"
                        styles={{
                          input: (base) => ({
                            ...base,
                            border: 'none',
                            boxShadow: 'none',
                            padding: 0,
                            margin: 0,
                            background: 'transparent',
                          }),
                        }}
                      />
                    </div>
                    <button
                      type="submit"
                      className="btn-success"
                      disabled={!selectedBoats || selectedBoats.length === 0}
                      title={
                        !selectedBoats || selectedBoats.length === 0
                          ? 'Select at least one boat first'
                          : undefined
                      }
                    >
                      <i className="fa fa-plus" aria-hidden="true" /> Add Boats
                    </button>
                  </form>
                </>
              )}
              {addSailorMode === 'bulk' && (
                <SailorImport
                  eventId={event.event_id}
                  onImportComplete={handleImportComplete}
                />
              )}
            </div>
          </div>
        )}

        {/* ── Sailors list ─── */}
        <div className="section-block">
          <SailorList
            sailors={Array.isArray(boats) ? boats : []}
            loading={boatsLoading}
            onRemoveBoat={handleRemoveBoat}
            canRemove={!raceHappened}
            onRefreshSailors={fetchBoatsWithSailors}
            headerActions={
              <div className="list-header-actions">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setExportOpen(true)}
                  disabled={!Array.isArray(boats) || boats.length === 0}
                  title={
                    !Array.isArray(boats) || boats.length === 0
                      ? 'Add boats to the event first'
                      : undefined
                  }
                >
                  Export starting list…
                </button>
              </div>
            }
          />
        </div>

        {/* Mounted only while open: each opening reads the entries as they are
            now and starts from the options remembered for this event. */}
        {exportOpen && (
          <StartingListExportDialog
            open
            onClose={() => setExportOpen(false)}
            event={event}
          />
        )}
      </main>
    </div>
  );
}

export default EventPage;
