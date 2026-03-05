/* eslint-disable camelcase */
import React, { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import HeatComponent from '../../components/HeatComponent';
import ScoringInputComponent from '../../components/ScoringInputComponent';
import './HeatRacePage.css';

function HeatRacePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { event } = location.state;
  const [eventData, setEventData] = useState(event || null);
  const [selectedHeat, setSelectedHeat] = useState(null);
  const [isScoring, setIsScoring] = useState(false);
  const [finalSeriesStarted, setFinalSeriesStarted] = useState(false);
  const [heats, setHeats] = useState([]);

  useEffect(() => {
    const fetchEvent = async () => {
      try {
        const fetchedEventData =
          await window.electron.sqlite.eventDB.readEventById(event.event_id);
        setEventData(fetchedEventData);
      } catch (error) {
        console.error(`Error fetching event: ${error.message}`);
      }
    };

    if (!eventData && event) {
      fetchEvent();
    }
  }, [eventData, event]);

  const handleHeatSelect = (heat) => {
    setSelectedHeat(heat);
  };

  const handleStartScoring = () => {
    setIsScoring(true);
  };

  const handleBackToHeats = () => {
    setIsScoring(false);
  };

  const doAllHeatsHaveSameNumberOfRaces = async (event_id) => {
    try {
      const results =
        await window.electron.sqlite.heatRaceDB.readAllHeats(event_id);

      // Find the latest heats by suffix
      const latestHeats = results.reduce((acc, heat) => {
        const match = heat.heat_name.match(/Heat ([A-Z]+)(\d*)/);
        if (match) {
          const [_, base, suffix] = match;
          const numericSuffix = suffix ? parseInt(suffix, 10) : 0;
          acc[base] = acc[base] || { suffix: -1, heat: null }; // Initialize suffix to -1 for heats without a number
          if (numericSuffix > acc[base].suffix) {
            acc[base] = { suffix: numericSuffix, heat };
          }
        }
        return acc;
      }, {});

      // Extract only the latest heats
      const lastHeats = Object.values(latestHeats).map((entry) => entry.heat);

      // Check race count for the latest heats
      const raceCounts = await Promise.all(
        lastHeats.map(async (heat) => {
          const races = await window.electron.sqlite.heatRaceDB.readAllRaces(
            heat.heat_id,
          );
          return races.length;
        }),
      );

      // Ensure all latest heats have the same number of races
      return raceCounts.every((count) => count === raceCounts[0]);
    } catch (error) {
      console.error(
        'Error checking if all heats have the same number of races:',
        error.message,
      );
      return false;
    }
  };

  const handleSubmitScores = async (placeNumbers) => {
    console.log('Submitted place numbers:', placeNumbers);

    // Fetch the current races for the selected heat
    const races = await window.electron.sqlite.heatRaceDB.readAllRaces(
      selectedHeat.heat_id,
    );
    const nextRaceNumber = races.length + 1;

    // Insert a new race for the selected heat
    const { lastInsertRowid: raceId } =
      await window.electron.sqlite.heatRaceDB.insertRace(
        selectedHeat.heat_id,
        nextRaceNumber,
      );

    // Insert scores for the new race
    const scorePromises = placeNumbers.map(
      async ({ boatNumber, place, status }) => {
        const boats = await window.electron.sqlite.heatRaceDB.readBoatsByHeat(
          selectedHeat.heat_id,
        );
        const boatDetails = boats.find(
          (boat) => boat.sail_number === boatNumber,
        );
        if (boatDetails) {
          await window.electron.sqlite.heatRaceDB.insertScore(
            raceId,
            boatDetails.boat_id,
            place,
            place,
            status,
          );
        }
      },
    );

    await Promise.all(scorePromises);

    console.log(
      `Scores for race ${nextRaceNumber} in heat ${selectedHeat.heat_name} have been submitted.`,
    );

    if (!finalSeriesStarted) {
      // Check if all heats have the same number of races before updating the local leaderboard
      const allHeatsEqual = await doAllHeatsHaveSameNumberOfRaces(
        event.event_id,
      );
      if (allHeatsEqual) {
        // Update the event leaderboard
        await window.electron.sqlite.heatRaceDB.updateEventLeaderboard(
          event.event_id,
        );
      } else {
        console.log(
          'Not all heats have the same number of races. Local leaderboard will not be updated.',
        );
      }
    } else {
      console.log('Final series has started. Leaderboard will be updated.');
      await window.electron.sqlite.heatRaceDB.updateFinalLeaderboard(
        event.event_id,
      );
    }

    setIsScoring(false);

    // Update the selected heat with the new race number
    setSelectedHeat({ ...selectedHeat, raceNumber: nextRaceNumber });
  };

  const handleCreateNewHeatsBasedOnLeaderboard = async () => {
    if (finalSeriesStarted) {
      alert(
        'Cannot create new heats based on leaderboard after the final series has started.',
      );
      return;
    }

    try {
      // Create new heats
      await window.electron.sqlite.heatRaceDB.createNewHeatsBasedOnLeaderboard(
        event.event_id,
      );
      console.log('New heats created based on leaderboard.');

      // Fetch and update heats
      const updatedHeats = await window.electron.sqlite.heatRaceDB.readAllHeats(
        event.event_id,
      );
      setHeats(updatedHeats); // Directly update the state with new heats
    } catch (error) {
      console.error(
        'Error creating new heats based on leaderboard:',
        error.message,
      );
    }
  };

  const handleUndoLastScoredRace = async () => {
    const confirmed = window.confirm(
      'Undo the last scored race in the latest qualifying heats?',
    );
    if (!confirmed) {
      return;
    }

    try {
      const result = await window.electron.sqlite.heatRaceDB.undoLastScoredRace(
        event.event_id,
      );
      const updatedHeats = await window.electron.sqlite.heatRaceDB.readAllHeats(
        event.event_id,
      );
      setHeats(updatedHeats);
      alert(
        `Last race undone successfully (Race ${result.raceNumber}). Removed ${result.removedScores} scores.`,
      );
    } catch (error) {
      console.error('Error undoing last scored race:', error);
      alert(error.message || 'Failed to undo the last scored race.');
    }
  };

  const handleUndoLatestHeatRedistribution = async () => {
    const confirmed = window.confirm(
      'Undo latest heat redistribution (delete latest qualifying heats and assignments)?',
    );
    if (!confirmed) {
      return;
    }

    try {
      const result =
        await window.electron.sqlite.heatRaceDB.undoLatestHeatRedistribution(
          event.event_id,
        );
      const updatedHeats = await window.electron.sqlite.heatRaceDB.readAllHeats(
        event.event_id,
      );
      setHeats(updatedHeats);
      alert(
        `Heat redistribution undone. Removed ${result.removedHeats} heats and ${result.removedAssignments} assignments.`,
      );
    } catch (error) {
      console.error('Error undoing latest heat redistribution:', error);
      alert(error.message || 'Failed to undo latest heat redistribution.');
    }
  };

  useEffect(() => {
    console.log('HeatComponent Props:', heats);
  }, [heats]);

  const checkFinalSeriesStarted = useCallback(async () => {
    try {
      const allHeats = await window.electron.sqlite.heatRaceDB.readAllHeats(
        event.event_id,
      );
      const finalHeats = allHeats.filter((heat) => heat.heat_type === 'Final');
      if (finalHeats.length > 0) {
        setFinalSeriesStarted(true);
      }
    } catch (error) {
      console.error('Error checking final series:', error);
    }
  }, [event.event_id]);

  useEffect(() => {
    checkFinalSeriesStarted();
  }, [checkFinalSeriesStarted]);

  return (
    <div>
      <button
        type="button"
        onClick={isScoring ? handleBackToHeats : () => navigate(-1)}
      >
        {isScoring ? 'Back to Heats' : 'Back'}
      </button>
      {!isScoring ? (
        <>
          <HeatComponent
            key={JSON.stringify(heats)} // Forces re-render when heats changes
            event={event}
            heats={heats}
            onHeatSelect={handleHeatSelect}
            clickable
          />
          {selectedHeat && (
            <button type="button" onClick={handleStartScoring}>
              Start Scoring
            </button>
          )}
          {!finalSeriesStarted && (
            <button
              type="button"
              onClick={handleCreateNewHeatsBasedOnLeaderboard}
              disabled={finalSeriesStarted}
            >
              Create New Heats Based on Leaderboard
            </button>
          )}
          {!finalSeriesStarted && (
            <button
              type="button"
              onClick={handleUndoLastScoredRace}
              disabled={finalSeriesStarted}
            >
              Undo Last Scored Race
            </button>
          )}
          {!finalSeriesStarted && (
            <button
              type="button"
              onClick={handleUndoLatestHeatRedistribution}
              disabled={finalSeriesStarted}
            >
              Undo Latest Heat Redistribution
            </button>
          )}
        </>
      ) : (
        <ScoringInputComponent
          heat={selectedHeat}
          onSubmit={handleSubmitScores}
          onBack={handleBackToHeats}
        />
      )}
    </div>
  );
}

export default HeatRacePage;
