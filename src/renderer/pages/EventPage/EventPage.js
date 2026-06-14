import React, { useState, useEffect, useCallback } from 'react';
import Select from 'react-select';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import SailorForm from '../../components/SailorForm';
import SailorList from '../../components/SailorList';
import SailorImport from '../../components/SailorImport';
import Navbar from '../../components/Navbar';
import Breadcrumbs from '../../components/shared/Breadcrumbs';
import './EventPage.css';
import HeatComponent from '../../components/HeatComponent';
import printStartingList from '../../utils/printStartingList';
import { reportError, reportInfo } from '../../utils/userFeedback';

function EventPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { name } = useParams();
  const [event, setEvent] = useState(location.state?.event || null);
  const eventId = event?.event_id;

  // Refresh-safe: when opened without router state (e.g. after a reload),
  // resolve the event from the URL instead of bouncing to the landing page.
  useEffect(() => {
    if (event) return undefined;
    let isActive = true;

    const findEventByName = async () => {
      try {
        const events = await window.electron.sqlite.eventDB.readAllEvents();
        if (!isActive) return;
        const match = (events || []).find((e) => e.event_name === name);
        if (match) {
          setEvent(match);
        } else {
          navigate('/');
        }
      } catch (error) {
        if (!isActive) return;
        reportError('Could not load event details.', error);
        navigate('/');
      }
    };

    findEventByName();
    return () => {
      isActive = false;
    };
  }, [event, name, navigate]);

  const [boats, setBoats] = useState([]);
  const [allBoats, setAllBoats] = useState([]);
  const [selectedBoats, setSelectedBoats] = useState([]);
  const [addSailorMode, setAddSailorMode] = useState('single');
  const [raceHappened, setRaceHappened] = useState(false);
  const [startingListFormat, setStartingListFormat] = useState('excel');

  const fetchBoatsWithSailors = useCallback(async () => {
    if (!eventId) return;

    try {
      const boatsWithSailors =
        await window.electron.sqlite.eventDB.readBoatsByEvent(eventId);
      const mappedBoats = boatsWithSailors.map((boat) => ({
        ...boat,
        sailor: boat.name,
        club: boat.club_name, // Map club_name to club
        country: boat.boat_country, // Map country_name to country
        category: boat.category_name, // Map category_name to category
      }));
      setBoats(mappedBoats);
    } catch (error) {
      reportError('Could not load boats for this event.', error);
    }
  }, [eventId]);

  const fetchAllBoats = useCallback(async () => {
    try {
      const fetchedBoats = await window.electron.sqlite.sailorDB.readAllBoats();
      setAllBoats(fetchedBoats);
    } catch (error) {
      reportError('Could not load all boats.', error);
    }
  }, []);

  const checkIfRaceHappened = useCallback(async () => {
    if (!eventId) return;

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
    if (event) {
      fetchBoatsWithSailors();
      fetchAllBoats();
      checkIfRaceHappened();
    }
  }, [event, fetchBoatsWithSailors, fetchAllBoats, checkIfRaceHappened]);

  const handleAddSailor = () => {
    fetchBoatsWithSailors();
  };

  const handleImportComplete = useCallback(() => {
    fetchBoatsWithSailors();
    fetchAllBoats();
  }, [fetchBoatsWithSailors, fetchAllBoats]);

  const handleHeatRaceClick = () => {
    navigate(`/event/${event.event_name}/heat-race`, { state: { event } });
  };

  const handleBoatSelection = async (e) => {
    e.preventDefault();

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
          window.electron.sqlite.eventDB.associateBoatWithEvent(
            boatId,
            event.event_id,
          ),
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

  const handleBoatChange = (selectedOptions) => {
    setSelectedBoats(selectedOptions);
  };

  const handleOpenLeaderboard = () => {
    navigate(`/event/${event.event_name}/leaderboard`, { state: { event } });
  };

  const handlePrintStartingList = async () => {
    try {
      const boatsForEvent =
        await window.electron.sqlite.eventDB.readBoatsByEvent(event.event_id);
      await printStartingList(
        event,
        Array.isArray(boatsForEvent) ? boatsForEvent : [],
        startingListFormat,
      );
    } catch (error) {
      reportError('Could not export starting list.', error);
    }
  };

  const handleRemoveBoat = async (boatId) => {
    try {
      await window.electron.sqlite.eventDB.removeBoatFromEvent(
        boatId,
        event.event_id,
      );

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
    } catch (error) {
      reportError('Could not remove boat from the event.', error);
    }
  };

  if (!event) {
    return null; // Render nothing while the event is being resolved
  }

  const availableBoats = allBoats.filter(
    (boat) => !boats.some((eventBoat) => eventBoat.boat_id === boat.boat_id),
  );

  const boatOptions = availableBoats.map((boat) => ({
    value: boat.boat_id,
    label: `${boat.boat_country} ${boat.sail_number} - ${boat.model} (Sailor: ${boat.name} ${boat.surname})`,
  }));

  return (
    <div>
      <Navbar
        onOpenLeaderboard={handleOpenLeaderboard}
        onHeatRaceClick={handleHeatRaceClick}
      />

      <main id="main-content" className="page-wrapper" tabIndex={-1}>
        <Breadcrumbs
          items={[
            { label: 'Home', onClick: () => navigate('/') },
            { label: event.event_name },
          ]}
        />
        {/* ── Event header ─── */}
        <div className="event-header">
          <div className="event-header-info">
            <h1>
              <i className="fa fa-calendar" aria-hidden="true" />
              {event.event_name}
            </h1>
            <p>
              {event.start_date} &rarr; {event.end_date}
            </p>
          </div>
        </div>

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
          <>
            {/* ── Add sailors ─── */}
            <div className="section-block">
              <h2>
                <i className="fa fa-user-plus" aria-hidden="true" />
                Add Sailors
              </h2>

              {/* Sliding pill tab toggle — one tab is always open */}
              <div className="tab-toggle">
                <div
                  className="tab-pill"
                  style={{
                    transform:
                      addSailorMode === 'bulk'
                        ? 'translateX(100%)'
                        : 'translateX(0)',
                  }}
                />
                <button
                  type="button"
                  className={`tab-btn${addSailorMode === 'single' ? ' tab-active' : ''}`}
                  onClick={() => setAddSailorMode('single')}
                >
                  <i className="fa fa-user-plus" aria-hidden="true" /> Single
                </button>
                <button
                  type="button"
                  className={`tab-btn${addSailorMode === 'bulk' ? ' tab-active' : ''}`}
                  onClick={() => setAddSailorMode('bulk')}
                >
                  <i className="fa fa-table" aria-hidden="true" /> Bulk CSV
                </button>
              </div>

              <div className="tab-panel" key={addSailorMode}>
                {addSailorMode === 'single' ? (
                  <SailorForm
                    onAddSailor={handleAddSailor}
                    eventId={event.event_id}
                  />
                ) : (
                  <SailorImport
                    eventId={event.event_id}
                    onImportComplete={handleImportComplete}
                  />
                )}
              </div>
            </div>

            {/* ── Add existing boat ─── */}
            <div className="section-block">
              <h2>
                <i className="fa fa-ship" aria-hidden="true" />
                Add Existing Boat to Event
              </h2>
              <form onSubmit={handleBoatSelection} className="add-boat-form">
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
            </div>
          </>
        )}

        {/* ── Sailors list ─── */}
        <div className="section-block">
          <SailorList
            sailors={Array.isArray(boats) ? boats : []}
            onRemoveBoat={handleRemoveBoat}
            onRefreshSailors={fetchBoatsWithSailors}
            headerActions={
              <div className="list-header-actions">
                <select
                  className="compact-select"
                  aria-label="Starting list format"
                  value={startingListFormat}
                  onChange={(e) => setStartingListFormat(e.target.value)}
                >
                  <option value="excel">Excel</option>
                  <option value="pdf">PDF</option>
                  <option value="html">HTML</option>
                </select>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={handlePrintStartingList}
                  disabled={!Array.isArray(boats) || boats.length === 0}
                >
                  Print Starting List
                </button>
              </div>
            }
          />
        </div>

        {/* ── Heat overview ─── */}
        <HeatComponent event={event} clickable={false} />
      </main>
    </div>
  );
}

export default EventPage;
