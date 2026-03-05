import React, { useState, useEffect, useCallback } from 'react';
import Select from 'react-select';
import { useLocation, useNavigate } from 'react-router-dom';
import SailorForm from '../../components/SailorForm';
import SailorList from '../../components/SailorList';
import Navbar from '../../components/Navbar';
import './EventPage.css';
import HeatComponent from '../../components/HeatComponent';
import LeaderboardComponent from '../../components/Leaderboard';

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
  const [isSailorFormVisible, setIsSailorFormVisible] = useState(false);
  const [raceHappened, setRaceHappened] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
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

  const handleBackClick = () => {
    navigate('/');
  };

  const handleHeatRaceClick = () => {
    navigate(`/event/${event.event_name}/heat-race`, { state: { event } });
  };

  const toggleSailorFormVisibility = () => {
    if (raceHappened) {
      alert('No more sailors can be added as a race has already happened.');
      return;
    }
    setIsSailorFormVisible(!isSailorFormVisible);
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
    setShowLeaderboard(true);
  };

  const handleCloseLeaderboard = () => {
    setShowLeaderboard(false);
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

  if (showLeaderboard) {
    return (
      <div>
        <button type="button" onClick={handleCloseLeaderboard}>
          Back
        </button>
        <LeaderboardComponent eventId={event.event_id} />
      </div>
    );
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
        isEventLocked={isEventLocked}
        onHeatRaceClick={handleHeatRaceClick}
      />
      <h1>{event.event_name}</h1>
      <p>Start Date: {event.start_date}</p>
      <p>End Date: {event.end_date}</p>
      {raceHappened || isEventLocked ? (
        <div className="warning">
          <p>
            No more sailors or boats can be added as at least one race has
            happened or the event is locked.
          </p>
        </div>
      ) : (
        <>
          <h2>Add Sailors</h2>
          <button type="button" onClick={toggleSailorFormVisibility}>
            {isSailorFormVisible ? 'Hide Sailor Form' : 'Show Sailor Form'}
          </button>
          {isSailorFormVisible && (
            <SailorForm
              onAddSailor={handleAddSailor}
              eventId={event.event_id}
            />
          )}
          <h2>Add Existing Boat to Event</h2>
          <form onSubmit={handleBoatSelection}>
            <Select
              isMulti
              value={selectedBoats}
              onChange={handleBoatChange}
              options={boatOptions}
              closeMenuOnSelect={false}
            />
            <button type="submit">Add Boats</button>
          </form>
        </>
      )}

      <h3>Boats and Sailors</h3>
      <SailorList
        sailors={Array.isArray(boats) ? boats : []}
        onRemoveBoat={handleRemoveBoat}
        onRefreshSailors={fetchBoatsWithSailors}
        raceHappened={raceHappened} // Pass raceHappened state to SailorList
      />
      <HeatComponent event={event} clickable={false} />
      <button
        type="button"
        onClick={handleLockEventClick}
        style={{ backgroundColor: 'red', color: 'white' }}
      >
        {isEventLocked ? 'Unlock Event' : 'Lock Event'}
      </button>
    </div>
  );
}

export default EventPage;
