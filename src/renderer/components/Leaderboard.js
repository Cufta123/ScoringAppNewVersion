/* eslint-disable camelcase */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import Flag from 'react-world-flags';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import iocToFlagCodeMap from '../constants/iocToFlagCodeMap';

const PENALTY_CODES = [
  'DNF',
  'DNS',
  'DSQ',
  'OCS',
  'RET',
  'BFD',
  'UFD',
  'DNC',
  'NSC',
  'WTH',
  'DNE',
  // RDG variants — all carry a numeric score (not penaltyPosition)
  'RDG1', // Redress: average of ALL series races
  'RDG2', // Redress: average of SELECTED races
  'RDG3', // Redress: manual numeric entry
];
const RDG_TYPES = ['RDG1', 'RDG2', 'RDG3'];

// Strip exclusion parentheses and return 0 for any non-numeric value (penalty codes).
// Uses parseFloat so RDG average scores (e.g., 3.4) are preserved.
const parseRaceNum = (val) => {
  const n = parseFloat(String(val).replace(/[()]/g, ''));
  return Number.isNaN(n) ? 0 : n;
};

// SHRS 5.4: after 4 races exclude 1, after 8 exclude 2, then +1 per 8 more
const getExcludeCount = (numberOfRaces) => {
  if (numberOfRaces < 4) return 0;
  if (numberOfRaces < 8) return 1;
  return 2 + Math.floor((numberOfRaces - 8) / 8);
};

// Apply score exclusions per SHRS 5.4: mark worst scores with parentheses,
// return marked races array and the net total (sum of non-excluded scores).
const applyExclusions = (rawPositions) => {
  const n = rawPositions.length;
  const excludeCount = getExcludeCount(n);
  const points = rawPositions.map((r) => {
    const v = parseFloat(String(r).replace(/[()]/g, ''));
    return Number.isNaN(v) ? 0 : v;
  });
  if (excludeCount === 0) {
    return {
      markedRaces: rawPositions.map((r) => String(r).replace(/[()]/g, '')),
      total: points.reduce((a, b) => a + b, 0),
    };
  }
  const sorted = [...points].sort((a, b) => b - a);
  const toExclude = [...sorted.slice(0, excludeCount)];
  let total = 0;
  const markedRaces = rawPositions.map((race, i) => {
    const p = points[i];
    const idx = toExclude.indexOf(p);
    if (idx !== -1) {
      toExclude.splice(idx, 1);
      return `(${String(race).replace(/[()]/g, '')})`;
    }
    total += p;
    return String(race).replace(/[()]/g, '');
  });
  return { markedRaces, total };
};

// Process a raw leaderboard DB entry into display-ready format
const processLeaderboardEntry = (entry) => {
  const races = entry.race_positions ? entry.race_positions.split(',') : [];
  const race_ids = entry.race_ids ? entry.race_ids.split(',') : [];
  const race_statuses = entry.race_statuses
    ? entry.race_statuses.split(',')
    : races.map(() => 'FINISHED');
  const { markedRaces } = applyExclusions(races);
  return {
    ...entry,
    races: markedRaces,
    race_ids,
    race_statuses,
    // Use whichever total the backend stored (final takes priority over event)
    computed_total: entry.total_points_final ?? entry.total_points_event,
  };
};

function LeaderboardComponent({ eventId }) {
  const [leaderboard, setLeaderboard] = useState([]);
  const [eventLeaderboard, setEventLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [finalSeriesStarted, setFinalSeriesStarted] = useState(false);
  const [activeTab, setActiveTab] = useState('event'); // 'event' | 'final'
  const [editingCell, setEditingCell] = useState(null);
  const [newValue, setNewValue] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [editableLeaderboard, setEditableLeaderboard] = useState([]);
  const [overallLeaderboard, setOverallLeaderboard] = useState([]);
  const [shiftPositions, setShiftPositions] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [selectedBoatIds, setSelectedBoatIds] = useState([]);
  // rdgMeta stores per-cell info: { type, selectedRaceLabels? }
  // key is `${boatId}-${raceIndex}`
  const [rdgMeta, setRdgMeta] = useState({});
  // rdg2Picker: open multi-race selector for one specific cell
  const [rdg2Picker, setRdg2Picker] = useState(null); // { boatId, raceIndex, selectedIndices: Set }

  const handleCompareRowClick = (boat_id) => {
    if (!compareMode) return;
    setSelectedBoatIds((prev) => {
      if (prev.includes(boat_id)) return prev.filter((id) => id !== boat_id);
      if (prev.length >= 2) return [prev[1], boat_id];
      return [...prev, boat_id];
    });
  };

  const compareInfo = useMemo(() => {
    if (selectedBoatIds.length !== 2) return null;
    // When final series has started, compare using final series pool so totals
    // and tie-breaking operate on final series points only.
    const allEntries = finalSeriesStarted
      ? leaderboard
      : [
          ...eventLeaderboard,
          ...leaderboard.filter(
            (e) => !eventLeaderboard.some((ev) => ev.boat_id === e.boat_id),
          ),
        ];
    const boatA = allEntries.find((e) => e.boat_id === selectedBoatIds[0]);
    const boatB = allEntries.find((e) => e.boat_id === selectedBoatIds[1]);
    if (!boatA || !boatB) return null;

    const sharedIds = new Set(
      (boatB.race_ids || []).filter((id) =>
        (boatA.race_ids || []).includes(id),
      ),
    );

    const totalA = finalSeriesStarted
      ? (boatA.total_points_combined ??
        boatA.computed_total ??
        boatA.total_points_event ??
        0)
      : (boatA.computed_total ?? boatA.total_points_event ?? 0);
    const totalB = finalSeriesStarted
      ? (boatB.total_points_combined ??
        boatB.computed_total ??
        boatB.total_points_event ??
        0)
      : (boatB.computed_total ?? boatB.total_points_event ?? 0);
    const tied = totalA === totalB;

    const parseScore = (val) => {
      if (val == null) return null;
      const s = String(val).replace(/[()]/g, '').trim();
      const n = parseFloat(s);
      return Number.isNaN(n) ? null : n;
    };

    // Pairs for shared races in race order
    const sharedRacePairs = [...sharedIds].map((raceId) => {
      const riA = (boatA.race_ids || []).indexOf(raceId);
      const riB = (boatB.race_ids || []).indexOf(raceId);
      return {
        raceId,
        raceNumA: riA + 1,
        displayA: boatA.races?.[riA] ?? '?',
        displayB: boatB.races?.[riB] ?? '?',
        scoreA: parseScore(boatA.races?.[riA]),
        scoreB: parseScore(boatB.races?.[riB]),
      };
    });

    // RRS A8.1: sort each boat's scores best-to-worst (ascending), compare pairwise
    const a81 = (pairs) => {
      const sA = pairs
        .map((p) => p.scoreA)
        .filter((s) => s !== null)
        .sort((a, b) => a - b);
      const sB = pairs
        .map((p) => p.scoreB)
        .filter((s) => s !== null)
        .sort((a, b) => a - b);
      for (let i = 0; i < Math.min(sA.length, sB.length); i++) {
        if (sA[i] < sB[i]) return boatA;
        if (sB[i] < sA[i]) return boatB;
      }
      return null;
    };

    // RRS A8.2: compare last race, then second-to-last, etc.
    const a82 = (pairs) => {
      for (let i = pairs.length - 1; i >= 0; i--) {
        const { scoreA, scoreB } = pairs[i];
        if (scoreA !== null && scoreB !== null) {
          if (scoreA < scoreB) return boatA;
          if (scoreB < scoreA) return boatB;
        }
      }
      return null;
    };

    let tieBreak = null;
    if (tied) {
      if (sharedIds.size > 0) {
        // SHRS 5.6(ii)(a): A8.1 then A8.2 using only shared-heat scores
        const winner = a81(sharedRacePairs) || a82(sharedRacePairs);
        tieBreak = {
          rule: 'SHRS 5.6(ii)(a)',
          detail: 'shared-heat scores only (incl. excluded scores)',
          winner,
        };
      } else {
        // SHRS 5.6(ii)(b): A8.1 then A8.2 using all scores, no modification
        const allPairs = (boatA.race_ids || [])
          .map((raceId, riA) => {
            const riB = (boatB.race_ids || []).indexOf(raceId);
            return {
              raceId,
              scoreA: parseScore(boatA.races?.[riA]),
              scoreB: riB >= 0 ? parseScore(boatB.races?.[riB]) : null,
            };
          })
          .filter((p) => p.scoreB !== null);
        const winner = a81(allPairs) || a82(allPairs);
        tieBreak = {
          rule: 'SHRS 5.6(ii)(b)',
          detail: 'no shared heats — full RRS A8.1 & A8.2 on all scores',
          winner,
        };
      }
    }

    return {
      boatA,
      boatB,
      sharedIds,
      sharedQualIds: (() => {
        // Compute shared qualifying race IDs from the eventLeaderboard entries
        const qA = eventLeaderboard.find(
          (e) => e.boat_id === selectedBoatIds[0],
        );
        const qB = eventLeaderboard.find(
          (e) => e.boat_id === selectedBoatIds[1],
        );
        if (!qA || !qB) return new Set();
        return new Set(
          (qB.race_ids || []).filter((id) => (qA.race_ids || []).includes(id)),
        );
      })(),
      sharedQualRacePairs: (() => {
        const qA = eventLeaderboard.find(
          (e) => e.boat_id === selectedBoatIds[0],
        );
        const qB = eventLeaderboard.find(
          (e) => e.boat_id === selectedBoatIds[1],
        );
        if (!qA || !qB) return [];
        const parseScoreLocal = (val) => {
          if (val == null) return null;
          const s = String(val).replace(/[()]/g, '').trim();
          const n = parseFloat(s);
          return Number.isNaN(n) ? null : n;
        };
        const qualSharedIds = (qB.race_ids || []).filter((id) =>
          (qA.race_ids || []).includes(id),
        );
        return qualSharedIds.map((raceId, i) => {
          const riA = (qA.race_ids || []).indexOf(raceId);
          const riB = (qB.race_ids || []).indexOf(raceId);
          return {
            raceId,
            raceNum: i + 1,
            displayA: qA.races?.[riA] ?? '?',
            displayB: qB.races?.[riB] ?? '?',
            scoreA: parseScoreLocal(qA.races?.[riA]),
            scoreB: parseScoreLocal(qB.races?.[riB]),
          };
        });
      })(),
      sharedRacePairs,
      totalA,
      totalB,
      tied,
      tieBreak,
    };
  }, [selectedBoatIds, finalSeriesStarted, eventLeaderboard, leaderboard]);

  const checkFinalSeriesStarted = useCallback(async () => {
    try {
      const heats =
        await window.electron.sqlite.heatRaceDB.readAllHeats(eventId);
      const finalHeats = heats.filter((heat) => heat.heat_type === 'Final');
      if (finalHeats.length > 0) {
        setFinalSeriesStarted(true);
        setActiveTab('final');
      }
    } catch (error) {
      console.error('Error checking final series:', error);
    }
  }, [eventId]);

  useEffect(() => {
    checkFinalSeriesStarted();
  }, [checkFinalSeriesStarted]);

  const getFlagCode = (iocCode) => {
    return iocToFlagCodeMap[iocCode] || iocCode;
  };

  const fetchLeaderboard = useCallback(async () => {
    try {
      // Recompute the event leaderboard in the DB so that place values
      // reflect correct exclusions and SHRS 5.6 tie-breaking.
      try {
        await window.electron.sqlite.heatRaceDB.updateEventLeaderboard(eventId);
      } catch (_) {
        // Event may be locked; continue with existing DB values
      }

      const [finalResults, eventResults, overallResults] = await Promise.all([
        window.electron.sqlite.heatRaceDB.readFinalLeaderboard(eventId),
        window.electron.sqlite.heatRaceDB.readLeaderboard(eventId),
        finalSeriesStarted
          ? window.electron.sqlite.heatRaceDB.readOverallLeaderboard(eventId)
          : Promise.resolve([]),
      ]);

      // Always build and store the event leaderboard.
      // Sort by backend-computed `place` which includes proper tie-breaking
      // (SHRS 5.6 / RRS A8.1 & A8.2).
      const eventLeaderboardWithRaces = eventResults
        .map(processLeaderboardEntry)
        .sort((a, b) => (a.place ?? Infinity) - (b.place ?? Infinity));
      setEventLeaderboard(eventLeaderboardWithRaces);

      const results = finalSeriesStarted ? finalResults : eventResults;

      const leaderboardWithRaces = results.map(processLeaderboardEntry);

      // Store overall leaderboard from backend (SHRS 5.4 combined scoring)
      if (finalSeriesStarted) {
        setOverallLeaderboard(overallResults);
      }

      // For each entry, compute combined total (qualifying + final after exclusions)
      // Use backend-computed overall_points when available (SHRS 5.4)
      const mergedResults = leaderboardWithRaces.map((entry) => {
        if (finalSeriesStarted) {
          const overallEntry = overallResults.find(
            (o) => o.boat_id === entry.boat_id,
          );
          const eventEntry = eventLeaderboardWithRaces.find(
            (e) => e.boat_id === entry.boat_id,
          );
          const total_points_combined = overallEntry
            ? overallEntry.overall_points
            : entry.computed_total + (eventEntry ? eventEntry.computed_total : 0);
          return {
            ...entry,
            total_points_combined,
            qualifying_points: overallEntry?.qualifying_points ?? eventEntry?.computed_total ?? 0,
            overall_rank: overallEntry?.overall_rank,
          };
        }
        return entry;
      });

      mergedResults.sort((a, b) =>
        finalSeriesStarted
          ? a.total_points_combined - b.total_points_combined ||
            (a.place ?? Infinity) - (b.place ?? Infinity)
          : (a.place ?? Infinity) - (b.place ?? Infinity),
      );

      console.log('Combined leaderboard results:', mergedResults);
      setLeaderboard(mergedResults);
      setEditableLeaderboard(JSON.parse(JSON.stringify(mergedResults))); // Clone for editing
    } catch (error) {
      console.error('Error fetching leaderboard:', error.message);
    } finally {
      setLoading(false);
    }
  }, [eventId, finalSeriesStarted]);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  const toggleEditMode = () => {
    const source = finalSeriesStarted ? leaderboard : eventLeaderboard;
    setEditableLeaderboard(JSON.parse(JSON.stringify(source)));
    setRdgMeta({});
    setRdg2Picker(null);
    setEditMode(!editMode);
  };

  // Compute RDG average from a list of races
  const computeRdgAverage = (races, statuses, excludeIdx, penaltyPos, selectedIndices = null) => {
    const candidates = races
      .map((r, i) => ({
        val: parseFloat(String(r).replace(/[()]/g, '')),
        status: statuses?.[i] || 'FINISHED',
        idx: i,
      }))
      .filter(({ idx, status }) => {
        if (idx === excludeIdx) return false;
        if (PENALTY_CODES.includes(status)) return false;
        if (selectedIndices !== null && !selectedIndices.has(idx)) return false;
        return true;
      });
    if (candidates.length === 0) return penaltyPos;
    const sum = candidates.reduce((s, { val }) => s + (Number.isNaN(val) ? 0 : val), 0);
    return Math.round((sum / candidates.length) * 10) / 10;
  };

  const handleRaceChange = (
    boatId,
    raceIndex,
    newRaceValue,
    newStatus = 'FINISHED',
  ) => {
    const isRdgType = RDG_TYPES.includes(newStatus);
    const isPenalty = PENALTY_CODES.includes(newStatus);
    const numericInput = parseFloat(newRaceValue);

    // RDG2 is now opened directly from the select onChange (with anchorRect)
    // so it never reaches here. Guard kept for safety.
    if (newStatus === 'RDG2') return;

    // Non-penalty non-RDG: need a valid positive number
    if (!isPenalty && (Number.isNaN(numericInput) || numericInput < 0)) return;
    // RDG3: manual — need valid number, BUT when switching status (newRaceValue===null) allow it
    if (newStatus === 'RDG3' && newRaceValue !== null && Number.isNaN(numericInput)) return;

    // Deep-clone so we never mutate existing React state
    const cloned = JSON.parse(JSON.stringify(editableLeaderboard));
    const penaltyPosition = cloned.length + 1;

    let newPosition;
    if (newStatus === 'RDG1') {
      // Average of ALL finished races in the series (excl. current index)
      const entry = cloned.find((e) => e.boat_id === boatId);
      newPosition = entry
        ? computeRdgAverage(entry.races, entry.race_statuses, raceIndex, penaltyPosition)
        : penaltyPosition;
      setRdgMeta((prev) => ({
        ...prev,
        [`${boatId}-${raceIndex}`]: { type: 'RDG1' },
      }));
    } else if (newStatus === 'RDG3') {
      if (newRaceValue === null) {
        // Just switching status to RDG3 — keep the current numeric value
        const existingEntry = cloned.find((e) => e.boat_id === boatId);
        const raw = existingEntry
          ? parseFloat(String(existingEntry.races[raceIndex]).replace(/[()]/g, ''))
          : 0;
        newPosition = Number.isNaN(raw) ? 0 : raw;
      } else {
        newPosition = numericInput;
      }
      setRdgMeta((prev) => ({
        ...prev,
        [`${boatId}-${raceIndex}`]: { type: 'RDG3' },
      }));
    } else if (isRdgType) {
      newPosition = penaltyPosition;
    } else {
      newPosition = isPenalty ? penaltyPosition : numericInput;
    }

    // Old position of the boat being edited (strip exclusion parens)
    const targetEntry = cloned.find((e) => e.boat_id === boatId);
    if (!targetEntry) return;
    const oldPosition = parseRaceNum(targetEntry.races[raceIndex]);

    // Shift other non-penalty boats first so the clone reflects final positions
    if (shiftPositions && !isPenalty) {
      cloned.forEach((otherEntry) => {
        if (
          otherEntry.boat_id !== boatId &&
          otherEntry.races[raceIndex] !== undefined
        ) {
          const otherStatus =
            otherEntry.race_statuses?.[raceIndex] || 'FINISHED';
          if (PENALTY_CODES.includes(otherStatus)) return;
          const otherPos = parseRaceNum(otherEntry.races[raceIndex]);
          if (
            oldPosition > newPosition &&
            otherPos >= newPosition &&
            otherPos < oldPosition
          ) {
            otherEntry.races[raceIndex] = otherPos + 1;
          } else if (
            oldPosition < newPosition &&
            otherPos <= newPosition &&
            otherPos > oldPosition
          ) {
            otherEntry.races[raceIndex] = otherPos - 1;
          }
        }
      });
    }

    const updated = cloned.map((entry) => {
      const entryStatuses =
        entry.race_statuses || entry.races.map(() => 'FINISHED');
      const rawRaces = entry.races.map((r) => String(r).replace(/[()]/g, ''));
      const newStatuses = [...entryStatuses];
      if (entry.boat_id === boatId) {
        rawRaces[raceIndex] = String(newPosition);
        newStatuses[raceIndex] = newStatus;
      }
      // Re-apply exclusions from scratch so the correct worst scores are marked
      const { markedRaces, total } = applyExclusions(rawRaces);
      return {
        ...entry,
        races: markedRaces,
        race_statuses: newStatuses,
        total_points_event: total,
        total_points_final: total,
        computed_total: total,
      };
    });

    setEditableLeaderboard(updated);
  };

  // Confirm RDG2: compute average from selected race indices (qual + final combined)
  const confirmRdg2 = () => {
    if (!rdg2Picker) return;
    const { boatId, raceIndex, selectedIndices, selectedQualIndices } = rdg2Picker;
    const cloned = JSON.parse(JSON.stringify(editableLeaderboard));
    const entry = cloned.find((e) => e.boat_id === boatId);
    if (!entry) { setRdg2Picker(null); return; }

    const penaltyPosition = cloned.length + 1;

    // Gather values from selected final-series races
    const finalValues = [...(selectedIndices || new Set())]
      .filter((i) => i !== raceIndex)
      .map((i) => {
        const status = entry.race_statuses?.[i] || 'FINISHED';
        if (PENALTY_CODES.includes(status)) return null;
        return parseFloat(String(entry.races[i]).replace(/[()]/g, ''));
      })
      .filter((v) => v !== null && !Number.isNaN(v));

    // Gather values from selected qualifying races
    const qualEntry = eventLeaderboard?.find((e) => e.boat_id === boatId);
    const qualValues = [...(selectedQualIndices || new Set())]
      .map((i) => {
        const status = qualEntry?.race_statuses?.[i] || 'FINISHED';
        if (PENALTY_CODES.includes(status)) return null;
        return parseFloat(String(qualEntry?.races?.[i] ?? '').replace(/[()]/g, ''));
      })
      .filter((v) => v !== null && !Number.isNaN(v));

    const allValues = [...qualValues, ...finalValues];
    const avg = allValues.length > 0
      ? Math.round((allValues.reduce((s, v) => s + v, 0) / allValues.length) * 10) / 10
      : penaltyPosition;

    const entryStatuses = [...(entry.race_statuses || entry.races.map(() => 'FINISHED'))];
    const rawRaces = entry.races.map((r) => String(r).replace(/[()]/g, ''));
    rawRaces[raceIndex] = String(avg);
    entryStatuses[raceIndex] = 'RDG2';

    const { markedRaces, total } = applyExclusions(rawRaces);
    const updatedEntry = {
      ...entry,
      races: markedRaces,
      race_statuses: entryStatuses,
      total_points_event: total,
      total_points_final: total,
      computed_total: total,
    };

    const qualLabels = [...(selectedQualIndices || new Set())].sort((a, b) => a - b).map((i) => `Q${i + 1}`);
    const finalLabels = [...(selectedIndices || new Set())].sort((a, b) => a - b).map((i) => `F${i + 1}`);
    const selectedRaceLabels = [...qualLabels, ...finalLabels];
    setRdgMeta((prev) => ({
      ...prev,
      [`${boatId}-${raceIndex}`]: { type: 'RDG2', selectedRaceLabels },
    }));
    setEditableLeaderboard(cloned.map((e) => (e.boat_id === boatId ? updatedEntry : e)));
    setRdg2Picker(null);
  };

  const handleSave = async () => {
    console.log('Updated leaderboard:', editableLeaderboard);
    try {
      if (!editableLeaderboard || !leaderboard) {
        throw new Error('Leaderboard data is not initialized');
      }

      // Recalculate total points (with exclusions) before saving
      const updatedLeaderboard = editableLeaderboard.map((entry) => {
        const rawRaces = entry.races.map((r) => String(r).replace(/[()]/g, ''));
        const { total } = applyExclusions(rawRaces);
        return {
          ...entry,
          total_points_event: total,
          total_points_final: total,
          computed_total: total,
        };
      });

      // Update changes to the database
      const originalSource =
        activeTab === 'event' ? eventLeaderboard : leaderboard;
      for (const entry of updatedLeaderboard) {
        const originalEntry = originalSource.find(
          (e) => e.boat_id === entry.boat_id,
        );
        if (!originalEntry) continue;

        // Save race data changes to the database
        for (let i = 0; i < entry.races.length; i++) {
          const entryStatus = entry.race_statuses?.[i] || 'FINISHED';
          const origStatus = originalEntry.race_statuses?.[i] || 'FINISHED';
          // eslint-disable-next-line no-continue
          if (
            // eslint-disable-next-line eqeqeq
            parseRaceNum(entry.races[i]) ===
              parseRaceNum(originalEntry.races[i]) &&
            entryStatus === origStatus
          )
            continue;
          const race_id = entry.race_ids[i];
          if (!race_id) {
            console.error('Race ID is missing for entry:', entry);
            continue;
          }
          const newPosition = parseRaceNum(entry.races[i]);
          await window.electron.sqlite.heatRaceDB.updateRaceResult(
            eventId,
            race_id,
            entry.boat_id,
            newPosition,
            shiftPositions,
            entryStatus,
          );
        }
      }

      await window.electron.sqlite.heatRaceDB.updateEventLeaderboard(eventId);
      // When editing final series races, also recompute the FinalLeaderboard so
      // placement_group, place, and total_points_final are kept in sync.
      if (finalSeriesStarted && activeTab !== 'event') {
        await window.electron.sqlite.heatRaceDB.updateFinalLeaderboard(eventId);
      }

      // Full re-fetch so every derived view (qualifying, final, combined) is in sync
      await fetchLeaderboard();
      setEditMode(false); // Exit edit mode after saving
    } catch (error) {
      console.error('Error saving leaderboard:', error.message);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '24px', color: 'var(--navy)' }}>Loading…</div>
    );
  }

  // Determine if there is anything to show at all
  const hasEventData = eventLeaderboard.length > 0;
  const hasFinalData = leaderboard.length > 0;

  if (!hasEventData && !hasFinalData) {
    return (
      <div style={{ padding: '24px', color: '#666' }}>
        No results available for this event yet.
      </div>
    );
  }

  const groupedLeaderboard =
    editableLeaderboard?.reduce((acc, entry) => {
      const group = entry.placement_group || 'General';
      if (!acc[group]) {
        acc[group] = [];
      }
      acc[group].push(entry);
      return acc;
    }, {}) || {};

  const groupOrder = ['Gold', 'Silver', 'Bronze', 'Copper', 'General'];
  const sortedGroups = Object.keys(groupedLeaderboard).sort(
    (a, b) => groupOrder.indexOf(a) - groupOrder.indexOf(b),
  );

  const exportToExcel = async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Leaderboard');

    const header = [
      'Rank',
      'Name',
      'Country',
      'Boat Number',
      'Boat Type',
      ...(leaderboard[0]?.races?.map((_, index) => `Race ${index + 1}`) || []),
      'Total Points',
    ];
    worksheet.addRow(header);

    if (finalSeriesStarted) {
      sortedGroups.forEach((group) => {
        const groupHeader = [`${group} Group`];
        worksheet.addRow(groupHeader);

        groupedLeaderboard[group]?.forEach((entry, index) => {
          const row = [
            index + 1,
            `${entry.name} ${entry.surname}`,
            entry.country,
            entry.boat_number,
            entry.boat_type,
            ...entry.races,
            entry.computed_total ?? entry.total_points_final,
          ];
          worksheet.addRow(row);
        });
      });
    } else {
      leaderboard.forEach((entry, index) => {
        const row = [
          index + 1,
          `${entry.name} ${entry.surname}`,
          entry.country,
          entry.boat_number,
          entry.boat_type,
          ...entry.races,
          entry.computed_total ?? entry.total_points_event,
        ];
        worksheet.addRow(row);
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    saveAs(blob, 'leaderboard.xlsx');
  };

  return (
    <div className="leaderboard">
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '16px',
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        <h2 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--navy)' }}>
          {finalSeriesStarted ? 'Results' : 'Leaderboard'}
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Tab toggle removed — both sections always visible */}
          <button
            type="button"
            onClick={toggleEditMode}
            style={{
              padding: '6px 14px',
              borderRadius: 'var(--radius, 6px)',
              border: `1px solid ${
                editMode ? 'var(--danger, #e63946)' : 'var(--border, #dde3ea)'
              }`,
              background: editMode
                ? 'var(--danger, #e63946)'
                : 'var(--surface, #f0f4f8)',
              color: editMode ? '#fff' : 'var(--navy)',
              fontWeight: 600,
              fontSize: '0.85rem',
              cursor: 'pointer',
            }}
          >
            {editMode ? 'Cancel Editing' : 'Edit Results'}
          </button>
          {editMode && (
            <>
              <button
                type="button"
                onClick={handleSave}
                style={{
                  padding: '6px 14px',
                  borderRadius: 'var(--radius, 6px)',
                  border: 'none',
                  background: 'var(--teal, #2a9d8f)',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                Save Changes
              </button>
              <label
                htmlFor="shiftPositionsCheckbox"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '0.85rem',
                  color: 'var(--navy)',
                  cursor: 'pointer',
                }}
              >
                <input
                  id="shiftPositionsCheckbox"
                  type="checkbox"
                  checked={shiftPositions}
                  onChange={(e) => setShiftPositions(e.target.checked)}
                />
                Shift other boats
              </label>
            </>
          )}
          <button
            type="button"
            onClick={() => {
              setCompareMode((m) => !m);
              setSelectedBoatIds([]);
            }}
            style={{
              padding: '6px 14px',
              borderRadius: 'var(--radius, 6px)',
              border: `1px solid ${
                compareMode ? 'var(--teal, #2a9d8f)' : 'var(--border, #dde3ea)'
              }`,
              background: compareMode
                ? 'var(--teal, #2a9d8f)'
                : 'var(--surface, #f0f4f8)',
              color: compareMode ? '#fff' : 'var(--navy)',
              fontWeight: 600,
              fontSize: '0.85rem',
              cursor: 'pointer',
            }}
          >
            {compareMode ? 'Exit Compare' : 'Compare'}
          </button>
          <button
            type="button"
            onClick={exportToExcel}
            style={{
              padding: '6px 14px',
              borderRadius: 'var(--radius, 6px)',
              border: '1px solid var(--border, #dde3ea)',
              background: 'var(--surface, #f0f4f8)',
              color: 'var(--navy)',
              fontWeight: 600,
              fontSize: '0.85rem',
              cursor: 'pointer',
            }}
          >
            Export to Excel
          </button>
        </div>
      </div>

      {/* Qualifying series section — hidden once final series starts */}
      {hasEventData && !finalSeriesStarted && (
        <>
          {/* Section header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              marginBottom: '8px',
              marginTop: '4px',
            }}
          >
            <span
              style={{
                fontWeight: 700,
                fontSize: '0.78rem',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--navy)',
                opacity: 0.5,
              }}
            >
              Qualifying Series
            </span>
            <div
              style={{
                flex: 1,
                height: '1px',
                background: 'var(--border, #dde3ea)',
              }}
            />
          </div>
          <div
            style={{
              border: '1px solid var(--border, #dde3ea)',
              borderRadius: '10px',
              overflow: 'hidden',
              boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
            }}
          >
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '0.9rem',
              }}
            >
              <thead>
                <tr
                  style={{
                    background: 'var(--surface, #f5f7fa)',
                    borderBottom: '2px solid var(--border, #dde3ea)',
                  }}
                >
                  {[
                    'Rank',
                    'Name',
                    'Country',
                    'Sail #',
                    'Type',
                    ...(eventLeaderboard[0]?.races?.map(
                      (_, i) => `R${i + 1}`,
                    ) || []),
                    'Total',
                  ].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: 'left',
                        padding: '9px 12px',
                        fontWeight: 600,
                        color: 'var(--navy)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(editMode ? editableLeaderboard : eventLeaderboard).map(
                  (entry, index) => (
                    <tr
                      key={`ev-${entry.boat_id}`}
                      onClick={() => handleCompareRowClick(entry.boat_id)}
                      style={{
                        background: selectedBoatIds.includes(entry.boat_id)
                          ? 'rgba(42, 157, 143, 0.15)'
                          : index % 2 === 0
                            ? '#fff'
                            : 'var(--surface, #f5f7fa)',
                        borderBottom: '1px solid var(--border, #dde3ea)',
                        cursor: compareMode ? 'pointer' : 'default',
                        outline: selectedBoatIds.includes(entry.boat_id)
                          ? '2px solid var(--teal, #2a9d8f)'
                          : 'none',
                        outlineOffset: '-2px',
                      }}
                    >
                      <td
                        style={{
                          padding: '8px 12px',
                          fontWeight: 700,
                          color: 'var(--navy)',
                        }}
                      >
                        {index + 1}
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        {entry.name} {entry.surname}
                      </td>
                      <td
                        style={{
                          padding: '8px 12px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <Flag
                          code={getFlagCode(entry.country)}
                          style={{ width: '24px' }}
                        />
                        {entry.country}
                      </td>
                      <td style={{ padding: '8px 12px', fontWeight: 600 }}>
                        {entry.boat_number}
                      </td>
                      <td style={{ padding: '8px 12px', color: '#555' }}>
                        {entry.boat_type}
                      </td>
                      {entry.races?.map((race, ri) => {
                        const raceStatus =
                          entry.race_statuses?.[ri] || 'FINISHED';
                        const isPenalty = PENALTY_CODES.includes(raceStatus);
                        const isRdgCell = RDG_TYPES.includes(raceStatus);
                        const isExcluded =
                          typeof race === 'string' && race.startsWith('(');
                        let displayText;
                        let displayColor;
                        if (isRdgCell && isExcluded) {
                          displayText = `(${race.replace(/[()]/g, '')}) ${raceStatus}`;
                          displayColor = '#888';
                        } else if (isRdgCell) {
                          displayText = `${race} ${raceStatus}`;
                          displayColor = 'var(--teal, #2a9d8f)';
                        } else if (isPenalty && isExcluded) {
                          displayText = `(${raceStatus})`;
                          displayColor = '#999';
                        } else if (isPenalty) {
                          displayText = raceStatus;
                          displayColor = 'var(--danger, #e63946)';
                        } else if (isExcluded) {
                          displayText = race;
                          displayColor = '#999';
                        } else {
                          displayText = race;
                          displayColor = 'inherit';
                        }
                        const raceId = entry.race_ids?.[ri];
                        const isShared =
                          compareMode &&
                          (compareInfo?.sharedQualIds?.has(raceId) ?? false);
                        const isPickerOpen =
                          rdg2Picker?.boatId === entry.boat_id &&
                          rdg2Picker?.raceIndex === ri;
                        return (
                          <td
                            key={ri}
                            style={{
                              padding: '8px 12px',
                              textAlign: 'center',
                              background: isShared
                                ? 'rgba(255, 210, 0, 0.3)'
                                : editMode
                                  ? 'var(--surface,#f5f7fa)'
                                  : 'transparent',
                              position: 'relative',
                            }}
                          >
                            {editMode ? (
                              <div
                                style={{
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '2px',
                                  alignItems: 'center',
                                }}
                              >
                                <input
                                  type="number"
                                  value={
                                    typeof race === 'string'
                                      ? race.replace(/[()]/g, '')
                                      : race
                                  }
                                  disabled={isPenalty && raceStatus !== 'RDG3'}
                                  onChange={(e) =>
                                    handleRaceChange(
                                      entry.boat_id,
                                      ri,
                                      e.target.value,
                                      raceStatus === 'RDG3' ? 'RDG3' : 'FINISHED',
                                    )
                                  }
                                  style={{
                                    width: '50px',
                                    padding: '3px 5px',
                                    borderRadius: '4px',
                                    border: '1px solid var(--border,#dde3ea)',
                                    opacity: isPenalty && raceStatus !== 'RDG3' ? 0.35 : 1,
                                  }}
                                />
                                <select
                                  value={raceStatus}
                                  onChange={(e) => {
                                    if (e.target.value === 'RDG2') {
                                      const rect = e.target.getBoundingClientRect();
                                      setRdg2Picker({ boatId: entry.boat_id, raceIndex: ri, selectedIndices: new Set(), selectedQualIndices: new Set(), anchorRect: rect });
                                    } else {
                                      handleRaceChange(entry.boat_id, ri, null, e.target.value);
                                    }
                                  }}
                                  style={{
                                    width: '80px',
                                    fontSize: '0.72rem',
                                    borderRadius: '4px',
                                    border: '1px solid var(--border,#dde3ea)',
                                    padding: '2px',
                                    color: isRdgCell
                                      ? 'var(--teal,#2a9d8f)'
                                      : isPenalty
                                        ? 'var(--danger,#e63946)'
                                        : 'var(--navy)',
                                  }}
                                >
                                  <option value="FINISHED">Finish</option>
                                  {PENALTY_CODES.filter(
                                    (code) => !RDG_TYPES.includes(code),
                                  ).map((code) => (
                                    <option key={code} value={code}>
                                      {code}
                                    </option>
                                  ))}
                                  <optgroup label="RDG – Redress">
                                    <option value="RDG1">RDG1 – All races avg</option>
                                    <option value="RDG2">RDG2 – Selected races avg</option>
                                    <option value="RDG3">RDG3 – Manual entry</option>
                                  </optgroup>
                                </select>
                                {/* RDG2 inline race picker */}
                                {isPickerOpen && rdg2Picker.anchorRect && (
                                  <div
                                    style={{
                                      position: 'fixed',
                                      top: rdg2Picker.anchorRect.bottom + 4,
                                      left: rdg2Picker.anchorRect.left,
                                      zIndex: 9999,
                                      background: '#fff',
                                      border: '1px solid var(--teal,#2a9d8f)',
                                      borderRadius: '8px',
                                      padding: '10px 14px',
                                      minWidth: '220px',
                                      width: 'max-content',
                                      boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
                                      textAlign: 'left',
                                    }}
                                  >
                                    <div style={{ fontWeight: 700, fontSize: '0.82rem', marginBottom: '8px', color: 'var(--teal,#2a9d8f)' }}>
                                      Select races to average:
                                    </div>
                                    <div style={{ maxHeight: '260px', overflowY: 'auto', marginBottom: '8px' }}>
                                      {entry.races.map((_, rIdx) => {
                                        if (rIdx === ri) return null;
                                        const checked = rdg2Picker.selectedIndices.has(rIdx);
                                        return (
                                          <label
                                            key={rIdx}
                                            style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', cursor: 'pointer', marginBottom: '5px', padding: '3px 4px', borderRadius: '4px', background: checked ? 'rgba(42,157,143,0.08)' : 'transparent' }}
                                          >
                                            <input
                                              type="checkbox"
                                              checked={checked}
                                              onChange={() => {
                                                const next = new Set(rdg2Picker.selectedIndices);
                                                if (checked) next.delete(rIdx); else next.add(rIdx);
                                                setRdg2Picker({ ...rdg2Picker, selectedIndices: next });
                                              }}
                                            />
                                            Q{rIdx + 1}
                                          </label>
                                        );
                                      })}
                                    </div>
                                    <div style={{ display: 'flex', gap: '6px' }}>
                                      <button
                                        type="button"
                                        onClick={confirmRdg2}
                                        disabled={rdg2Picker.selectedIndices.size === 0}
                                        style={{ flex: 1, fontSize: '0.8rem', padding: '5px 8px', borderRadius: '5px', background: 'var(--teal,#2a9d8f)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600, opacity: rdg2Picker.selectedIndices.size === 0 ? 0.4 : 1 }}
                                      >
                                        Apply
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setRdg2Picker(null)}
                                        style={{ flex: 1, fontSize: '0.8rem', padding: '5px 8px', borderRadius: '5px', background: 'var(--surface,#f5f7fa)', border: '1px solid var(--border,#dde3ea)', cursor: 'pointer' }}
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span
                                style={{
                                  color: displayColor,
                                  fontWeight:
                                    isPenalty && !isExcluded ? 600 : 'inherit',
                                }}
                              >
                                {displayText}
                              </span>
                            )}
                          </td>
                        );
                      })}
                      <td
                        style={{
                          padding: '8px 12px',
                          fontWeight: 700,
                          color: 'var(--teal, #2a9d8f)',
                        }}
                      >
                        {entry.computed_total ?? entry.total_points_event}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Final series section */}
      {finalSeriesStarted && (
        <>
          {/* Section header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              marginBottom: '8px',
              marginTop: '20px',
            }}
          >
            <span
              style={{
                fontWeight: 700,
                fontSize: '0.78rem',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--navy)',
                opacity: 0.5,
              }}
            >
              Final Series
            </span>
            <div
              style={{
                flex: 1,
                height: '1px',
                background: 'var(--border, #dde3ea)',
              }}
            />
          </div>
          {!hasFinalData ? (
            <div
              style={{
                padding: '24px',
                color: '#666',
                textAlign: 'center',
                border: '1px solid var(--border,#dde3ea)',
                borderRadius: '10px',
              }}
            >
              The final series has been created but no races have been scored
              yet.
            </div>
          ) : (
            sortedGroups.map((group) => {
              const fleetAccent = {
                Gold: { border: '#c8960a', thead: 'rgba(255,215,0,0.18)' },
                Silver: { border: '#7a8a94', thead: 'rgba(180,195,205,0.22)' },
                Bronze: { border: '#9a6020', thead: 'rgba(180,110,40,0.14)' },
                Copper: { border: '#8a5020', thead: 'rgba(180,100,50,0.12)' },
                General: {
                  border: 'var(--border,#dde3ea)',
                  thead: 'var(--surface,#f5f7fa)',
                },
              }[group] || {
                border: 'var(--border,#dde3ea)',
                thead: 'var(--surface,#f5f7fa)',
              };
              const qualRaceCount = eventLeaderboard[0]?.races?.length || 0;
              const finalRaceCount =
                groupedLeaderboard[group]?.[0]?.races?.length || 0;
              return (
                <div key={`group-${group}`} style={{ marginBottom: '18px' }}>
                  <h3
                    style={{
                      fontSize: '0.9rem',
                      color: 'var(--navy)',
                      margin: '0 0 6px 0',
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-block',
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        background: fleetAccent.border,
                        flexShrink: 0,
                      }}
                    />
                    {group} Fleet
                  </h3>
                  <div
                    style={{
                      border: `1.5px solid ${fleetAccent.border}`,
                      borderRadius: '10px',
                      overflow: 'hidden',
                      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                    }}
                  >
                    <table
                      style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        fontSize: '0.9rem',
                      }}
                    >
                      <thead>
                        {/* Row 1: section group headers */}
                        <tr style={{ borderBottom: 'none' }}>
                          {['Rank', 'Name', 'Country', 'Sail #', 'Type'].map(
                            (h) => (
                              <th
                                key={h}
                                rowSpan={2}
                                style={{
                                  textAlign: 'left',
                                  padding: '9px 12px',
                                  fontWeight: 600,
                                  color: 'var(--navy)',
                                  whiteSpace: 'nowrap',
                                  background: fleetAccent.thead,
                                  borderBottom: `2px solid ${fleetAccent.border}`,
                                  verticalAlign: 'bottom',
                                }}
                              >
                                {h}
                              </th>
                            ),
                          )}
                          {qualRaceCount > 0 && (
                            <th
                              colSpan={qualRaceCount + 1}
                              style={{
                                textAlign: 'center',
                                padding: '4px 10px',
                                fontWeight: 700,
                                fontSize: '0.72rem',
                                textTransform: 'uppercase',
                                letterSpacing: '0.06em',
                                color: '#1a56a0',
                                background: 'rgba(41,98,255,0.1)',
                                borderLeft: '2px solid rgba(41,98,255,0.35)',
                                borderBottom: '1px solid rgba(41,98,255,0.2)',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              Qualifying Series
                            </th>
                          )}
                          {finalRaceCount > 0 && (
                            <th
                              colSpan={finalRaceCount + 1}
                              style={{
                                textAlign: 'center',
                                padding: '4px 10px',
                                fontWeight: 700,
                                fontSize: '0.72rem',
                                textTransform: 'uppercase',
                                letterSpacing: '0.06em',
                                color: 'var(--navy)',
                                background: fleetAccent.thead,
                                borderLeft: '3px solid rgba(0,0,0,0.12)',
                                borderBottom: '1px solid rgba(0,0,0,0.1)',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              Final Series
                            </th>
                          )}
                          {/* Overall column header (SHRS 5.4) — spans both rows */}
                          <th
                            rowSpan={2}
                            style={{
                              textAlign: 'center',
                              padding: '7px 10px',
                              fontWeight: 700,
                              color: 'var(--teal, #2a9d8f)',
                              whiteSpace: 'nowrap',
                              background: 'rgba(42,157,143,0.1)',
                              borderLeft: '2px solid rgba(42,157,143,0.3)',
                              borderBottom: `2px solid ${fleetAccent.border}`,
                              verticalAlign: 'bottom',
                            }}
                          >
                            Overall
                          </th>
                        </tr>
                        {/* Row 2: individual column headers */}
                        <tr
                          style={{
                            background: fleetAccent.thead,
                            borderBottom: `2px solid ${fleetAccent.border}`,
                          }}
                        >
                          {/* Qualifying race column headers */}
                          {Array.from({ length: qualRaceCount }, (_, i) => (
                            <th
                              key={`qh-r${i + 1}`}
                              style={{
                                textAlign: 'center',
                                padding: '7px 10px',
                                fontWeight: 600,
                                color: '#1a56a0',
                                whiteSpace: 'nowrap',
                                background: 'rgba(41,98,255,0.08)',
                                borderLeft:
                                  i === 0
                                    ? '2px solid rgba(41,98,255,0.35)'
                                    : '1px solid rgba(41,98,255,0.12)',
                              }}
                            >
                              Q{i + 1}
                            </th>
                          ))}
                          {/* Qualifying total header */}
                          {qualRaceCount > 0 && (
                            <th
                              style={{
                                textAlign: 'center',
                                padding: '7px 10px',
                                fontWeight: 700,
                                color: '#1a56a0',
                                whiteSpace: 'nowrap',
                                background: 'rgba(41,98,255,0.15)',
                                borderLeft: '1px solid rgba(41,98,255,0.15)',
                                borderRight: '3px solid rgba(41,98,255,0.35)',
                              }}
                            >
                              Q-Tot
                            </th>
                          )}
                          {/* Final series race column headers */}
                          {Array.from({ length: finalRaceCount }, (_, i) => (
                            <th
                              key={`fh-r${i + 1}`}
                              style={{
                                textAlign: 'center',
                                padding: '7px 10px',
                                fontWeight: 600,
                                color: 'var(--navy)',
                                whiteSpace: 'nowrap',
                                background: fleetAccent.thead,
                                borderLeft: '1px solid rgba(0,0,0,0.08)',
                              }}
                            >
                              F{i + 1}
                            </th>
                          ))}
                          {/* Final series total header */}
                          {finalRaceCount > 0 && (
                            <th
                              style={{
                                textAlign: 'center',
                                padding: '7px 10px',
                                fontWeight: 700,
                                color: 'var(--navy)',
                                whiteSpace: 'nowrap',
                                background: fleetAccent.thead,
                                borderLeft: '1px solid rgba(0,0,0,0.12)',
                              }}
                            >
                              F-Tot
                            </th>
                          )
                        }
                        </tr>
                      </thead>
                      <tbody>
                        {groupedLeaderboard[group]?.map((entry, index) => {
                          const qualifyingEntry = eventLeaderboard.find(
                            (e) => e.boat_id === entry.boat_id,
                          );
                          return (
                            <tr
                              key={`boat-${entry.boat_id}-${index}`}
                              onClick={() =>
                                handleCompareRowClick(entry.boat_id)
                              }
                              style={{
                                background: selectedBoatIds.includes(
                                  entry.boat_id,
                                )
                                  ? 'rgba(42, 157, 143, 0.15)'
                                  : index % 2 === 0
                                    ? '#fff'
                                    : 'var(--surface, #f5f7fa)',
                                borderBottom:
                                  '1px solid var(--border, #dde3ea)',
                                cursor: compareMode ? 'pointer' : 'default',
                                outline: selectedBoatIds.includes(entry.boat_id)
                                  ? '2px solid var(--teal, #2a9d8f)'
                                  : 'none',
                                outlineOffset: '-2px',
                              }}
                            >
                              <td
                                style={{
                                  padding: '8px 12px',
                                  fontWeight: 700,
                                  color: 'var(--navy)',
                                }}
                              >
                                {index + 1}
                              </td>
                              <td style={{ padding: '8px 12px' }}>
                                {entry.name} {entry.surname}
                              </td>
                              <td style={{ padding: '8px 12px' }}>
                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                  }}
                                >
                                  <Flag
                                    code={getFlagCode(entry.country)}
                                    style={{ width: '24px' }}
                                  />
                                  {entry.country}
                                </div>
                              </td>
                              <td
                                style={{ padding: '8px 12px', fontWeight: 600 }}
                              >
                                {entry.boat_number}
                              </td>
                              <td
                                style={{ padding: '8px 12px', color: '#555' }}
                              >
                                {entry.boat_type}
                              </td>
                              {/* Qualifying race cells (always read-only) */}
                              {Array.from(
                                { length: qualRaceCount },
                                (_, ri) => {
                                  const qRace = qualifyingEntry?.races?.[ri];
                                  const qStatus =
                                    qualifyingEntry?.race_statuses?.[ri] ||
                                    'FINISHED';
                                  const qIsPenalty =
                                    PENALTY_CODES.includes(qStatus);
                                  const qIsExcluded =
                                    typeof qRace === 'string' &&
                                    qRace?.startsWith('(');
                                  const qRaceId =
                                    qualifyingEntry?.race_ids?.[ri];
                                  const qIsShared =
                                    compareMode &&
                                    (compareInfo?.sharedQualIds?.has(qRaceId) ??
                                      false);
                                  let qDisplay;
                                  let qColor;
                                  if (qIsPenalty && qIsExcluded) {
                                    qDisplay = `(${qStatus})`;
                                    qColor = '#999';
                                  } else if (qIsPenalty) {
                                    qDisplay = qStatus;
                                    qColor = 'var(--danger, #e63946)';
                                  } else if (qIsExcluded) {
                                    qDisplay = qRace;
                                    qColor = '#999';
                                  } else {
                                    qDisplay = qRace ?? '–';
                                    qColor = 'inherit';
                                  }
                                  return (
                                    <td
                                      key={`q-cell-${ri}`}
                                      style={{
                                        padding: '8px 10px',
                                        textAlign: 'center',
                                        background: qIsShared
                                          ? 'rgba(255, 210, 0, 0.3)'
                                          : 'rgba(41,98,255,0.05)',
                                        borderLeft:
                                          ri === 0
                                            ? '2px solid rgba(41,98,255,0.35)'
                                            : '1px solid rgba(41,98,255,0.1)',
                                        color: qColor,
                                        fontWeight:
                                          qIsPenalty && !qIsExcluded
                                            ? 600
                                            : 'inherit',
                                      }}
                                    >
                                      {qDisplay}
                                    </td>
                                  );
                                },
                              )}
                              {/* Qualifying total cell */}
                              {qualRaceCount > 0 && (
                                <td
                                  style={{
                                    padding: '8px 10px',
                                    textAlign: 'center',
                                    fontWeight: 700,
                                    color: '#1a56a0',
                                    background: 'rgba(41,98,255,0.1)',
                                    borderLeft:
                                      '1px solid rgba(41,98,255,0.15)',
                                    borderRight:
                                      '3px solid rgba(41,98,255,0.35)',
                                  }}
                                >
                                  {qualifyingEntry?.computed_total ?? '–'}
                                </td>
                              )}
                              {entry.races?.map((race, raceIndex) => {
                                const raceStatus =
                                  entry.race_statuses?.[raceIndex] ||
                                  'FINISHED';
                                const isPenalty =
                                  PENALTY_CODES.includes(raceStatus);
                                const isRdgCell = RDG_TYPES.includes(raceStatus);
                                const isExcluded =
                                  typeof race === 'string' &&
                                  race.startsWith('(');
                                let displayText;
                                let displayColor;
                                if (isRdgCell && isExcluded) {
                                  displayText = `(${race.replace(/[()]/g, '')}) ${raceStatus}`;
                                  displayColor = '#888';
                                } else if (isRdgCell) {
                                  displayText = `${race} ${raceStatus}`;
                                  displayColor = 'var(--teal, #2a9d8f)';
                                } else if (isPenalty && isExcluded) {
                                  displayText = `(${raceStatus})`;
                                  displayColor = '#999';
                                } else if (isPenalty) {
                                  displayText = raceStatus;
                                  displayColor = 'var(--danger, #e63946)';
                                } else if (isExcluded) {
                                  displayText = race;
                                  displayColor = '#999';
                                } else {
                                  displayText = race;
                                  displayColor = 'inherit';
                                }
                                const raceId = entry.race_ids?.[raceIndex];
                                const isShared =
                                  compareMode &&
                                  selectedBoatIds.length === 2 &&
                                  selectedBoatIds.includes(entry.boat_id);
                                const pickerKey = `${entry.boat_id}-${raceIndex}`;
                                const isRdg2Picking =
                                  rdg2Picker?.boatId === entry.boat_id &&
                                  rdg2Picker?.raceIndex === raceIndex;
                                return (
                                  <td
                                    key={`entry-race-${entry.boat_id}-${raceIndex}`}
                                    style={{
                                      padding: '8px 12px',
                                      textAlign: 'center',
                                      background: isShared
                                        ? 'rgba(255, 210, 0, 0.3)'
                                        : editMode
                                          ? 'var(--surface,#f5f7fa)'
                                          : 'transparent',
                                    }}
                                  >
                                    {editMode ? (
                                      <div
                                        style={{
                                          display: 'flex',
                                          flexDirection: 'column',
                                          gap: '2px',
                                          alignItems: 'center',
                                          position: 'relative',
                                        }}
                                      >
                                        <input
                                          type="number"
                                          value={
                                            typeof race === 'string'
                                              ? race.replace(/[()]/g, '')
                                              : race
                                          }
                                          disabled={isPenalty && raceStatus !== 'RDG3'}
                                          onChange={(e) =>
                                            handleRaceChange(
                                              entry.boat_id,
                                              raceIndex,
                                              e.target.value,
                                              raceStatus === 'RDG3' ? 'RDG3' : 'FINISHED',
                                            )
                                          }
                                          style={{
                                            width: '50px',
                                            padding: '3px 5px',
                                            borderRadius: '4px',
                                            border:
                                              '1px solid var(--border,#dde3ea)',
                                            opacity: (isPenalty && raceStatus !== 'RDG3') ? 0.35 : 1,
                                          }}
                                        />
                                        <select
                                          value={raceStatus}
                                          onChange={(e) => {
                                            if (e.target.value === 'RDG2') {
                                              const rect = e.target.getBoundingClientRect();
                                              setRdg2Picker({ boatId: entry.boat_id, raceIndex, selectedIndices: new Set(), selectedQualIndices: new Set(), anchorRect: rect });
                                            } else {
                                              handleRaceChange(entry.boat_id, raceIndex, null, e.target.value);
                                            }
                                          }}
                                          style={{
                                            width: '80px',
                                            fontSize: '0.72rem',
                                            borderRadius: '4px',
                                            border:
                                              '1px solid var(--border,#dde3ea)',
                                            padding: '2px',
                                            color:
                                              isRdgCell
                                                ? 'var(--teal,#2a9d8f)'
                                                : isPenalty
                                                  ? 'var(--danger,#e63946)'
                                                  : 'var(--navy)',
                                          }}
                                        >
                                          <option value="FINISHED">
                                            Finish
                                          </option>
                                          {PENALTY_CODES.filter(
                                            (code) => !RDG_TYPES.includes(code),
                                          ).map((code) => (
                                            <option key={code} value={code}>
                                              {code}
                                            </option>
                                          ))}
                                          <optgroup label="RDG – Redress">
                                            <option value="RDG1">RDG1 – avg all</option>
                                            <option value="RDG2">RDG2 – avg select</option>
                                            <option value="RDG3">RDG3 – manual</option>
                                          </optgroup>
                                        </select>
                                        {isRdg2Picking && rdg2Picker.anchorRect && (
                                          <div style={{
                                            position: 'fixed',
                                            top: rdg2Picker.anchorRect.bottom + 4,
                                            left: rdg2Picker.anchorRect.left,
                                            zIndex: 9999,
                                            background: '#fff',
                                            border: '1px solid var(--teal,#2a9d8f)',
                                            borderRadius: '8px',
                                            padding: '10px 14px',
                                            minWidth: '240px',
                                            width: 'max-content',
                                            boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
                                          }}>
                                            <div style={{ fontWeight: 700, fontSize: '0.82rem', marginBottom: '8px', color: 'var(--teal,#2a9d8f)' }}>
                                              Select races for RDG2
                                            </div>
                                            <div style={{ maxHeight: '300px', overflowY: 'auto', marginBottom: '8px' }}>
                                              {/* Qualifying races */}
                                              {qualifyingEntry?.races?.length > 0 && (
                                                <>
                                                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#888', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Qualifying</div>
                                                  {qualifyingEntry.races.map((_, qIdx) => {
                                                    const checked = rdg2Picker.selectedQualIndices?.has(qIdx) ?? false;
                                                    return (
                                                      <label key={`q-${qIdx}`} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', cursor: 'pointer', marginBottom: '5px', padding: '3px 4px', borderRadius: '4px', background: checked ? 'rgba(42,157,143,0.08)' : 'transparent' }}>
                                                        <input
                                                          type="checkbox"
                                                          checked={checked}
                                                          onChange={() => {
                                                            const newSet = new Set(rdg2Picker.selectedQualIndices || []);
                                                            if (checked) newSet.delete(qIdx); else newSet.add(qIdx);
                                                            setRdg2Picker({ ...rdg2Picker, selectedQualIndices: newSet });
                                                          }}
                                                        />
                                                        Q{qIdx + 1}
                                                      </label>
                                                    );
                                                  })}
                                                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#888', margin: '6px 0 4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Final</div>
                                                </>
                                              )}
                                              {/* Final races */}
                                              {entry.races.map((_, rIdx) => {
                                                if (rIdx === raceIndex) return null;
                                                const checked = rdg2Picker.selectedIndices.has(rIdx);
                                                return (
                                                  <label key={`f-${rIdx}`} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', cursor: 'pointer', marginBottom: '5px', padding: '3px 4px', borderRadius: '4px', background: checked ? 'rgba(42,157,143,0.08)' : 'transparent' }}>
                                                    <input
                                                      type="checkbox"
                                                      checked={checked}
                                                      onChange={() => {
                                                        const newSet = new Set(rdg2Picker.selectedIndices);
                                                        if (checked) newSet.delete(rIdx); else newSet.add(rIdx);
                                                        setRdg2Picker({ ...rdg2Picker, selectedIndices: newSet });
                                                      }}
                                                    />
                                                    F{rIdx + 1}
                                                  </label>
                                                );
                                              })}
                                            </div>
                                            <div style={{ display: 'flex', gap: '6px' }}>
                                              <button
                                                type="button"
                                                onClick={confirmRdg2}
                                                disabled={(rdg2Picker.selectedIndices.size + (rdg2Picker.selectedQualIndices?.size ?? 0)) === 0}
                                                style={{ flex: 1, fontSize: '0.8rem', padding: '5px 8px', borderRadius: '5px', background: 'var(--teal,#2a9d8f)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600, opacity: (rdg2Picker.selectedIndices.size + (rdg2Picker.selectedQualIndices?.size ?? 0)) === 0 ? 0.4 : 1 }}
                                              >Apply</button>
                                              <button type="button" onClick={() => setRdg2Picker(null)} style={{ flex: 1, fontSize: '0.8rem', padding: '5px 8px', borderRadius: '5px', background: 'var(--surface,#f5f7fa)', border: '1px solid var(--border,#dde3ea)', cursor: 'pointer' }}>Cancel</button>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      <span
                                        style={{
                                          color: displayColor,
                                          fontWeight:
                                            isPenalty && !isExcluded
                                              ? 600
                                              : 'inherit',
                                        }}
                                      >
                                        {displayText}
                                      </span>
                                    )}
                                  </td>
                                );
                              })}
                              {/* Final series total cell */}
                              {finalRaceCount > 0 && (
                                <td
                                  style={{
                                    padding: '8px 10px',
                                    textAlign: 'center',
                                    fontWeight: 700,
                                    color: 'var(--navy)',
                                    borderLeft: '1px solid rgba(0,0,0,0.1)',
                                  }}
                                >
                                  {entry.computed_total ?? '–'}
                                </td>
                              )}
                              {/* Overall combined total cell (SHRS 5.4: qualifying + final) */}
                              <td
                                style={{
                                  padding: '8px 10px',
                                  textAlign: 'center',
                                  fontWeight: 700,
                                  color: 'var(--teal, #2a9d8f)',
                                  background: 'rgba(42,157,143,0.05)',
                                  borderLeft: '2px solid rgba(42,157,143,0.3)',
                                }}
                              >
                                {entry.total_points_combined != null &&
                                !Number.isNaN(entry.total_points_combined)
                                  ? entry.total_points_combined
                                  : '–'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })
          )}
        </>
      )}

      {/* RDG Legend — shown in edit mode when any RDG redress entries exist */}
      {editMode && (() => {
        const src = finalSeriesStarted && activeTab !== 'event'
          ? editableLeaderboard
          : editableLeaderboard;
        const rdgEntries = src.flatMap((entry) =>
          (entry.race_statuses || [])
            .map((status, ri) => ({ status, ri, entry }))
            .filter(({ status }) => RDG_TYPES.includes(status))
        );
        if (rdgEntries.length === 0) return null;
        return (
          <div style={{ marginTop: '12px', padding: '10px 14px', background: 'rgba(42,157,143,0.07)', borderRadius: '8px', border: '1px solid rgba(42,157,143,0.25)', marginBottom: '6px' }}>
            <div style={{ fontWeight: 700, fontSize: '0.78rem', marginBottom: '6px', color: 'var(--teal,#2a9d8f)' }}>
              RDG – Redress Legend
            </div>
            {rdgEntries.map(({ status, ri, entry }) => {
              const key = `${entry.boat_id}-${ri}`;
              const meta = rdgMeta[key];
              const score = entry.races?.[ri];
              const desc =
                status === 'RDG1'
                  ? 'Average of all series races'
                  : status === 'RDG2'
                    ? `Average of selected races${meta?.selectedRaceLabels ? ': ' + meta.selectedRaceLabels.join(', ') : ''}`
                    : 'Manual entry';
              return (
                <div key={key} style={{ fontSize: '0.82rem', color: '#444', marginBottom: '3px' }}>
                  <strong style={{ color: 'var(--teal,#2a9d8f)' }}>{status}</strong>{' '}
                  {entry.name} {entry.surname} — R{ri + 1}: {desc} ={' '}
                  <strong>{score}</strong>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Compare info panel — always rendered so it works in both qualifying and final series */}
      {compareMode && !compareInfo && (
        <div
          style={{
            marginTop: '10px',
            padding: '9px 14px',
            borderRadius: '8px',
            border: '1px solid var(--border, #dde3ea)',
            background: 'var(--surface, #f5f7fa)',
            fontSize: '0.83rem',
            color: '#888',
            marginBottom: '8px',
          }}
        >
          {selectedBoatIds.length === 0
            ? 'Click two rows to compare (SHRS 5.6 tie-breaking).'
            : 'Select one more competitor to compare.'}
        </div>
      )}
      {compareInfo && (
        <div
          style={{
            marginTop: '12px',
            padding: '14px 16px',
            borderRadius: '8px',
            border: '1px solid var(--border, #dde3ea)',
            background: 'var(--surface, #f5f7fa)',
            fontSize: '0.85rem',
            color: 'var(--navy)',
            marginBottom: '8px',
          }}
        >
          {/* Header: names + totals */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flexWrap: 'wrap',
              marginBottom: '10px',
            }}
          >
            <span
              style={{
                fontWeight: 700,
                fontSize: '0.95rem',
                color: 'var(--teal, #2a9d8f)',
              }}
            >
              {compareInfo.boatA.name} {compareInfo.boatA.surname}
            </span>
            <span
              style={{
                padding: '1px 8px',
                borderRadius: '4px',
                background: 'var(--navy, #1d3557)',
                color: '#fff',
                fontWeight: 700,
                fontSize: '0.92rem',
              }}
            >
              {compareInfo.totalA}
            </span>
            <span style={{ color: '#aaa', fontWeight: 400 }}>vs</span>
            <span
              style={{
                fontWeight: 700,
                fontSize: '0.95rem',
                color: 'var(--teal, #2a9d8f)',
              }}
            >
              {compareInfo.boatB.name} {compareInfo.boatB.surname}
            </span>
            <span
              style={{
                padding: '1px 8px',
                borderRadius: '4px',
                background: 'var(--navy, #1d3557)',
                color: '#fff',
                fontWeight: 700,
                fontSize: '0.92rem',
              }}
            >
              {compareInfo.totalB}
            </span>
          </div>

          {/* Not tied */}
          {!compareInfo.tied && (
            <div
              style={{
                padding: '6px 10px',
                borderRadius: '6px',
                background: 'rgba(42,157,143,0.1)',
                border: '1px solid rgba(42,157,143,0.25)',
                marginBottom: '8px',
              }}
            >
              <strong>
                {compareInfo.totalA < compareInfo.totalB
                  ? `${compareInfo.boatA.name} ${compareInfo.boatA.surname}`
                  : `${compareInfo.boatB.name} ${compareInfo.boatB.surname}`}
              </strong>{' '}
              leads by{' '}
              <strong>
                {Math.abs(compareInfo.totalA - compareInfo.totalB)} pt
                {Math.abs(compareInfo.totalA - compareInfo.totalB) !== 1
                  ? 's'
                  : ''}
              </strong>
              . No tie — tie-breaking not required.
            </div>
          )}

          {/* Tied */}
          {compareInfo.tied && compareInfo.tieBreak && (
            <div
              style={{
                padding: '6px 10px',
                borderRadius: '6px',
                background: 'rgba(255,150,0,0.08)',
                border: '1px solid rgba(255,150,0,0.3)',
                marginBottom: '8px',
                lineHeight: 1.5,
              }}
            >
              <span
                style={{
                  fontWeight: 700,
                  color: 'darkorange',
                  marginRight: '6px',
                }}
              >
                TIED — {compareInfo.tieBreak.rule}
              </span>
              <span style={{ color: '#666', fontSize: '0.82rem' }}>
                ({compareInfo.tieBreak.detail})
              </span>
              <br />
              {compareInfo.tieBreak.winner ? (
                <span>
                  Tie broken in favour of{' '}
                  <strong>
                    {compareInfo.tieBreak.winner.name}{' '}
                    {compareInfo.tieBreak.winner.surname}
                  </strong>
                  .
                </span>
              ) : (
                <span style={{ color: '#888' }}>
                  Still tied after applying {compareInfo.tieBreak.rule}.
                </span>
              )}
            </div>
          )}

          {/* Shared race score badges */}
          {(compareInfo.sharedQualRacePairs?.length > 0 ||
            compareInfo.sharedIds.size > 0) && (
            <div>
              <span style={{ color: '#888', fontSize: '0.82rem' }}>
                Shared heat races (highlighted):{' '}
              </span>
              {/* Qualifying shared races */}
              {compareInfo.sharedQualRacePairs?.map((pair, i) => (
                <span
                  key={`q-${pair.raceId}`}
                  style={{
                    display: 'inline-block',
                    margin: '2px 3px',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    background: 'rgba(41,98,255,0.15)',
                    border: '1px solid rgba(41,98,255,0.3)',
                    fontWeight: 600,
                    fontSize: '0.83rem',
                  }}
                >
                  Q{i + 1}: {pair.displayA}{' '}
                  <span style={{ color: '#aaa', fontWeight: 400 }}>vs</span>{' '}
                  {pair.displayB}
                </span>
              ))}
              {/* Final shared races */}
              {compareInfo.sharedRacePairs.map((pair, i) => (
                <span
                  key={`f-${pair.raceId}`}
                  style={{
                    display: 'inline-block',
                    margin: '2px 3px',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    background: 'rgba(255,210,0,0.35)',
                    border: '1px solid rgba(180,150,0,0.25)',
                    fontWeight: 600,
                    fontSize: '0.83rem',
                  }}
                >
                  F{i + 1}: {pair.displayA}{' '}
                  <span style={{ color: '#aaa', fontWeight: 400 }}>vs</span>{' '}
                  {pair.displayB}
                </span>
              ))}
            </div>
          )}
          {compareInfo.sharedQualRacePairs?.length === 0 &&
            compareInfo.sharedIds.size === 0 && (
              <div
                style={{
                  color: '#888',
                  fontSize: '0.82rem',
                  marginTop: '2px',
                }}
              >
                No shared heats found.
                {compareInfo.tied
                  ? ' SHRS 5.6(ii)(b): full RRS A8.1 & A8.2 apply without modification.'
                  : ''}
              </div>
            )}
        </div>
      )}
    </div>
  );
}

LeaderboardComponent.propTypes = {
  eventId: PropTypes.number.isRequired,
};

export default LeaderboardComponent;
