import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useLayoutEffect,
} from 'react';
import Select from 'react-select';
import { useLocation, useNavigate } from 'react-router-dom';
import SailorForm from '../../components/SailorForm';
import SailorList from '../../components/SailorList';
import SailorImport from '../../components/SailorImport';
import Navbar from '../../components/Navbar';
import Breadcrumbs from '../../components/shared/Breadcrumbs';
import './EventPage.css';
import HeatComponent from '../../components/HeatComponent';
import printStartingList from '../../utils/printStartingList';
import {
  confirmAction,
  reportError,
  reportInfo,
} from '../../utils/userFeedback';

function EventPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { event } = location.state || {};

  useEffect(() => {
    if (!event) {
      navigate('/'); // Redirect to the landing page if event is not available
    }
  }, [event, navigate]);

  const [boats, setBoats] = useState([]);
  const [allBoats, setAllBoats] = useState([]);
  const [selectedBoats, setSelectedBoats] = useState([]);
  const [addSailorMode, setAddSailorMode] = useState(null); // null | 'bulk' | 'single'
  const tabPanelInnerRef = useRef(null);
  const [tabPanelHeight, setTabPanelHeight] = useState(0);

  useLayoutEffect(() => {
    if (tabPanelInnerRef.current) {
      setTabPanelHeight(tabPanelInnerRef.current.scrollHeight);
    }
  }, [addSailorMode]);
  const [raceHappened, setRaceHappened] = useState(false);
  const [isEventLocked, setIsEventLocked] = useState(event.is_locked === 1);
  const [startingListFormat, setStartingListFormat] = useState('excel');

  const fetchBoatsWithSailors = useCallback(async () => {
    try {
      const boatsWithSailors =
        await window.electron.sqlite.eventDB.readBoatsByEvent(event.event_id);
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
  }, [event.event_id]);

  const fetchAllBoats = useCallback(async () => {
    try {
      const fetchedBoats = await window.electron.sqlite.sailorDB.readAllBoats();
      setAllBoats(fetchedBoats);
    } catch (error) {
      reportError('Could not load all boats.', error);
    }
  }, []);

  const checkIfRaceHappened = useCallback(async () => {
    try {
      const heats = await window.electron.sqlite.heatRaceDB.readAllHeats(
        event.event_id,
      );
      const racePromises = heats.map((heat) =>
        window.electron.sqlite.heatRaceDB.readAllRaces(heat.heat_id),
      );
      const races = await Promise.all(racePromises);
      const anyRaceHappened = races.some((raceArray) => raceArray.length > 0);
      setRaceHappened(anyRaceHappened);
    } catch (error) {
      reportError('Could not check race status.', error);
    }
  }, [event.event_id]);

  const fetchEventLockStatus = useCallback(async () => {
    try {
      const events = await window.electron.sqlite.eventDB.readAllEvents();
      const currentEvent = events.find((e) => e.event_id === event.event_id);
      setIsEventLocked(currentEvent.is_locked === 1);
    } catch (error) {
      reportError('Could not load event lock status.', error);
    }
  }, [event.event_id]);

  useEffect(() => {
    if (event) {
      fetchBoatsWithSailors();
      fetchAllBoats();
      checkIfRaceHappened();
      fetchEventLockStatus();
    }
  }, [
    event,
    fetchBoatsWithSailors,
    fetchAllBoats,
    checkIfRaceHappened,
    fetchEventLockStatus,
  ]);

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

  const handleLockEvent = async () => {
    try {
      if (isEventLocked) {
        await window.electron.sqlite.eventDB.unlockEvent(event.event_id);
        setIsEventLocked(false);
        reportInfo('Event unlocked successfully!', 'Success');
      } else {
        await window.electron.sqlite.eventDB.lockEvent(event.event_id);
        setIsEventLocked(true);
        reportInfo('Event locked successfully!', 'Success');
      }
    } catch (error) {
      reportError('Could not change event lock status.', error);
    }
  };
  const handleLockEventClick = async () => {
    const userConfirmed = await confirmAction(
      isEventLocked
        ? 'Do you want to unlock this event?'
        : 'Do you want to lock this event?',
      isEventLocked ? 'Unlock Event' : 'Lock Event',
    );
    if (userConfirmed) {
      await handleLockEvent();
    }
  };
  useEffect(() => {
    // Ensure that the allBoats state is updated when boats state changes
    setAllBoats((prevBoats) => {
      const updatedBoats = prevBoats.filter(
        (boat) =>
          !boats.some((eventBoat) => eventBoat.boat_id === boat.boat_id),
      );
      return updatedBoats;
    });
  }, [boats]);

  if (!event) {
    return null; // Render nothing if event is not available
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
        onBack={() => navigate('/')}
        backLabel="Back"
        onOpenLeaderboard={handleOpenLeaderboard}
        isEventLocked={isEventLocked}
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
              <i
                className="fa fa-calendar"
                aria-hidden="true"
                style={{ marginRight: '10px', color: '#2471A3' }}
              />
              {event.event_name}
            </h1>
            <p>
              <i
                className="fa fa-calendar-o"
                aria-hidden="true"
                style={{ marginRight: '6px' }}
              />
              {event.start_date} &rarr; {event.end_date}
              {isEventLocked && (
                <span
                  style={{
                    marginLeft: '14px',
                    background: 'linear-gradient(135deg,#D63B2F,#B02720)',
                    color: '#fff',
                    borderRadius: '999px',
                    padding: '3px 12px',
                    fontSize: '.88rem',
                    fontWeight: 700,
                    letterSpacing: '.05em',
                    textTransform: 'uppercase',
                    boxShadow: '0 2px 6px rgba(214,59,47,.35)',
                  }}
                >
                  <i className="fa fa-lock" aria-hidden="true" /> Locked
                </span>
              )}
            </p>
          </div>
        </div>

        {/* ── Warning banner ─── */}
        {(raceHappened || isEventLocked) && (
          <div className="warning">
            <i
              className="fa fa-exclamation-triangle"
              aria-hidden="true"
              style={{ marginRight: '8px' }}
            />
            No more sailors or boats can be added — a race has already happened
            or the event is locked.
          </div>
        )}

        {/* ── Add sailors / boats section ─── */}
        {!raceHappened && !isEventLocked && (
          <div className="section-block">
            <h2>
              <i className="fa fa-user-plus" aria-hidden="true" />
              Add Sailors
            </h2>

            {/* Sliding pill tab toggle — left aligned, collapsible */}
            <div className="tab-toggle">
              {/* sliding pill tracks active tab */}
              <div
                className="tab-pill"
                style={{
                  transform:
                    addSailorMode === 'single'
                      ? 'translateX(100%)'
                      : 'translateX(0)',
                  opacity: addSailorMode ? 1 : 0,
                }}
              />
              <button
                type="button"
                className={`tab-btn${addSailorMode === 'bulk' ? ' tab-active' : ''}`}
                onClick={() =>
                  setAddSailorMode(addSailorMode === 'bulk' ? null : 'bulk')
                }
              >
                <i className="fa fa-table" aria-hidden="true" /> Bulk CSV
              </button>
              <button
                type="button"
                className={`tab-btn${addSailorMode === 'single' ? ' tab-active' : ''}`}
                onClick={() =>
                  setAddSailorMode(addSailorMode === 'single' ? null : 'single')
                }
              >
                <i className="fa fa-user-plus" aria-hidden="true" /> Single
              </button>
            </div>

            {/* Height-animated outer wrapper, content fades inside */}
            <div
              style={{
                height: addSailorMode ? tabPanelHeight : 0,
                overflow: 'hidden',
                transition: 'height 0.32s cubic-bezier(.4,0,.2,1)',
              }}
            >
              <div ref={tabPanelInnerRef} className="tab-panel">
                {(() => {
                  if (addSailorMode === 'single') {
                    return (
                      <SailorForm
                        onAddSailor={handleAddSailor}
                        eventId={event.event_id}
                      />
                    );
                  }
                  if (addSailorMode === 'bulk') {
                    return (
                      <SailorImport
                        eventId={event.event_id}
                        onImportComplete={handleImportComplete}
                      />
                    );
                  }
                  return null;
                })()}
              </div>
            </div>

            <h2 style={{ marginTop: '24px' }}>
              <i
                className="fa fa-ship"
                aria-hidden="true"
                style={{ marginRight: '8px' }}
              />
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
              <button type="submit" className="btn-success">
                <i className="fa fa-plus" aria-hidden="true" /> Add Boats
              </button>
            </form>
          </div>
        )}

        {/* ── Sailors list ─── */}
        <div className="section-block">
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-start',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '12px',
            }}
          >
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
          <SailorList
            sailors={Array.isArray(boats) ? boats : []}
            onRemoveBoat={handleRemoveBoat}
            onRefreshSailors={fetchBoatsWithSailors}
            raceHappened={raceHappened}
          />
        </div>

        {/* ── Heat overview ─── */}
        <HeatComponent event={event} clickable={false} />

        {/* ── Lock / Unlock ─── */}
        <div className="lock-btn">
          <button
            type="button"
            className={isEventLocked ? 'btn-success' : 'btn-danger'}
            onClick={handleLockEventClick}
          >
            <i
              className={`fa ${isEventLocked ? 'fa-unlock' : 'fa-lock'}`}
              aria-hidden="true"
            />
            {isEventLocked ? 'Unlock Event' : 'Lock Event'}
          </button>
        </div>
      </main>
    </div>
  );
}

export default EventPage;
