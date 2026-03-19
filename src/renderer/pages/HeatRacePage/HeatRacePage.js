/* eslint-disable camelcase */
import React, { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import HeatComponent from '../../components/HeatComponent';
import ScoringInputComponent from '../../components/ScoringInputComponent';
import Navbar from '../../components/Navbar';
import './HeatRacePage.css';
import {
  confirmAction,
  reportError,
  reportInfo,
} from '../../utils/userFeedback';

function HeatRacePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { event } = location.state;
  const [eventData, setEventData] = useState(event || null);
  const [selectedHeat, setSelectedHeat] = useState(null);
  const [isScoring, setIsScoring] = useState(false);
  const [finalSeriesStarted, setFinalSeriesStarted] = useState(false);
  const [heats, setHeats] = useState([]);
  const [numQualifyingGroups, setNumQualifyingGroups] = useState(0);

  useEffect(() => {
    const fetchEvent = async () => {
      try {
        const fetchedEventData =
          await window.electron.sqlite.eventDB.readEventById(event.event_id);
        setEventData(fetchedEventData);
      } catch (error) {
        reportError('Could not load event details.', error);
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
          const [, base, suffix] = match;
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
      reportError('Could not validate race counts across heats.', error);
      return false;
    }
  };

  const handleSubmitScores = async (placeNumbers) => {
    try {
      const races = await window.electron.sqlite.heatRaceDB.readAllRaces(
        selectedHeat.heat_id,
      );
      const nextRaceNumber = races.length + 1;

      // SHRS 3.2 warning: in a multi-heat qualifying series each heat group
      // should only ever race once before redistribution. Warn any time the
      // user tries to score a second (or later) race on a qualifying heat.
      if (
        !finalSeriesStarted &&
        numQualifyingGroups >= 2 &&
        races.length >= 1
      ) {
        const proceed = confirmAction(
          `Warning: "${selectedHeat.heat_name}" has already completed Race ${races.length}.\n\n` +
            `According to SHRS 3.2 boats should be redistributed before racing again.\n\n` +
            `Press OK to score Race ${nextRaceNumber} anyway, or Cancel to go back and use "Create New Heats from Leaderboard" first.`,
          'Scoring warning',
        );
        if (!proceed) return;
      }

      // SHRS 5.2: penalty score = number of boats in the largest heat + 1
      const heatType = finalSeriesStarted ? 'Final' : 'Qualifying';
      const maxHeatSize =
        await window.electron.sqlite.heatRaceDB.getMaxHeatSize(
          event.event_id,
          heatType,
        );
      const penaltyPlace = (maxHeatSize || placeNumbers.length) + 1;

      const { lastInsertRowid: raceId } =
        await window.electron.sqlite.heatRaceDB.insertRace(
          selectedHeat.heat_id,
          nextRaceNumber,
        );

      const scorePromises = placeNumbers.map(
        async ({ boatNumber, place, status }) => {
          const boats = await window.electron.sqlite.heatRaceDB.readBoatsByHeat(
            selectedHeat.heat_id,
          );
          const boatDetails = boats.find(
            (boat) => boat.sail_number === boatNumber,
          );
          if (boatDetails) {
            // For penalties, use SHRS 5.2 largest-heat-based place
            const finalPlace = status !== 'FINISHED' ? penaltyPlace : place;
            await window.electron.sqlite.heatRaceDB.insertScore(
              raceId,
              boatDetails.boat_id,
              finalPlace,
              finalPlace,
              status,
            );
          }
        },
      );

      await Promise.all(scorePromises);

      if (!finalSeriesStarted) {
        const allHeatsEqual = await doAllHeatsHaveSameNumberOfRaces(
          event.event_id,
        );
        if (allHeatsEqual) {
          await window.electron.sqlite.heatRaceDB.updateEventLeaderboard(
            event.event_id,
          );
        }
      } else {
        await window.electron.sqlite.heatRaceDB.updateFinalLeaderboard(
          event.event_id,
        );
      }

      setIsScoring(false);
      setSelectedHeat({ ...selectedHeat, raceNumber: nextRaceNumber });
    } catch (error) {
      reportError('Could not save race scores.', error);
    }
  };

  const handleCreateNewHeatsBasedOnLeaderboard = async () => {
    if (finalSeriesStarted) {
      reportInfo(
        'Cannot create new heats based on leaderboard after the final series has started.',
        'Action blocked',
      );
      return;
    }

    const confirmed = confirmAction(
      'Create new heats based on the current leaderboard?\n\nAll heats in the current round must have the same number of races.',
      'Create New Heats',
    );
    if (!confirmed) return;

    try {
      await window.electron.sqlite.heatRaceDB.createNewHeatsBasedOnLeaderboard(
        event.event_id,
      );
      const updatedHeats = await window.electron.sqlite.heatRaceDB.readAllHeats(
        event.event_id,
      );
      setHeats(updatedHeats);
    } catch (error) {
      reportError('Could not create new heats from leaderboard.', error);
    }
  };

  const handleUndoLastScoredRace = async () => {
    if (!selectedHeat) {
      reportInfo(
        'Please select a heat first by clicking on it, then click Undo Last Race.',
        'No heat selected',
      );
      return;
    }

    const confirmed = confirmAction(
      `Undo the last scored race in "${selectedHeat.heat_name}"?\n\nThis will permanently delete that race's scores.`,
      'Undo Last Race',
    );
    if (!confirmed) return;

    try {
      const result =
        await window.electron.sqlite.heatRaceDB.undoLastScoredRaceForHeat(
          selectedHeat.heat_id,
        );
      const updatedHeats = await window.electron.sqlite.heatRaceDB.readAllHeats(
        event.event_id,
      );
      setHeats(updatedHeats);
      reportInfo(
        `Race ${result.raceNumber} in "${result.heatName}" has been undone.\n${result.removedScores} score(s) removed.`,
        'Success',
      );
    } catch (error) {
      reportError('Could not undo last race for selected heat.', error);
    }
  };

  const handleUndoLatestHeatRedistribution = async () => {
    const confirmed = confirmAction(
      'Undo latest heat redistribution?\n\nThis will delete the latest qualifying heats and all their boat assignments. This cannot be undone.',
      'Undo Heat Redistribution',
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
      reportInfo(
        `Heat redistribution undone. Removed ${result.removedHeats} heats and ${result.removedAssignments} assignments.`,
        'Success',
      );
    } catch (error) {
      reportError('Could not undo latest heat redistribution.', error);
    }
  };

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
      reportError('Could not check final series status.', error);
    }
  }, [event.event_id]);

  useEffect(() => {
    checkFinalSeriesStarted();
  }, [checkFinalSeriesStarted]);

  const undoButtonTitle = (() => {
    if (!selectedHeat) {
      return 'Select a heat first';
    }
    if (selectedHeat.raceNumber) {
      return `Delete Race ${selectedHeat.raceNumber} in ${selectedHeat.heat_name}`;
    }
    return `${selectedHeat.heat_name} has no races to undo`;
  })();

  const undoButtonSuffix = (() => {
    if (!selectedHeat) {
      return '';
    }
    if (selectedHeat.raceNumber) {
      return ` — ${selectedHeat.heat_name}, Race ${selectedHeat.raceNumber}`;
    }
    return ` — ${selectedHeat.heat_name} (no races)`;
  })();

  return (
    <div>
      <Navbar
        onBack={isScoring ? handleBackToHeats : () => navigate(-1)}
        backLabel={isScoring ? 'Back to Heats' : 'Back to Event'}
      />

      <div className="page-wrapper">
        {!isScoring ? (
          <>
            <h1 style={{ marginBottom: '20px' }}>
              <i
                className="fa fa-flag-checkered"
                aria-hidden="true"
                style={{ marginRight: '10px', color: '#2471A3' }}
              />
              {eventData?.event_name || 'Race Scoring'}
            </h1>

            {/* ── Management actions ─── */}
            {!finalSeriesStarted && (
              <div className="heatrace-actions">
                {/* SHRS 1.1: redistribution (sections 2-4) only applies when there are 2+ heats */}
                {numQualifyingGroups >= 2 && (
                  <button
                    type="button"
                    onClick={handleCreateNewHeatsBasedOnLeaderboard}
                  >
                    Create New Heats from Leaderboard
                  </button>
                )}
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleUndoLastScoredRace}
                  disabled={!selectedHeat || !selectedHeat.raceNumber}
                  title={undoButtonTitle}
                >
                  Undo Last Race
                  {undoButtonSuffix}
                </button>
                {numQualifyingGroups >= 2 && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleUndoLatestHeatRedistribution}
                  >
                    Undo Heat Redistribution
                  </button>
                )}
              </div>
            )}

            {!selectedHeat && (
              <div className="info-banner">
                <i
                  className="fa fa-info-circle"
                  aria-hidden="true"
                  style={{ marginRight: '8px' }}
                />
                Click on a heat below to select it — a{' '}
                <strong>Start Scoring</strong> button will appear inside the
                card.
              </div>
            )}

            <HeatComponent
              key={JSON.stringify(heats)}
              event={event}
              heats={heats}
              onHeatSelect={handleHeatSelect}
              onStartScoring={handleStartScoring}
              onQualifyingGroupCountChange={setNumQualifyingGroups}
              clickable
            />
          </>
        ) : (
          <ScoringInputComponent
            heat={selectedHeat}
            onSubmit={handleSubmitScores}
            onBack={handleBackToHeats}
          />
        )}
      </div>
    </div>
  );
}

export default HeatRacePage;
