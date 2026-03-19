/* eslint-disable camelcase */
import { useState, useEffect, useCallback, useMemo } from 'react';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  PENALTY_CODES,
  RDG_TYPES,
  GROUP_ORDER,
  parseRaceNum,
  applyExclusions,
  processLeaderboardEntry,
  getFlagCode,
  getRaceCellDisplay,
} from '../utils/leaderboardUtils';
import { reportError } from '../utils/userFeedback';

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

  const sanitizeFilenamePart = (value, fallback = 'event') => {
    const raw = String(value ?? '').trim();
    const safe = raw.replace(/[<>:"/\\|?*]+/g, '_').replace(/\s+/g, '_');
    return safe || fallback;
  };

  const getExportMeta = async () => {
    let eventName = `event_${eventId}`;
    try {
      const events = await window.electron.sqlite.eventDB.readAllEvents();
      if (Array.isArray(events)) {
        const match = events.find(
          (event) => String(event.event_id) === String(eventId),
        );
        if (match?.event_name) {
          eventName = match.event_name;
        }
      }
    } catch (_) {
      // keep fallback name
    }

    const raceNumber = finalSeriesStarted
      ? (editableLeaderboard?.[0]?.races?.length ?? 0)
      : (eventLeaderboard?.[0]?.races?.length ?? 0);

    const safeEventName = sanitizeFilenamePart(eventName, `event_${eventId}`);
    const seriesLabel = finalSeriesStarted ? 'final' : 'race';
    return {
      safeEventName,
      raceNumber,
      seriesLabel,
    };
  };

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
      const rawA = boatA.races?.[riA];
      const rawB = boatB.races?.[riB];
      const scoreA = parseScore(rawA);
      const scoreB = parseScore(rawB);
      return {
        raceId,
        scoreA,
        scoreB,
        excludedA: typeof rawA === 'string' && rawA.startsWith('('),
        excludedB: typeof rawB === 'string' && rawB.startsWith('('),
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
            const rawA = qualA.races?.[riA];
            const rawB = qualB.races?.[riB];
            const scoreA = parseScore(rawA);
            const scoreB = parseScore(rawB);
            return {
              raceId,
              scoreA,
              scoreB,
              excludedA: typeof rawA === 'string' && rawA.startsWith('('),
              excludedB: typeof rawB === 'string' && rawB.startsWith('('),
              displayA: scoreA ?? '–',
              displayB: scoreB ?? '–',
            };
          })
        : [];

    // ── Tie-breaking helpers ──────────────────────────────────────────────

    // A8.1 on race pairs. When useExcluded is false, pairs with excluded
    // scores are filtered out (standard A8.1). When true, all scores are
    // kept (SHRS 5.6(ii)(a)(2) modification).
    const applyA81OnPairs = (pairs, useExcluded) => {
      let filtered = pairs.filter(
        (p) => p.scoreA !== null && p.scoreB !== null,
      );
      if (!useExcluded) {
        filtered = filtered.filter((p) => !p.excludedA && !p.excludedB);
      }
      if (filtered.length === 0) return null;
      const sortedA = [...filtered.map((p) => p.scoreA)].sort((x, y) => x - y);
      const sortedB = [...filtered.map((p) => p.scoreB)].sort((x, y) => x - y);
      for (let i = 0; i < sortedA.length; i += 1) {
        if (sortedA[i] < sortedB[i])
          return {
            winner: boatA,
            detail: `best-to-worst: ${sortedA[i]} vs ${sortedB[i]} at position ${i + 1}`,
          };
        if (sortedB[i] < sortedA[i])
          return {
            winner: boatB,
            detail: `best-to-worst: ${sortedB[i]} vs ${sortedA[i]} at position ${i + 1}`,
          };
      }
      return null;
    };

    // A8.2: compare last race, then second-to-last, etc.
    const applyA82OnPairs = (pairs) => {
      const valid = pairs.filter((p) => p.scoreA !== null && p.scoreB !== null);
      if (valid.length === 0) return null;
      for (let i = valid.length - 1; i >= 0; i -= 1) {
        const { scoreA, scoreB } = valid[i];
        if (scoreA < scoreB)
          return {
            winner: boatA,
            detail: `last-race-backward: ${scoreA} vs ${scoreB}`,
          };
        if (scoreB < scoreA)
          return {
            winner: boatB,
            detail: `last-race-backward: ${scoreB} vs ${scoreA}`,
          };
      }
      return null;
    };

    // A8.1 / A8.2 on individual boat score arrays (for when boats have no
    // shared heats and we must compare each boat's own race list).
    const parseScoreEntry = (val) => ({
      score: parseScore(val),
      excluded: typeof val === 'string' && val.startsWith('('),
    });

    const applyA81Individual = (aEntries, bEntries, useExcluded) => {
      const sA = useExcluded ? aEntries : aEntries.filter((s) => !s.excluded);
      const sB = useExcluded ? bEntries : bEntries.filter((s) => !s.excluded);
      const vA = sA
        .filter((s) => s.score !== null)
        .map((s) => s.score)
        .sort((x, y) => x - y);
      const vB = sB
        .filter((s) => s.score !== null)
        .map((s) => s.score)
        .sort((x, y) => x - y);
      if (vA.length === 0 || vB.length === 0) return null;
      const maxLen = Math.max(vA.length, vB.length);
      for (let i = 0; i < maxLen; i += 1) {
        const a = i < vA.length ? vA[i] : Infinity;
        const b = i < vB.length ? vB[i] : Infinity;
        if (a < b)
          return {
            winner: boatA,
            detail: `best-to-worst: ${a} vs ${b} at position ${i + 1}`,
          };
        if (b < a)
          return {
            winner: boatB,
            detail: `best-to-worst: ${b} vs ${a} at position ${i + 1}`,
          };
      }
      return null;
    };

    const applyA82Individual = (aEntries, bEntries) => {
      const vA = aEntries.filter((s) => s.score !== null);
      const vB = bEntries.filter((s) => s.score !== null);
      const maxLen = Math.max(vA.length, vB.length);
      for (let i = maxLen - 1; i >= 0; i -= 1) {
        const a = vA[i]?.score;
        const b = vB[i]?.score;
        if (a != null && b != null) {
          if (a < b)
            return {
              winner: boatA,
              detail: `last-race-backward: ${a} vs ${b}`,
            };
          if (b < a)
            return {
              winner: boatB,
              detail: `last-race-backward: ${b} vs ${a}`,
            };
        }
      }
      return null;
    };

    // ── Apply tie-breaking per SHRS 5.6 ──────────────────────────────────
    let tieBreak = null;
    if (tied) {
      const steps = [];
      let winner = null;

      const allSharedPairs = finalSeriesStarted
        ? [...(sharedQualRacePairs || []), ...sharedRacePairs]
        : sharedRacePairs;

      // Detect multi-heat: if boats don't share every race they're in
      // different heats (at least partially).
      const allUniqueIds = new Set([...boatA.race_ids, ...boatB.race_ids]);
      const isMultiHeat = allSharedPairs.length < allUniqueIds.size;

      if (!isMultiHeat) {
        // ── SHRS 5.6(i): Single-heat event ───────────────────────────
        steps.push({
          rule: 'SHRS 5.6(i)',
          note: 'Single-heat event — standard RRS A8.1 and A8.2 apply.',
        });

        // A8.1: excluded scores NOT used (standard rule)
        const a81Res = applyA81OnPairs(allSharedPairs, false);
        if (a81Res) {
          steps.push({
            rule: 'RRS A8.1',
            note: `Excluded scores not used. ${a81Res.detail}`,
            resolved: true,
          });
          winner = a81Res.winner;
        } else {
          steps.push({
            rule: 'RRS A8.1',
            note: 'Excluded scores not used. All non-excluded scores identical — still tied.',
            resolved: false,
          });

          // A8.2: excluded scores ARE used
          const a82Res = applyA82OnPairs(allSharedPairs);
          if (a82Res) {
            steps.push({
              rule: 'RRS A8.2',
              note: `Excluded scores used. ${a82Res.detail}`,
              resolved: true,
            });
            winner = a82Res.winner;
          } else {
            steps.push({
              rule: 'RRS A8.2',
              note: 'Excluded scores used. All scores identical — still tied.',
              resolved: false,
            });
          }
        }
      } else if (allSharedPairs.length > 0) {
        // ── SHRS 5.6(ii)(a): Multi-heat, shared heats exist ──────────
        steps.push({
          rule: 'SHRS 5.6(ii)(a)',
          note: `Multiple-heat event — ${allSharedPairs.length} shared-heat race(s) found.`,
        });
        steps.push({
          rule: 'SHRS 5.6(ii)(a)(1)',
          note: 'Only scores from races where both boats competed in the same heat are used.',
        });

        // A8.1 + SHRS 5.6(ii)(a)(2): excluded scores ARE used
        const a81Res = applyA81OnPairs(allSharedPairs, true);
        if (a81Res) {
          steps.push({
            rule: 'RRS A8.1 + SHRS 5.6(ii)(a)(2)',
            note: `Excluded scores included (SHRS modification of A8.1). ${a81Res.detail}`,
            resolved: true,
          });
          winner = a81Res.winner;
        } else {
          steps.push({
            rule: 'RRS A8.1 + SHRS 5.6(ii)(a)(2)',
            note: 'Excluded scores included (SHRS modification of A8.1). All scores identical — still tied.',
            resolved: false,
          });

          const a82Res = applyA82OnPairs(allSharedPairs);
          if (a82Res) {
            steps.push({
              rule: 'RRS A8.2',
              note: `Shared-heat scores, last-race-backward. ${a82Res.detail}`,
              resolved: true,
            });
            winner = a82Res.winner;
          } else {
            steps.push({
              rule: 'RRS A8.2',
              note: 'Shared-heat scores, last-race-backward. All identical — still tied.',
              resolved: false,
            });
          }
        }
      } else {
        // ── SHRS 5.6(ii)(b): Multi-heat, no shared heats ────────────
        steps.push({
          rule: 'SHRS 5.6(ii)(b)',
          note: 'No shared heats — RRS A8.1 and A8.2 apply without modification on all scores.',
        });

        const boatAScores = (boatA.races || []).map(parseScoreEntry);
        const boatBScores = (boatB.races || []).map(parseScoreEntry);

        // Standard A8.1: excluded scores NOT used
        const a81Res = applyA81Individual(boatAScores, boatBScores, false);
        if (a81Res) {
          steps.push({
            rule: 'RRS A8.1',
            note: `Excluded scores not used. ${a81Res.detail}`,
            resolved: true,
          });
          winner = a81Res.winner;
        } else {
          steps.push({
            rule: 'RRS A8.1',
            note: 'Excluded scores not used. All non-excluded scores identical — still tied.',
            resolved: false,
          });

          // Standard A8.2: excluded scores ARE used
          const a82Res = applyA82Individual(boatAScores, boatBScores);
          if (a82Res) {
            steps.push({
              rule: 'RRS A8.2',
              note: `Excluded scores used. ${a82Res.detail}`,
              resolved: true,
            });
            winner = a82Res.winner;
          } else {
            steps.push({
              rule: 'RRS A8.2',
              note: 'Excluded scores used. All scores identical — still tied.',
              resolved: false,
            });
          }
        }
      }

      const resolvedStep = steps.find((s) => s.resolved);
      tieBreak = {
        steps,
        winner,
        rule: resolvedStep?.rule || steps[0]?.rule || 'SHRS 5.6',
        detail:
          resolvedStep?.note ||
          'Tie could not be broken after all applicable rules.',
      };
    }

    // How many other boats (besides A and B) share the same total score?
    const getTotal = (e) =>
      finalSeriesStarted
        ? (e.total_points_combined ?? e.computed_total ?? 0)
        : (e.computed_total ?? 0);
    const otherTiedCount = allEntries.filter(
      (e) =>
        e.boat_id !== boatA.boat_id &&
        e.boat_id !== boatB.boat_id &&
        getTotal(e) === totalA &&
        getTotal(e) === totalB,
    ).length;

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
      otherTiedCount,
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
      reportError('Could not check final series status.', error);
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

      // Recompute the final leaderboard so FinalLeaderboard is always current
      // before reading (matches the pattern used for the qualifying leaderboard).
      if (finalSeriesStarted) {
        try {
          await window.electron.sqlite.heatRaceDB.updateFinalLeaderboard(
            eventId,
          );
        } catch (_) {
          // Event may be locked; continue with existing DB values
        }
      }

      const resultsTuple = await Promise.all([
        window.electron.sqlite.heatRaceDB.readFinalLeaderboard(eventId),
        window.electron.sqlite.heatRaceDB.readLeaderboard(eventId),
        finalSeriesStarted
          ? window.electron.sqlite.heatRaceDB.readOverallLeaderboard(eventId)
          : Promise.resolve([]),
      ]);
      const [finalResults, eventResults, overallResults] = resultsTuple || [
        [],
        [],
        [],
      ];

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
          ? (a.overall_rank ?? Infinity) - (b.overall_rank ?? Infinity)
          : (a.place ?? Infinity) - (b.place ?? Infinity),
      );

      setLeaderboard(mergedResults);
      setEditableLeaderboard(JSON.parse(JSON.stringify(mergedResults)));
    } catch (error) {
      reportError('Could not load leaderboard data.', error);
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

      const updateOperations = updatedLeaderboard.flatMap((entry) => {
        const originalEntry = originalSource.find(
          (sourceEntry) => sourceEntry.boat_id === entry.boat_id,
        );

        if (!originalEntry) {
          return [];
        }

        return entry.races
          .map((_race, raceIndex) => {
            const entryStatus = entry.race_statuses?.[raceIndex] || 'FINISHED';
            const origStatus =
              originalEntry.race_statuses?.[raceIndex] || 'FINISHED';

            const hasPositionChanged =
              // eslint-disable-next-line eqeqeq
              parseRaceNum(entry.races[raceIndex]) !=
              parseRaceNum(originalEntry.races[raceIndex]);

            if (!hasPositionChanged && entryStatus === origStatus) {
              return null;
            }

            const raceId = entry.race_ids[raceIndex];
            if (!raceId) {
              return {
                missingRaceId: true,
                boatId: entry.boat_id,
                raceIndex,
              };
            }

            return {
              raceId,
              boatId: entry.boat_id,
              newPosition: parseRaceNum(entry.races[raceIndex]),
              entryStatus,
            };
          })
          .filter(Boolean);
      });

      const missingRaceIdOperation = updateOperations.find(
        (operation) => operation.missingRaceId,
      );
      if (missingRaceIdOperation) {
        throw new Error(
          `Cannot save race updates: missing race ID for boat ${missingRaceIdOperation.boatId}.`,
        );
      }

      await Promise.all(
        updateOperations.map((operation) =>
          window.electron.sqlite.heatRaceDB.updateRaceResult(
            eventId,
            operation.raceId,
            operation.boatId,
            operation.newPosition,
            shiftPositions,
            operation.entryStatus,
          ),
        ),
      );

      await window.electron.sqlite.heatRaceDB.updateEventLeaderboard(eventId);
      if (finalSeriesStarted && activeTab !== 'event') {
        await window.electron.sqlite.heatRaceDB.updateFinalLeaderboard(eventId);
      }

      await fetchLeaderboard();
      setEditMode(false);
    } catch (error) {
      reportError('Could not save leaderboard changes.', error);
    }
  };

  // ─── Export helpers ──────────────────────────────────────────────────────────

  /**
   * Builds a flat export structure:
   *   { header: string[], sections: Array<{ title: string|null, rows: any[][] }> }
   *
   * When the final series has started the layout mirrors FinalFleetTable:
   *   Rank | Name | Country | Sail# | Type | Gross | Overall | Q1…Qn | F1…Fn
   * When qualifying only the layout mirrors QualifyingTable:
   *   Rank | Name | Country | Sail# | Type | R1…Rn | Total
   */
  // Format a race value the same way ScoreCell / getRaceCellDisplay does.
  const formatCell = (race, status) =>
    getRaceCellDisplay(race, status || 'FINISHED').displayText;

  const buildExportData = () => {
    const parseScore = (v) => {
      const n = parseFloat(String(v ?? '').replace(/[()]/g, ''));
      return Number.isNaN(n) ? 0 : n;
    };

    if (!finalSeriesStarted) {
      // ── Qualifying-only view ────────────────────────────────────────────────
      const raceCount = eventLeaderboard[0]?.races?.length ?? 0;
      const header = [
        'Rank',
        'Name',
        'Country',
        'Sail #',
        'Type',
        'Gross',
        'Overall',
        ...Array.from({ length: raceCount }, (_, i) => `Q${i + 1}`),
      ];
      const rows = (eventLeaderboard ?? []).map((e, i) => {
        const grossTotal = (e.races ?? []).reduce(
          (s, r) => s + parseScore(r),
          0,
        );
        const overall = e.computed_total ?? e.total_points_event;
        return [
          i + 1,
          `${e.name} ${e.surname}`,
          e.country ?? '',
          e.boat_number ?? '',
          e.boat_type ?? '',
          grossTotal > 0 ? grossTotal : '–',
          overall != null && !Number.isNaN(overall) ? overall : '–',
          ...(e.races ?? []).map((r, ri) =>
            formatCell(r, e.race_statuses?.[ri]),
          ),
        ];
      });
      return { header, sections: [{ title: null, rows }] };
    }

    // ── Final-series view ───────────────────────────────────────────────────
    const qualRaceCount = eventLeaderboard[0]?.races?.length ?? 0;
    const finalRaceCount = (editableLeaderboard ?? [])[0]?.races?.length ?? 0;

    const header = [
      'Rank',
      'Name',
      'Country',
      'Sail #',
      'Type',
      'Gross',
      'Overall',
      ...Array.from({ length: qualRaceCount }, (_, i) => `Q${i + 1}`),
      ...Array.from({ length: finalRaceCount }, (_, i) => `F${i + 1}`),
    ];

    const grpMap = (editableLeaderboard ?? []).reduce((acc, entry) => {
      const g = entry.placement_group || 'General';
      if (!acc[g]) acc[g] = [];
      acc[g].push(entry);
      return acc;
    }, {});
    const grpOrder = Object.keys(grpMap).sort(
      (a, b) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b),
    );

    const sections = grpOrder.map((g) => ({
      title: `${g} Fleet`,
      rows: (grpMap[g] ?? []).map((entry, i) => {
        const qualEntry = eventLeaderboard.find(
          (e) => e.boat_id === entry.boat_id,
        );
        const qualRaces = qualEntry?.races ?? [];
        const finalRaces = entry.races ?? [];

        const qualGross = qualRaces.reduce((s, r) => s + parseScore(r), 0);
        const finalGross = finalRaces.reduce((s, r) => s + parseScore(r), 0);
        const gross = qualGross + finalGross;

        const overall =
          entry.total_points_combined != null &&
          !Number.isNaN(entry.total_points_combined)
            ? entry.total_points_combined
            : '–';

        return [
          i + 1,
          `${entry.name} ${entry.surname}`,
          entry.country ?? '',
          entry.boat_number ?? '',
          entry.boat_type ?? '',
          gross > 0 ? gross : '–',
          overall,
          ...qualRaces.map((r, ri) =>
            formatCell(r, qualEntry?.race_statuses?.[ri]),
          ),
          ...finalRaces.map((r, ri) =>
            formatCell(r, entry.race_statuses?.[ri]),
          ),
        ];
      }),
    }));

    return { header, sections };
  };

  // ─── Excel export ────────────────────────────────────────────────────────────

  const exportToExcel = async () => {
    const { header, sections } = buildExportData();
    const { safeEventName, raceNumber, seriesLabel } = await getExportMeta();
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Leaderboard');
    worksheet.addRow(header);
    sections.forEach(({ title, rows }) => {
      if (title) worksheet.addRow([title]);
      rows.forEach((r) => worksheet.addRow(r));
    });
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    saveAs(
      blob,
      `${safeEventName}_${seriesLabel}_${raceNumber}_leaderboard.xlsx`,
    );
  };

  // ─── CSV export ──────────────────────────────────────────────────────────────

  const exportToCSV = async () => {
    const { header, sections } = buildExportData();
    const { safeEventName, raceNumber, seriesLabel } = await getExportMeta();
    const escape = (v) => {
      const s = String(v ?? '');
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };
    const lines = [header.map(escape).join(',')];
    sections.forEach(({ title, rows }) => {
      if (title) lines.push(escape(title));
      rows.forEach((r) => lines.push(r.map(escape).join(',')));
    });
    const blob = new Blob([lines.join('\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    saveAs(
      blob,
      `${safeEventName}_${seriesLabel}_${raceNumber}_leaderboard.csv`,
    );
  };

  // ─── TXT export ──────────────────────────────────────────────────────────────

  const exportToTXT = async () => {
    const { header, sections } = buildExportData();
    const { safeEventName, raceNumber, seriesLabel } = await getExportMeta();
    const allRows = sections.flatMap(({ rows }) => rows);
    const colWidths = header.map((h, ci) =>
      Math.max(
        String(h).length,
        ...allRows.map((r) => String(r[ci] ?? '').length),
      ),
    );
    const pad = (v, w) => String(v ?? '').padEnd(w);
    const divider = colWidths.map((w) => '-'.repeat(w)).join('-+-');
    const fmtRow = (r) => r.map((v, i) => pad(v, colWidths[i])).join(' | ');

    const lines = [fmtRow(header), divider];
    sections.forEach(({ title, rows }) => {
      if (title) {
        lines.push('');
        lines.push(`=== ${title} ===`);
        lines.push(divider);
      }
      rows.forEach((r) => lines.push(fmtRow(r)));
    });
    const blob = new Blob([lines.join('\n')], {
      type: 'text/plain;charset=utf-8;',
    });
    saveAs(
      blob,
      `${safeEventName}_${seriesLabel}_${raceNumber}_leaderboard.txt`,
    );
  };

  // ─── Markdown export ─────────────────────────────────────────────────────────

  const exportToMarkdown = async () => {
    const { header, sections } = buildExportData();
    const { safeEventName, raceNumber, seriesLabel } = await getExportMeta();
    const allRows = sections.flatMap(({ rows }) => rows);
    const colWidths = header.map((h, ci) =>
      Math.max(
        String(h).length,
        ...allRows.map((r) => String(r[ci] ?? '').length),
      ),
    );
    const pad = (v, w) => String(v ?? '').padEnd(w);
    const fmtRow = (r) =>
      `| ${r.map((v, i) => pad(v, colWidths[i])).join(' | ')} |`;
    const separator = `| ${colWidths.map((w) => '-'.repeat(w)).join(' | ')} |`;

    const lines = [fmtRow(header), separator];
    sections.forEach(({ title, rows }) => {
      if (title) {
        lines.push('');
        lines.push(`### ${title}`);
        lines.push('');
        lines.push(fmtRow(header));
        lines.push(separator);
      }
      rows.forEach((r) => lines.push(fmtRow(r)));
    });
    const blob = new Blob([lines.join('\n')], {
      type: 'text/markdown;charset=utf-8;',
    });
    saveAs(
      blob,
      `${safeEventName}_${seriesLabel}_${raceNumber}_leaderboard.md`,
    );
  };

  // ─── HTML export ─────────────────────────────────────────────────────────────

  const exportToHTML = async () => {
    const { header, sections } = buildExportData();
    const { safeEventName, raceNumber, seriesLabel } = await getExportMeta();
    const thCells = header.map((h) => `<th>${h}</th>`).join('');
    let tableBody = '';
    sections.forEach(({ title, rows }) => {
      if (title) {
        tableBody += `<tr><td colspan="${header.length}" class="group-header">${title}</td></tr>`;
      }
      rows.forEach((r) => {
        tableBody += `<tr>${r.map((v) => `<td>${v ?? ''}</td>`).join('')}</tr>`;
      });
    });
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Leaderboard</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #1b2740; }
    h1 { font-size: 1.4rem; margin-bottom: 16px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #dde3ea; padding: 6px 10px; text-align: left; font-size: 0.85rem; }
    th { background: #1b2740; color: #fff; }
    tr:nth-child(even) { background: #f0f4f8; }
    .group-header { background: #2a9d8f; color: #fff; font-weight: 700; font-size: 0.9rem; }
  </style>
</head>
<body>
  <h1>Leaderboard</h1>
  <table>
    <thead><tr>${thCells}</tr></thead>
    <tbody>${tableBody}</tbody>
  </table>
</body>
</html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
    saveAs(
      blob,
      `${safeEventName}_${seriesLabel}_${raceNumber}_leaderboard.html`,
    );
  };

  // ─── PDF export ──────────────────────────────────────────────────────────────

  const exportToPDF = async () => {
    const { header, sections } = buildExportData();
    const { safeEventName, raceNumber, seriesLabel } = await getExportMeta();
    // eslint-disable-next-line new-cap
    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFontSize(14);
    doc.text('Leaderboard', 14, 16);

    let startY = 22;
    sections.forEach(({ title, rows }) => {
      if (title) {
        doc.setFontSize(11);
        doc.text(title, 14, startY + 4);
        startY += 8;
      }
      autoTable(doc, {
        head: [header],
        body: rows.map((r) => r.map((v) => String(v ?? ''))),
        startY,
        styles: { fontSize: 7, cellPadding: 2 },
        headStyles: { fillColor: [27, 39, 64] },
        alternateRowStyles: { fillColor: [240, 244, 248] },
        didDrawPage: (data) => {
          startY = data.cursor.y + 6;
        },
      });
      startY = doc.lastAutoTable.finalY + 10;
    });
    doc.save(`${safeEventName}_${seriesLabel}_${raceNumber}_leaderboard.pdf`);
  };

  // ─── Unified export dispatcher ───────────────────────────────────────────────

  const exportAs = async (format) => {
    switch (format) {
      case 'excel':
        return exportToExcel();
      case 'csv':
        return exportToCSV();
      case 'txt':
        return exportToTXT();
      case 'md':
        return exportToMarkdown();
      case 'html':
        return exportToHTML();
      case 'pdf':
        return exportToPDF();
      default:
        return exportToExcel();
    }
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

  const sortedGroups = useMemo(() => {
    const rank = (g) => {
      const i = GROUP_ORDER.indexOf(g);
      return i === -1 ? 999 : i;
    };
    return Object.keys(groupedLeaderboard).sort((a, b) => rank(a) - rank(b));
  }, [groupedLeaderboard]);

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
    exportAs,
    getFlagCode,
  };
}
