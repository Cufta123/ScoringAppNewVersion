/* eslint-disable camelcase */
import { useState, useEffect, useCallback, useMemo } from 'react';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import {
  PENALTY_CODES,
  RDG_TYPES,
  GROUP_ORDER,
  parseRaceNum,
  applyExclusions,
  processLeaderboardEntry,
  getFlagCode,
} from '../utils/leaderboardUtils';

export default function useLeaderboard(eventId) {
  const [leaderboard, setLeaderboard] = useState([]);
  const [eventLeaderboard, setEventLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [finalSeriesStarted, setFinalSeriesStarted] = useState(false);
  const [activeTab, setActiveTab] = useState('event'); // 'event' | 'final'
  const [editMode, setEditMode] = useState(false);
  const [editableLeaderboard, setEditableLeaderboard] = useState([]);
  const [overallLeaderboard, setOverallLeaderboard] = useState([]);
  const [shiftPositions, setShiftPositions] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [selectedBoatIds, setSelectedBoatIds] = useState([]);
  // rdgMeta stores per-cell info: { type, selectedRaceLabels? }
  // key is `${boatId}-${raceIndex}`
  const [rdgMeta, setRdgMeta] = useState({});
  // rdg2Picker: the open multi-race selector state for one specific cell
  const [rdg2Picker, setRdg2Picker] = useState(null);

  // ─── Compare ────────────────────────────────────────────────────────────────

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
    const allEntries = finalSeriesStarted ? leaderboard : eventLeaderboard;

    const boatA = allEntries.find((e) => e.boat_id === selectedBoatIds[0]);
    const boatB = allEntries.find((e) => e.boat_id === selectedBoatIds[1]);
    if (!boatA || !boatB) return null;

    const sharedIds = new Set(
      boatA.race_ids.filter((id) => boatB.race_ids.includes(id)),
    );

    const totalA = finalSeriesStarted
      ? (boatA.total_points_combined ?? boatA.computed_total ?? 0)
      : (boatA.computed_total ?? 0);
    const totalB = finalSeriesStarted
      ? (boatB.total_points_combined ?? boatB.computed_total ?? 0)
      : (boatB.computed_total ?? 0);
    const tied = totalA === totalB;

    const parseScore = (val) => {
      if (val === undefined || val === null) return null;
      const str = String(val).replace(/[()]/g, '');
      const n = parseFloat(str);
      return Number.isNaN(n) ? null : n;
    };

    const sharedRacePairs = [...sharedIds].map((raceId) => {
      const riA = boatA.race_ids.indexOf(raceId);
      const riB = boatB.race_ids.indexOf(raceId);
      const scoreA = parseScore(boatA.races?.[riA]);
      const scoreB = parseScore(boatB.races?.[riB]);
      return {
        raceId,
        scoreA,
        scoreB,
        displayA: scoreA ?? '–',
        displayB: scoreB ?? '–',
      };
    });

    // Compute shared qualifying race IDs from the eventLeaderboard entries
    const qualA = eventLeaderboard.find(
      (e) => e.boat_id === selectedBoatIds[0],
    );
    const qualB = eventLeaderboard.find(
      (e) => e.boat_id === selectedBoatIds[1],
    );
    const sharedQualIds =
      finalSeriesStarted && qualA && qualB
        ? new Set(qualA.race_ids.filter((id) => qualB.race_ids.includes(id)))
        : new Set();
    const sharedQualRacePairs =
      finalSeriesStarted && qualA && qualB
        ? [...sharedQualIds].map((raceId) => {
            const riA = qualA.race_ids.indexOf(raceId);
            const riB = qualB.race_ids.indexOf(raceId);
            const scoreA = parseScore(qualA.races?.[riA]);
            const scoreB = parseScore(qualB.races?.[riB]);
            return {
              raceId,
              scoreA,
              scoreB,
              displayA: scoreA ?? '–',
              displayB: scoreB ?? '–',
            };
          })
        : [];

    // RRS A8.1: sort each boat's scores best-to-worst (ascending), compare pairwise
    const a81 = (pairs) => {
      if (pairs.length === 0) return null;
      const validPairs = pairs.filter(
        (p) => p.scoreA !== null && p.scoreB !== null,
      );
      if (validPairs.length === 0) return null;
      const sortedA = [...validPairs.map((p) => p.scoreA)].sort(
        (x, y) => x - y,
      );
      const sortedB = [...validPairs.map((p) => p.scoreB)].sort(
        (x, y) => x - y,
      );
      for (let i = 0; i < sortedA.length; i++) {
        if (sortedA[i] < sortedB[i])
          return {
            winner: boatA,
            rule: 'RRS A8.1',
            detail: `best score ${sortedA[i]} < ${sortedB[i]}`,
          };
        if (sortedB[i] < sortedA[i])
          return {
            winner: boatB,
            rule: 'RRS A8.1',
            detail: `best score ${sortedB[i]} < ${sortedA[i]}`,
          };
      }
      return null;
    };

    // RRS A8.2: compare last race, then second-to-last, etc.
    const a82 = (pairs) => {
      if (pairs.length === 0) return null;
      const validPairs = pairs.filter(
        (p) => p.scoreA !== null && p.scoreB !== null,
      );
      if (validPairs.length === 0) return null;
      for (let i = validPairs.length - 1; i >= 0; i--) {
        const { scoreA, scoreB } = validPairs[i];
        if (scoreA < scoreB)
          return {
            winner: boatA,
            rule: 'RRS A8.2',
            detail: `last race ${scoreA} < ${scoreB}`,
          };
        if (scoreB < scoreA)
          return {
            winner: boatB,
            rule: 'RRS A8.2',
            detail: `last race ${scoreB} < ${scoreA}`,
          };
      }
      return null;
    };

    let tieBreak = null;
    if (tied) {
      const allPairs = finalSeriesStarted
        ? [...(sharedQualRacePairs || []), ...sharedRacePairs]
        : sharedRacePairs;
      tieBreak = a81(allPairs) ||
        a82(allPairs) || {
          rule: 'RRS A8.1 & A8.2',
          detail: 'No shared heats or all scores identical',
          winner: null,
        };
    }

    return {
      boatA,
      boatB,
      totalA,
      totalB,
      tied,
      tieBreak,
      sharedIds,
      sharedRacePairs,
      sharedQualIds,
      sharedQualRacePairs,
    };
  }, [selectedBoatIds, finalSeriesStarted, eventLeaderboard, leaderboard]);

  // ─── Data fetching ───────────────────────────────────────────────────────────

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

      const eventLeaderboardWithRaces = eventResults
        .map(processLeaderboardEntry)
        .sort((a, b) => (a.place ?? Infinity) - (b.place ?? Infinity));
      setEventLeaderboard(eventLeaderboardWithRaces);

      const results = finalSeriesStarted ? finalResults : eventResults;
      const leaderboardWithRaces = results.map(processLeaderboardEntry);

      if (finalSeriesStarted) {
        setOverallLeaderboard(overallResults);
      }

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
            : entry.computed_total +
              (eventEntry ? eventEntry.computed_total : 0);
          return {
            ...entry,
            total_points_combined,
            qualifying_points:
              overallEntry?.qualifying_points ??
              eventEntry?.computed_total ??
              0,
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

      setLeaderboard(mergedResults);
      setEditableLeaderboard(JSON.parse(JSON.stringify(mergedResults)));
    } catch (error) {
      console.error('Error fetching leaderboard:', error.message);
    } finally {
      setLoading(false);
    }
  }, [eventId, finalSeriesStarted]);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  // ─── Edit mode ───────────────────────────────────────────────────────────────

  const toggleEditMode = () => {
    const source = finalSeriesStarted ? leaderboard : eventLeaderboard;
    setEditableLeaderboard(JSON.parse(JSON.stringify(source)));
    setRdgMeta({});
    setRdg2Picker(null);
    setEditMode(!editMode);
  };

  const computeRdgAverage = (
    races,
    statuses,
    excludeIdx,
    penaltyPos,
    selectedIndices = null,
  ) => {
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
    const sum = candidates.reduce(
      (s, { val }) => s + (Number.isNaN(val) ? 0 : val),
      0,
    );
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

    if (newStatus === 'RDG2') return;

    if (!isPenalty && (Number.isNaN(numericInput) || numericInput < 0)) return;
    if (
      newStatus === 'RDG3' &&
      newRaceValue !== null &&
      Number.isNaN(numericInput)
    )
      return;

    const cloned = JSON.parse(JSON.stringify(editableLeaderboard));
    const penaltyPosition = cloned.length + 1;

    let newPosition;
    if (newStatus === 'RDG1') {
      const entry = cloned.find((e) => e.boat_id === boatId);
      newPosition = entry
        ? computeRdgAverage(
            entry.races,
            entry.race_statuses,
            raceIndex,
            penaltyPosition,
          )
        : penaltyPosition;
      setRdgMeta((prev) => ({
        ...prev,
        [`${boatId}-${raceIndex}`]: { type: 'RDG1' },
      }));
    } else if (newStatus === 'RDG3') {
      if (newRaceValue === null) {
        const existingEntry = cloned.find((e) => e.boat_id === boatId);
        const raw = existingEntry
          ? parseFloat(
              String(existingEntry.races[raceIndex]).replace(/[()]/g, ''),
            )
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

    const targetEntry = cloned.find((e) => e.boat_id === boatId);
    if (!targetEntry) return;
    const oldPosition = parseRaceNum(targetEntry.races[raceIndex]);

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

  const confirmRdg2 = () => {
    if (!rdg2Picker) return;
    const { boatId, raceIndex, selectedIndices, selectedQualIndices } =
      rdg2Picker;
    const cloned = JSON.parse(JSON.stringify(editableLeaderboard));
    const entry = cloned.find((e) => e.boat_id === boatId);
    if (!entry) {
      setRdg2Picker(null);
      return;
    }

    const penaltyPosition = cloned.length + 1;

    const finalValues = [...(selectedIndices || new Set())]
      .filter((i) => i !== raceIndex)
      .map((i) => {
        const status = entry.race_statuses?.[i] || 'FINISHED';
        if (PENALTY_CODES.includes(status)) return null;
        return parseFloat(String(entry.races[i]).replace(/[()]/g, ''));
      })
      .filter((v) => v !== null && !Number.isNaN(v));

    const qualEntry = eventLeaderboard?.find((e) => e.boat_id === boatId);
    const qualValues = [...(selectedQualIndices || new Set())]
      .map((i) => {
        const status = qualEntry?.race_statuses?.[i] || 'FINISHED';
        if (PENALTY_CODES.includes(status)) return null;
        return parseFloat(
          String(qualEntry?.races?.[i] ?? '').replace(/[()]/g, ''),
        );
      })
      .filter((v) => v !== null && !Number.isNaN(v));

    const allValues = [...qualValues, ...finalValues];
    const avg =
      allValues.length > 0
        ? Math.round(
            (allValues.reduce((s, v) => s + v, 0) / allValues.length) * 10,
          ) / 10
        : penaltyPosition;

    const entryStatuses = [
      ...(entry.race_statuses || entry.races.map(() => 'FINISHED')),
    ];
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

    const qualLabels = [...(selectedQualIndices || new Set())]
      .sort((a, b) => a - b)
      .map((i) => `Q${i + 1}`);
    const finalLabels = [...(selectedIndices || new Set())]
      .sort((a, b) => a - b)
      .map((i) => `F${i + 1}`);
    const selectedRaceLabels = [...qualLabels, ...finalLabels];
    setRdgMeta((prev) => ({
      ...prev,
      [`${boatId}-${raceIndex}`]: { type: 'RDG2', selectedRaceLabels },
    }));
    setEditableLeaderboard(
      cloned.map((e) => (e.boat_id === boatId ? updatedEntry : e)),
    );
    setRdg2Picker(null);
  };

  const handleSave = async () => {
    try {
      if (!editableLeaderboard || !leaderboard) {
        throw new Error('Leaderboard data is not initialized');
      }

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

      const originalSource =
        activeTab === 'event' ? eventLeaderboard : leaderboard;
      for (const entry of updatedLeaderboard) {
        const originalEntry = originalSource.find(
          (e) => e.boat_id === entry.boat_id,
        );
        if (!originalEntry) continue;

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
      if (finalSeriesStarted && activeTab !== 'event') {
        await window.electron.sqlite.heatRaceDB.updateFinalLeaderboard(eventId);
      }

      await fetchLeaderboard();
      setEditMode(false);
    } catch (error) {
      console.error('Error saving leaderboard:', error.message);
    }
  };

  // ─── Excel export ────────────────────────────────────────────────────────────

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

    const groupedLeaderboard = editableLeaderboard?.reduce((acc, entry) => {
      const group = entry.placement_group || 'General';
      if (!acc[group]) acc[group] = [];
      acc[group].push(entry);
      return acc;
    }, {});
    const sortedGroups = Object.keys(groupedLeaderboard || {}).sort(
      (a, b) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b),
    );

    if (finalSeriesStarted) {
      sortedGroups.forEach((group) => {
        worksheet.addRow([`${group} Group`]);
        groupedLeaderboard[group]?.forEach((entry, index) => {
          worksheet.addRow([
            index + 1,
            `${entry.name} ${entry.surname}`,
            entry.country,
            entry.boat_number,
            entry.boat_type,
            ...entry.races,
            entry.computed_total ?? entry.total_points_final,
          ]);
        });
      });
    } else {
      leaderboard.forEach((entry, index) => {
        worksheet.addRow([
          index + 1,
          `${entry.name} ${entry.surname}`,
          entry.country,
          entry.boat_number,
          entry.boat_type,
          ...entry.races,
          entry.computed_total ?? entry.total_points_event,
        ]);
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    saveAs(blob, 'leaderboard.xlsx');
  };

  // ─── Derived values ──────────────────────────────────────────────────────────

  const hasEventData = eventLeaderboard.length > 0;
  const hasFinalData = leaderboard.length > 0;

  const groupedLeaderboard = useMemo(
    () =>
      editableLeaderboard?.reduce((acc, entry) => {
        const group = entry.placement_group || 'General';
        if (!acc[group]) acc[group] = [];
        acc[group].push(entry);
        return acc;
      }, {}) || {},
    [editableLeaderboard],
  );

  const sortedGroups = useMemo(
    () =>
      Object.keys(groupedLeaderboard).sort(
        (a, b) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b),
      ),
    [groupedLeaderboard],
  );

  return {
    // State
    leaderboard,
    eventLeaderboard,
    loading,
    finalSeriesStarted,
    activeTab,
    editMode,
    editableLeaderboard,
    overallLeaderboard,
    shiftPositions,
    compareMode,
    selectedBoatIds,
    rdgMeta,
    rdg2Picker,
    // Derived
    hasEventData,
    hasFinalData,
    groupedLeaderboard,
    sortedGroups,
    compareInfo,
    // Setters
    setShiftPositions,
    setCompareMode,
    setSelectedBoatIds,
    setRdg2Picker,
    // Actions
    toggleEditMode,
    handleSave,
    handleRaceChange,
    confirmRdg2,
    handleCompareRowClick,
    exportToExcel,
    getFlagCode,
  };
}
