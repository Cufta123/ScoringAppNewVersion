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
import './EventPage.css';
import HeatComponent from '../../components/HeatComponent';

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

  const fetchBoatsWithSailors = useCallback(async () => {
    try {
      const boatsWithSailors =
        await window.electron.sqlite.eventDB.readBoatsByEvent(event.event_id);
      console.log('Fetched boats with sailors:', boatsWithSailors);
      const mappedBoats = boatsWithSailors.map((boat) => ({
        ...boat,
        sailor: boat.name,
        club: boat.club_name, // Map club_name to club
        country: boat.boat_country, // Map country_name to country
        category: boat.category_name, // Map category_name to category
      }));
      setBoats(mappedBoats);
    } catch (error) {
      alert('Error fetching boats with sailors. Please try again later.');
    }
  }, [event.event_id]);

  const fetchAllBoats = useCallback(async () => {
    try {
      const fetchedBoats = await window.electron.sqlite.sailorDB.readAllBoats();
      setAllBoats(fetchedBoats);
    } catch (error) {
      console.error('Error fetching all boats:', error);
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
      console.error('Error checking if race happened:', error);
    }
  }, [event.event_id]);

  const fetchEventLockStatus = useCallback(async () => {
    try {
      const events = await window.electron.sqlite.eventDB.readAllEvents();
      const currentEvent = events.find((e) => e.event_id === event.event_id);
      setIsEventLocked(currentEvent.is_locked === 1);
    } catch (error) {
      console.error('Error fetching event lock status:', error);
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

  const handleBackClick = () => {
    navigate('/');
  };

  const handleHeatRaceClick = () => {
    navigate(`/event/${event.event_name}/heat-race`, { state: { event } });
  };

  const handleBoatSelection = async (e) => {
    e.preventDefault();

    if (raceHappened) {
      alert('No more boats can be added as a race has already happened.');
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
      console.error('Error associating boats with event:', error);
    }
  };

  const handleBoatChange = (selectedOptions) => {
    setSelectedBoats(selectedOptions);
  };

  const handleOpenLeaderboard = () => {
    navigate(`/event/${event.event_name}/leaderboard`, { state: { event } });
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
      console.error('Error removing boat from event:', error);
    }
  };

  const handleLockEvent = async () => {
    try {
      if (isEventLocked) {
        await window.electron.sqlite.eventDB.unlockEvent(event.event_id);
        setIsEventLocked(false);
        alert('Event unlocked successfully!');
      } else {
        await window.electron.sqlite.eventDB.lockEvent(event.event_id);
        setIsEventLocked(true);
        alert('Event locked successfully!');
      }
    } catch (error) {
      console.error('Error locking/unlocking event:', error);
      alert('Error locking/unlocking event. Please try again later.');
    }
  };
  const handleLockEventClick = () => {
    const userConfirmed = window.confirm('Do you want to lock the event?');
    if (userConfirmed) {
      handleLockEvent();
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

      <div className="page-wrapper">
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
                    fontSize: '.78rem',
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
                {addSailorMode === 'single' ? (
                  <SailorForm
                    onAddSailor={handleAddSailor}
                    eventId={event.event_id}
                  />
                ) : addSailorMode === 'bulk' ? (
                  <SailorImport
                    eventId={event.event_id}
                    onImportComplete={handleImportComplete}
                  />
                ) : null}
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
      </div>
    </div>
  );
}

export default EventPage;
