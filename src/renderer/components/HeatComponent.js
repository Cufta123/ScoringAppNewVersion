import React, { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import Flag from 'react-world-flags';
import iocToFlagCodeMap from '../constants/iocToFlagCodeMap';
import printNewHeats from '../utils/printNewHeats';
import AppModal from './shared/AppModal';
import { confirmAction, reportError, reportInfo } from '../utils/userFeedback';

const nonExcludableFleetAssignmentStatuses = new Set(['DNE', 'DGM']);

function parseNumberCsv(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((entry) => Number(entry))
    .filter((entry) => !Number.isNaN(entry));
}

function parseStatusCsv(value, expectedLength) {
  const statuses = value
    ? String(value)
        .split(',')
        .map((entry) => entry.trim().toUpperCase())
    : [];

  // Keep status and points arrays aligned for exclusion logic.
  while (statuses.length < expectedLength) {
    statuses.push('FINISHED');
  }

  return statuses.slice(0, expectedLength);
}

function getExcludeCount(racesCount) {
  if (racesCount < 4) return 0;
  if (racesCount < 8) return 1;
  return 2 + Math.floor((racesCount - 8) / 8);
}

export function buildAdjustedFleetLeaderboard(leaderboard) {
  return leaderboard.map((boat) => {
    const rawPoints = parseNumberCsv(boat.race_points);
    const rawStatuses = parseStatusCsv(boat.race_statuses, rawPoints.length);
    const raceEntries = rawPoints.map((points, idx) => ({
      points,
      status: rawStatuses[idx] || 'FINISHED',
      raceIndex: idx,
    }));

    const n = raceEntries.length;
    let excludeCount = getExcludeCount(n);

    // SHRS 4.2: additionally exclude second-worst when 5 < n < 8.
    if (n > 5 && n < 8) {
      excludeCount += 1;
    }

    const excludableCandidates = raceEntries
      .map((entry, idx) => ({ ...entry, idx }))
      .filter(
        (entry) =>
          !nonExcludableFleetAssignmentStatuses.has(
            String(entry.status || 'FINISHED'),
          ),
      )
      .sort(
        (left, right) =>
          right.points - left.points || right.raceIndex - left.raceIndex,
      );

    const excludedIndexes = new Set(
      excludableCandidates.slice(0, excludeCount).map((entry) => entry.idx),
    );

    const totalPoints = raceEntries.reduce((sum, entry, idx) => {
      return excludedIndexes.has(idx) ? sum : sum + entry.points;
    }, 0);

    return { boat_id: boat.boat_id, totalPoints };
  });
}

function HeatComponent({
  event,
  onHeatSelect,
  onStartScoring,
  clickable,
  onQualifyingGroupCountChange,
}) {
  const [heats, setHeats] = useState([]);
  const [numHeats, setNumHeats] = useState(5); // Default number of heats
  const [selectedHeatId, setSelectedHeatId] = useState(null);
  const [heatsCreated, setHeatsCreated] = useState(false);
  const [raceHappened, setRaceHappened] = useState(false);
  const [displayLastHeats, setDisplayLastHeats] = useState(true);
  const [finalSeriesStarted, setFinalSeriesStarted] = useState(false);
  const [showFinalConfirm, setShowFinalConfirm] = useState(false);
  const [pendingFinalHeats, setPendingFinalHeats] = useState(0);
  const [numQualifyingGroups, setNumQualifyingGroups] = useState(0);
  const [newHeatsFormat, setNewHeatsFormat] = useState('excel');

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

      // SHRS 1.1: count unique qualifying heat letter groups to determine
      // whether a Final Series is applicable (requires >= 2 groups).
      const qualifyingGroups = new Set(
        heatDetails
          .filter((h) => h.heat_type === 'Qualifying')
          .map((h) => {
            const m = h.heat_name.match(/Heat ([A-Z])/);
            return m ? m[1] : null;
          })
          .filter(Boolean),
      );
      setNumQualifyingGroups(qualifyingGroups.size);
    } catch (error) {
      reportError('Could not load heats for this event.', error);
      setHeats([]);
      setHeatsCreated(false);
    }
  }, [event.event_id]);

  useEffect(() => {
    if (onQualifyingGroupCountChange) {
      onQualifyingGroupCountChange(numQualifyingGroups);
    }
  }, [numQualifyingGroups, onQualifyingGroupCountChange]);

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

  const handleConfirmFinalSeries = async () => {
    setShowFinalConfirm(false);
    try {
      await window.electron.sqlite.heatRaceDB.startFinalSeriesAtomic(
        event.event_id,
      );
      setFinalSeriesStarted(true);
      reportInfo('Final Series started successfully!', 'Success');
      handleDisplayHeats();
    } catch (error) {
      reportError('Could not start final series.', error);
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
        // Should not be reachable because the button is hidden when numQualifyingGroups < 2,
        // but guard just in case.
        reportInfo(
          numFinalHeats === 0
            ? 'No qualifying heats found. Please create heats before starting the Final Series.'
            : 'With only one heat the event is a single-fleet event (SHRS 1.1) — no Final Series applies.',
          'Cannot start final series',
        );
        return;
      }

      // All latest qualifying heats must have the same number of completed races
      // before the Final Series can start — otherwise rankings are unequal.
      const latestByGroup = qualifyingHeats.reduce((acc, heat) => {
        const m = heat.heat_name.match(/Heat ([A-Z]+)(\d*)/);
        if (m) {
          const [, base, suffix] = m;
          const num = suffix ? parseInt(suffix, 10) : 0;
          if (!acc[base] || num > acc[base].num) {
            acc[base] = { num, heat };
          }
        }
        return acc;
      }, {});
      const latestHeats = Object.values(latestByGroup).map((e) => e.heat);
      const raceCounts = await Promise.all(
        latestHeats.map(async (heat) => {
          const races = await window.electron.sqlite.heatRaceDB.readAllRaces(
            heat.heat_id,
          );
          return { name: heat.heat_name, count: races.length };
        }),
      );
      const uniqueCounts = [...new Set(raceCounts.map((r) => r.count))];
      if (uniqueCounts.length > 1) {
        const breakdown = raceCounts
          .map((r) => `${r.name}: ${r.count} race(s)`)
          .join('\n');
        reportInfo(
          `Cannot start the Final Series — not all heats have the same number of races:\n\n${breakdown}\n\nFinish the current round first.`,
          'Cannot start final series',
        );
        return;
      }
      if (uniqueCounts[0] === 0) {
        const proceed = await confirmAction(
          'No qualifying races have been completed yet. Boats will be assigned to fleets based on their initial seeding only.\n\nStart the Final Series anyway?',
          'Start Final Series',
        );
        if (!proceed) return;
      }

      setPendingFinalHeats(numFinalHeats);
      setShowFinalConfirm(true);
    } catch (error) {
      reportError(
        'Could not validate heats before starting final series.',
        error,
      );
    }
  };

  const handleCreateHeats = async () => {
    if (raceHappened || finalSeriesStarted) {
      reportInfo(
        'Cannot create heats after a race has happened.',
        'Action blocked',
      );
      return;
    }

    try {
      const eventBoats = await window.electron.sqlite.eventDB.readBoatsByEvent(
        event.event_id,
      );
      const existingHeats =
        await window.electron.sqlite.heatRaceDB.readAllHeats(event.event_id);

      if (existingHeats.length > 0) {
        reportInfo('Heats already exist for this event.', 'Action blocked');
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

      // SHRS 3.1: Assign boats using snake/zigzag pattern
      // A, B, C, D, E, E, D, C, B, A, A, B, C, D, E ...
      // with the first extra boat going to Heat 1, the second to Heat 2, etc. (SHRS 2.2)
      const heatBoatPromises = [];
      let heatIndex = 0;
      let direction = 1; // 1 = forward (A→E), -1 = backward (E→A)

      for (let i = 0; i < eventBoats.length; i += 1) {
        const heat = FetchedHeats[heatIndex];
        heatBoatPromises.push(
          window.electron.sqlite.heatRaceDB.insertHeatBoat(
            heat.heat_id,
            eventBoats[i].boat_id,
          ),
        );

        // Move to next heat in snake order
        if (direction === 1 && heatIndex === numHeats - 1) {
          direction = -1; // reached last heat, reverse
        } else if (direction === -1 && heatIndex === 0) {
          direction = 1; // reached first heat, reverse
        } else {
          heatIndex += direction;
        }
      }

      await Promise.all(heatBoatPromises);

      reportInfo('Heats created successfully!', 'Success');
      setHeatsCreated(true);
      handleDisplayHeats(); // Refresh the heats display
    } catch (error) {
      reportError('Could not create heats.', error);
    }
  };

  const handleRecreateHeats = async () => {
    if (raceHappened || finalSeriesStarted) {
      reportInfo(
        'Cannot recreate heats after a race has happened.',
        'Action blocked',
      );
      return;
    }

    try {
      await window.electron.sqlite.heatRaceDB.deleteHeatsByEvent(
        event.event_id,
      );
      await handleCreateHeats();
    } catch (error) {
      reportError('Could not recreate heats.', error);
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
        const [, group, suffix] = match;
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
        const [, group, suffix] = match;
        const suffixNumber = suffix ? parseInt(suffix, 10) : 0;
        return suffixNumber === heatGroups[group];
      }
      return false;
    });
  };

  const heatsToDisplay = displayLastHeats ? getLastHeats(heats) : heats;
  const hasMultipleRounds = heats.length > getLastHeats(heats).length;
  const isFinalSeriesView =
    heatsToDisplay.length > 0 &&
    heatsToDisplay.every((heat) => heat.heat_type === 'Final');

  const getFlagCode = (iocCode) => {
    return iocToFlagCodeMap[iocCode] || iocCode;
  };

  const handleBoatTransfer = async (boat, fromHeatId, toHeatId) => {
    if (raceHappened || finalSeriesStarted) {
      reportInfo(
        'Cannot transfer boats after a race has happened.',
        'Action blocked',
      );
      return;
    }

    try {
      await window.electron.sqlite.heatRaceDB.transferBoatBetweenHeats(
        fromHeatId,
        toHeatId,
        boat.boat_id,
      );
      reportInfo('Boat transferred successfully!', 'Success');
      handleDisplayHeats(); // Refresh the heats display
    } catch (error) {
      reportError('Could not transfer boat between heats.', error);
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

  const handleExportNewHeats = async () => {
    try {
      await printNewHeats(event, heatsToDisplay, newHeatsFormat);
    } catch (error) {
      reportError('Could not export visible heats.', error);
    }
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
      <AppModal
        open={showFinalConfirm}
        title="Start Final Series?"
        confirmLabel="Yes, Start Final Series"
        cancelLabel="Cancel"
        onCancel={() => setShowFinalConfirm(false)}
        onConfirm={handleConfirmFinalSeries}
      >
        This will create <strong>{pendingFinalHeats}</strong> final fleet
        {pendingFinalHeats > 1 ? 's' : ''} based on current standings. This
        action <strong>cannot be undone</strong>.
      </AppModal>
      <h2>
        <i
          className="fa fa-flag"
          aria-hidden="true"
          style={{ marginRight: '8px' }}
        />
        Heats
      </h2>
      {/* ── Heat setup controls ─── */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '12px',
          marginBottom: '12px',
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
          <button
            type="button"
            className="btn-ghost"
            onClick={toggleDisplayMode}
          >
            {displayLastHeats ? 'Show All Heats' : 'Show Last Heats'}
          </button>
        )}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <select
            className="compact-select"
            aria-label="New heats format"
            value={newHeatsFormat}
            onChange={(e) => setNewHeatsFormat(e.target.value)}
          >
            <option value="excel">Excel</option>
            <option value="pdf">PDF</option>
            <option value="html">HTML</option>
          </select>
          <button
            type="button"
            className="btn-ghost"
            onClick={handleExportNewHeats}
            disabled={heatsToDisplay.length === 0}
          >
            {isFinalSeriesView ? 'Print Final Series Heats' : 'Print New Heats'}
          </button>
        </div>
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
              {heat.heat_id === selectedHeatId && onStartScoring && (
                <div
                  style={{
                    marginTop: '14px',
                    paddingTop: '12px',
                    borderTop: '2px solid #e8f0f8',
                    display: 'flex',
                    justifyContent: 'center',
                  }}
                >
                  <button
                    type="button"
                    className="btn-success"
                    onClick={(e) => {
                      e.stopPropagation();
                      onStartScoring();
                    }}
                    style={{ width: '100%' }}
                  >
                    <i
                      className="fa fa-play"
                      aria-hidden="true"
                      style={{ marginRight: '6px' }}
                    />
                    Start Scoring
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Phase transition: Start Final Series ─── */}
      {/* SHRS 1.1: only show Final Series controls when there are 2+ qualifying heat groups */}
      {!finalSeriesStarted && numQualifyingGroups >= 2 && (
        <div
          style={{
            marginTop: '24px',
            paddingTop: '20px',
            borderTop: '2px solid #e8f0f8',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <button
            type="button"
            className="btn-success"
            onClick={handleStartFinalSeries}
          >
            <i
              className="fa fa-flag-checkered"
              aria-hidden="true"
              style={{ marginRight: '6px' }}
            />
            Start Final Series
          </button>
          <span style={{ fontSize: '.85rem', color: '#6B849A' }}>
            Advances the event to the final fleet stage based on current
            standings.
          </span>
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
  onStartScoring: PropTypes.func,
  onQualifyingGroupCountChange: PropTypes.func,
  clickable: PropTypes.bool.isRequired,
};

HeatComponent.defaultProps = {
  onHeatSelect: () => {},
  onStartScoring: null,
  onQualifyingGroupCountChange: null,
};

export default HeatComponent;
