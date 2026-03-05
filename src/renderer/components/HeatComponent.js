import React, { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import Flag from 'react-world-flags';
import iocToFlagCodeMap from '../constants/iocToFlagCodeMap';

function HeatComponent({ event, onHeatSelect = () => {}, clickable }) {
  const [heats, setHeats] = useState([]);
  const [numHeats, setNumHeats] = useState(5); // Default number of heats
  const [selectedHeatId, setSelectedHeatId] = useState(null);
  const [heatsCreated, setHeatsCreated] = useState(false);
  const [raceHappened, setRaceHappened] = useState(false);
  const [displayLastHeats, setDisplayLastHeats] = useState(true);
  const [finalSeriesStarted, setFinalSeriesStarted] = useState(false);
  const [showFinalConfirm, setShowFinalConfirm] = useState(false);
  const [pendingFinalHeats, setPendingFinalHeats] = useState(0);

  const handleDisplayHeats = useCallback(async () => {
    try {
      const heatsToDisplay =
        await window.electron.sqlite.heatRaceDB.readAllHeats(event.event_id);
      const heatDetailsPromises = heatsToDisplay.map(async (heat) => {
        const boatsInHeat =
          await window.electron.sqlite.heatRaceDB.readBoatsByHeat(heat.heat_id);
        const races = await window.electron.sqlite.heatRaceDB.readAllRaces(
          heat.heat_id,
        );
        return {
          ...heat,
          boats: boatsInHeat,
          raceNumber: races.length,
        };
      });

      const heatDetails = await Promise.all(heatDetailsPromises);
      setHeats(heatDetails);
      setHeatsCreated(heatDetails.length > 0);

      // Check if any race has happened
      const anyRaceHappened = heatDetails.some((heat) => heat.raceNumber > 0);
      setRaceHappened(anyRaceHappened);
    } catch (error) {
      // Handle error appropriately
      setHeats([]);
      setHeatsCreated(false);
    }
  }, [event.event_id]);

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

  const handleConfirmFinalSeries = async () => {
    setShowFinalConfirm(false);
    const numFinalHeats = pendingFinalHeats;
    try {
      // Fetch leaderboard to rank boats
      const leaderboard =
        await window.electron.sqlite.heatRaceDB.readLeaderboard(event.event_id);

      // Build adjusted totals for fleet assignment per SHRS 4.2.
      // The leaderboard already has total_points_event (SHRS 5.4: worst excluded for n>=4)
      // and race_positions (comma-separated raw positions/points per race).
      // SHRS 4.2: when 5 < n < 8 completed races, additionally temporarily exclude
      // the second-worst score solely for purposes of assigning boats to fleets.
      const adjustedLeaderboard = leaderboard.map((boat) => {
        const racePosStr = boat.race_positions || '';
        const rawScores = racePosStr
          ? racePosStr.split(',').map(Number).filter((n) => !Number.isNaN(n))
          : [];
        const n = rawScores.length;
        // Start from the SHRS-5.4-adjusted total (worst already excluded for n>=4)
        let totalPoints = boat.total_points_event || 0;
        // SHRS 4.2: additionally exclude second-worst when 5 < n < 8
        if (n > 5 && n < 8) {
          const sorted = [...rawScores].sort((a, b) => b - a);
          if (sorted.length > 1) totalPoints -= sorted[1];
        }
        return { boat_id: boat.boat_id, totalPoints };
      });

      // Sort boats by adjusted total points
      adjustedLeaderboard.sort((a, b) => a.totalPoints - b.totalPoints);
      // Determine fleet sizes
      const boatsPerFleet = Math.floor(
        adjustedLeaderboard.length / numFinalHeats,
      );
      const extraBoats = adjustedLeaderboard.length % numFinalHeats;

      const fleetNames = ['Gold', 'Silver', 'Bronze', 'Copper'];
      const fleetPromises = [];

      let boatIndex = 0;
      for (let i = 0; i < numFinalHeats; i += 1) {
        const fleetName = fleetNames[i] || `Fleet ${i + 1}`;
        const heatName = `Heat ${fleetName}`;
        const heatType = 'Final';

        // Insert new heat for the final series
        const { lastInsertRowid: newHeatId } =
          await window.electron.sqlite.heatRaceDB.insertHeat(
            event.event_id,
            heatName,
            heatType,
          );

        const boatsInThisFleet = boatsPerFleet + (i < extraBoats ? 1 : 0);
        for (let j = 0; j < boatsInThisFleet; j += 1) {
          fleetPromises.push(
            window.electron.sqlite.heatRaceDB.insertHeatBoat(
              newHeatId,
              adjustedLeaderboard[boatIndex].boat_id,
            ),
          );
          boatIndex += 1;
        }
      }

      await Promise.all(fleetPromises);
      setFinalSeriesStarted(true);
      alert('Final Series started successfully!');
      handleDisplayHeats();
    } catch (error) {
      console.error('Error starting final series:', error);
      alert('Error starting final series. Please try again later.');
    }
  };

  const handleStartFinalSeries = async () => {
    if (finalSeriesStarted) return;
    try {
      const allHeats = await window.electron.sqlite.heatRaceDB.readAllHeats(
        event.event_id,
      );
      const qualifyingHeats = allHeats.filter(
        (heat) => heat.heat_type === 'Qualifying',
      );
      const uniqueGroups = new Set(
        qualifyingHeats
          .map((heat) => {
            const m = heat.heat_name.match(/Heat ([A-Z])/);
            return m ? m[1] : null;
          })
          .filter(Boolean),
      );
      const numFinalHeats = uniqueGroups.size;
      if (numFinalHeats < 2) {
        alert(
          numFinalHeats === 0
            ? 'No qualifying heats found. Please create and run at least 2 heats before starting the Final Series.'
            : 'At least 2 qualifying heats are required before starting the Final Series.',
        );
        return;
      }
      setPendingFinalHeats(numFinalHeats);
      setShowFinalConfirm(true);
    } catch (error) {
      console.error('Error checking heats for final series:', error);
      alert('Error checking heats. Please try again.');
    }
  };

  const handleCreateHeats = async () => {
    if (raceHappened || finalSeriesStarted) {
      alert('Cannot create heats after a race has happened.');
      return;
    }

    try {
      const eventBoats = await window.electron.sqlite.eventDB.readBoatsByEvent(
        event.event_id,
      );
      const existingHeats =
        await window.electron.sqlite.heatRaceDB.readAllHeats(event.event_id);

      if (existingHeats.length > 0) {
        alert('Heats already exist for this event.');
        setHeatsCreated(true);
        return;
      }

      eventBoats.sort((a, b) => {
        if (a.country < b.country) return -1;
        if (a.country > b.country) return 1;
        return a.sail_number - b.sail_number;
      });

      const heatPromises = [];
      for (let i = 0; i < numHeats; i += 1) {
        const heatName = `Heat ${String.fromCharCode(65 + i)}1`;
        const heatType = 'Qualifying';
        heatPromises.push(
          window.electron.sqlite.heatRaceDB.insertHeat(
            event.event_id,
            heatName,
            heatType,
          ),
        );
      }
      await Promise.all(heatPromises);

      const FetchedHeats = await window.electron.sqlite.heatRaceDB.readAllHeats(
        event.event_id,
      );

      // Calculate the number of boats per heat
      const boatsPerHeat = Math.floor(eventBoats.length / numHeats);
      const extraBoats = eventBoats.length % numHeats;

      const heatBoatPromises = [];
      let boatIndex = 0;

      // Assign boats to heats in A, B, C, D, A, B, C, D... pattern
      for (let i = 0; i < eventBoats.length - extraBoats; i += 1) {
        const heatIndex = i % numHeats;
        const heat = FetchedHeats[heatIndex];
        heatBoatPromises.push(
          window.electron.sqlite.heatRaceDB.insertHeatBoat(
            heat.heat_id,
            eventBoats[boatIndex].boat_id,
          ),
        );
        boatIndex += 1;
      }

      // Assign extra boats to heats
      for (let i = 0; i < extraBoats; i += 1) {
        const heat = FetchedHeats[i];
        heatBoatPromises.push(
          window.electron.sqlite.heatRaceDB.insertHeatBoat(
            heat.heat_id,
            eventBoats[boatIndex].boat_id,
          ),
        );
        boatIndex += 1;
      }

      await Promise.all(heatBoatPromises);

      alert('Heats created successfully!');
      setHeatsCreated(true);
      handleDisplayHeats(); // Refresh the heats display
    } catch (error) {
      console.error('Error creating heats:', error);
      alert('Error creating heats. Please try again later.');
    }
  };

  const handleRecreateHeats = async () => {
    if (raceHappened || finalSeriesStarted) {
      alert('Cannot recreate heats after a race has happened.');
      return;
    }

    try {
      await window.electron.sqlite.heatRaceDB.deleteHeatsByEvent(
        event.event_id,
      );
      await handleCreateHeats();
    } catch (error) {
      console.error('Error recreating heats:', error);
      console.error('Error recreating heats. Please try again later.');
    }
  };

  useEffect(() => {
    setRaceHappened(false); // Reset raceHappened state when event changes
    handleDisplayHeats();
  }, [event, handleDisplayHeats]);

  const handleHeatClick = (heat) => {
    if (clickable) {
      setSelectedHeatId(heat.heat_id);
      onHeatSelect(heat);
    }
  };

  const toggleDisplayMode = () => {
    setDisplayLastHeats((prevMode) => !prevMode);
  };

  const getLastHeats = (heatsList) => {
    const finalHeats = heatsList.filter(
      (heat) => heat.heat_type.toLowerCase() === 'final',
    );
    if (finalHeats.length > 0) {
      return finalHeats;
    }

    const heatGroups = heatsList.reduce((acc, heat) => {
      const match = heat.heat_name.match(/([A-Z]+)(\d*)$/);
      if (match) {
        const [_, group, suffix] = match;
        const suffixNumber = suffix ? parseInt(suffix, 10) : 0;
        if (!acc[group] || acc[group] < suffixNumber) {
          acc[group] = suffixNumber;
        }
      }
      return acc;
    }, {});

    return heats.filter((heat) => {
      const match = heat.heat_name.match(/([A-Z]+)(\d*)$/);
      if (match) {
        const [_, group, suffix] = match;
        const suffixNumber = suffix ? parseInt(suffix, 10) : 0;
        return suffixNumber === heatGroups[group];
      }
      return false;
    });
  };

  const heatsToDisplay = displayLastHeats ? getLastHeats(heats) : heats;
  const hasMultipleRounds = heats.length > getLastHeats(heats).length;

  const getFlagCode = (iocCode) => {
    return iocToFlagCodeMap[iocCode] || iocCode;
  };

  const handleBoatTransfer = async (boat, fromHeatId, toHeatId) => {
    if (raceHappened || finalSeriesStarted) {
      alert('Cannot transfer boats after a race has happened.');
      return;
    }

    try {
      await window.electron.sqlite.heatRaceDB.transferBoatBetweenHeats(
        fromHeatId,
        toHeatId,
        boat.boat_id,
      );
      alert('Boat transferred successfully!');
      handleDisplayHeats(); // Refresh the heats display
    } catch (error) {
      console.error('Error transferring boat:', error);
      alert('Error transferring boat. Please try again later.');
    }
  };

  const handleDragStart = (e, boat, fromHeatId) => {
    const { nativeEvent } = e;
    nativeEvent.dataTransfer.setData(
      'application/json',
      JSON.stringify({ boat, fromHeatId }),
    );
  };
  const handleDrop = async (e, toHeatId) => {
    e.preventDefault();
    const data = JSON.parse(e.dataTransfer.getData('application/json'));
    const { boat, fromHeatId } = data;
    await handleBoatTransfer(boat, fromHeatId, toHeatId);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const heatsContainerStyle = {}; // handled by .heats-container CSS class

  const heatColumnStyle = {
    cursor: clickable ? 'pointer' : 'default',
  };

  const selectedHeatColumnStyle = {
    cursor: clickable ? 'pointer' : 'default',
    borderColor: '#1A6FBF',
    boxShadow:
      '0 0 0 3px rgba(26,111,191,.20), 0 4px 16px rgba(26,111,191,.18)',
  };

  const boatNumberColumnStyle = {
    maxWidth: '100px',
  };

  const sailorNameColumnStyle = {
    maxWidth: '220px',
  };

  return (
    <div className="section-block">
      {/* ── Confirmation modal ─── */}
      {showFinalConfirm && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 999,
            background: 'rgba(10,24,38,.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              background: 'var(--surface)',
              borderRadius: 'var(--radius)',
              boxShadow: 'var(--shadow-md)',
              padding: '32px 36px',
              maxWidth: '420px',
              width: '90%',
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: '12px', color: 'var(--navy)' }}>
              <i className="fa fa-flag-checkered" aria-hidden="true" style={{ marginRight: '8px', color: 'var(--teal)' }} />
              Start Final Series?
            </h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', lineHeight: 1.5 }}>
              This will create <strong>{pendingFinalHeats}</strong> final fleet{pendingFinalHeats > 1 ? 's' : ''} based
              on current standings. This action <strong>cannot be undone</strong>.
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setShowFinalConfirm(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-success"
                onClick={handleConfirmFinalSeries}
              >
                <i className="fa fa-check" aria-hidden="true" style={{ marginRight: '6px' }} />
                Yes, Start Final Series
              </button>
            </div>
          </div>
        </div>
      )}
      <h2>
        <i className="fa fa-flag" aria-hidden="true" style={{ marginRight: '8px' }} />
        Heats
      </h2>
      {/* ── Heat controls ─── */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '12px',
          marginBottom: '16px',
        }}
      >
        {!raceHappened && !finalSeriesStarted && (
          <>
            <label
              htmlFor="numHeats"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '.88rem',
                fontWeight: 600,
                color: '#6B849A',
                whiteSpace: 'nowrap',
              }}
            >
              Heats
              <select
                id="numHeats"
                value={numHeats}
                onChange={(e) => setNumHeats(Number(e.target.value))}
                disabled={raceHappened || finalSeriesStarted}
                style={{ width: '72px' }}
              >
                {[...Array(10).keys()].map((i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={heatsCreated ? handleRecreateHeats : handleCreateHeats}
              disabled={raceHappened || finalSeriesStarted}
            >
              {heatsCreated ? 'Recreate Heats' : 'Create Heats'}
            </button>
          </>
        )}
        {hasMultipleRounds && (
          <button type="button" className="btn-ghost" onClick={toggleDisplayMode}>
            {displayLastHeats ? 'Show All Heats' : 'Show Last Heats'}
          </button>
        )}
        {!finalSeriesStarted && (
          <button
            type="button"
            className="btn-success"
            onClick={handleStartFinalSeries}
          >
            Start Final Series
          </button>
        )}
      </div>
      {heatsToDisplay.length > 0 && (
        <div style={heatsContainerStyle} className="heats-container">
          {heatsToDisplay.map((heat) => (
            <div
              key={heat.heat_id}
              style={
                heat.heat_id === selectedHeatId
                  ? selectedHeatColumnStyle
                  : heatColumnStyle
              }
              className="heat-column"
              onClick={() => handleHeatClick(heat)}
              role="button"
              tabIndex={0}
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  handleHeatClick(heat);
                }
              }}
              onDrop={(e) => handleDrop(e, heat.heat_id)}
              onDragOver={handleDragOver}
            >
              <h4>
                {heat.heat_name} (Race {heat.raceNumber})
              </h4>
              <table>
                <thead>
                  <tr>
                    <th style={sailorNameColumnStyle}>Sailor Name</th>
                    <th>Country</th>
                    <th style={boatNumberColumnStyle}>Boat Number</th>
                  </tr>
                </thead>
                <tbody>
                  {heat.boats.map((boat) => (
                    <tr
                      key={boat.boat_id}
                      draggable={!raceHappened && !finalSeriesStarted}
                      onDragStart={(e) =>
                        handleDragStart(e, boat, heat.heat_id)
                      }
                    >
                      <td style={sailorNameColumnStyle}>
                        {boat.name} {boat.surname}
                      </td>
                      <td>
                        <Flag
                          code={getFlagCode(boat.country)}
                          style={{ width: '30px', marginRight: '5px' }}
                        />
                        {boat.country}
                      </td>
                      <td style={boatNumberColumnStyle}>{boat.sail_number}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

HeatComponent.propTypes = {
  event: PropTypes.shape({
    event_id: PropTypes.number.isRequired,
    // Add other event properties here if needed
  }).isRequired,
  onHeatSelect: PropTypes.func,
  clickable: PropTypes.bool.isRequired,
};

export default HeatComponent;
