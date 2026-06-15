/* eslint-disable camelcase */
import { useState, useEffect, useCallback, useMemo } from 'react';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { jsPDF as JsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import registerPdfUnicodeFont from '../utils/registerPdfUnicodeFont';
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
import {
  getOtherTiedCount,
  getNextCompareSelection,
} from '../utils/compareUtils';
import { confirmAction, reportError } from '../utils/userFeedback';
import { eventDB, heatRaceDB } from '../api/db';

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
  const [discardProfiles, setDiscardProfiles] = useState({
    qualifying: 'standard',
    final: 'standard',
  });
  const [compareMode, setCompareMode] = useState(false);
  const [selectedBoatIds, setSelectedBoatIds] = useState([]);
  // rdgMeta stores per-cell info: { type, selectedRaceLabels? }
  // key is `${boatId}-${raceIndex}`
  const [rdgMeta, setRdgMeta] = useState({});
  // rdg2Picker: the open multi-race selector state for one specific cell
  const [rdg2Picker, setRdg2Picker] = useState(null);
  // Largest-heat size per series, used for SHRS 5.2 penalty scoring
  // (penalty points = largest heat size + 1). Sourced from the main process.
  const [maxHeatSizes, setMaxHeatSizes] = useState({ qualifying: 0, final: 0 });

  const roundToNearestTenthHalfUp = (value) =>
    Math.round((value + Number.EPSILON) * 10) / 10;
  const scoringPenaltyStatuses = new Set(['ZFP', 'SCP', 'T1']);
  const activeDiscardProfile = finalSeriesStarted
    ? discardProfiles.final
    : discardProfiles.qualifying;

  // SHRS 5.2: a non-position-keeping penalty scores largest-heat-size + 1.
  // Falls back to the entry count only if heat sizes are not yet loaded.
  const getPenaltyPosition = (entryCount) => {
    const isFinalEdit = finalSeriesStarted && activeTab !== 'event';
    const size = isFinalEdit ? maxHeatSizes.final : maxHeatSizes.qualifying;
    return (size || entryCount) + 1;
  };

  const sanitizeFilenamePart = (value, fallback = 'event') => {
    const raw = String(value ?? '').trim();
    const safe = raw.replace(/[<>:"/\\|?*]+/g, '_').replace(/\s+/g, '_');
    return safe || fallback;
  };

  const getExportMeta = async () => {
    let eventName = `event_${eventId}`;
    try {
      const events = await eventDB.readAllEvents();
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

  const toPdfText = (value) => {
    const source = String(value ?? '').normalize('NFC');

    // Repair common mojibake patterns (UTF-8 bytes read as latin1/cp1252).
    if (!/[ÃÅÄÐÆØ]/.test(source)) {
      return source;
    }

    try {
      const bytes = Uint8Array.from(
        Array.from(source).map((char) => char.charCodeAt(0) % 256),
      );
      const decoded = new TextDecoder('utf-8').decode(bytes).normalize('NFC');

      const hasReplacementChar = decoded.includes('\uFFFD');
      const gainedDiacritics = /[čćđšžČĆĐŠŽ]/.test(decoded);
      if (!hasReplacementChar && gainedDiacritics) {
        return decoded;
      }
    } catch (_) {
      // Keep source text when repair cannot be safely applied.
    }

    return source;
  };

  // ─── Compare ────────────────────────────────────────────────────────────────

  const handleCompareRowClick = (boat_id, placementGroup = null) => {
    if (!compareMode) return;
    const allEntries = finalSeriesStarted ? leaderboard : eventLeaderboard;
    setSelectedBoatIds((prev) =>
      getNextCompareSelection({
        previousSelectedBoatIds: prev,
        clickedBoatId: boat_id,
        compareMode,
        finalSeriesStarted,
        allEntries,
        clickedPlacementGroup: placementGroup,
      }),
    );
  };

  // compareInfo is the tie-break comparison shown in the compare panel. The
  // authoritative SHRS 5.7 decision (winner, route, steps, race grid) comes
  // from the main process so the panel can never disagree with the ranking.
  // Only display assembly (names, tied-group listing) stays here.
  const [compareInfo, setCompareInfo] = useState(null);

  useEffect(() => {
    let cancelled = false;

    if (selectedBoatIds.length !== 2) {
      setCompareInfo(null);
      return undefined;
    }

    const allEntries = finalSeriesStarted ? leaderboard : eventLeaderboard;
    const boatA = allEntries.find((e) => e.boat_id === selectedBoatIds[0]);
    const boatB = allEntries.find((e) => e.boat_id === selectedBoatIds[1]);
    if (!boatA || !boatB) {
      setCompareInfo(null);
      return undefined;
    }

    const getTotal = (e) =>
      finalSeriesStarted
        ? (e.total_points_combined ?? e.computed_total ?? 0)
        : (e.computed_total ?? 0);
    const totalA = getTotal(boatA);
    const totalB = getTotal(boatB);

    const otherTiedCount = getOtherTiedCount({
      allEntries,
      boatA,
      boatB,
      totalA,
      totalB,
      finalSeriesStarted,
      getTotal,
    });

    const scopedPlacementGroup =
      finalSeriesStarted &&
      boatA?.placement_group &&
      boatB?.placement_group &&
      boatA.placement_group === boatB.placement_group
        ? boatA.placement_group
        : null;

    const tiedGroupEntries = allEntries
      .filter((entry) => {
        if (
          scopedPlacementGroup &&
          (entry.placement_group || 'General') !== scopedPlacementGroup
        ) {
          return false;
        }
        return getTotal(entry) === totalA && getTotal(entry) === totalB;
      })
      .slice()
      .sort((a, b) => {
        const rankA = finalSeriesStarted
          ? (a.overall_rank ?? Infinity)
          : (a.place ?? Infinity);
        const rankB = finalSeriesStarted
          ? (b.overall_rank ?? Infinity)
          : (b.place ?? Infinity);
        if (rankA !== rankB) return rankA - rankB;
        return String(a.boat_id).localeCompare(String(b.boat_id));
      });

    (async () => {
      try {
        const res = await heatRaceDB.explainTieBreak(
          eventId,
          boatA.boat_id,
          boatB.boat_id,
          finalSeriesStarted,
        );
        if (cancelled || !res) return;
        const winner =
          res.winnerBoatId != null
            ? allEntries.find(
                (e) => String(e.boat_id) === String(res.winnerBoatId),
              ) || null
            : null;
        // Race IDs are strings in the leaderboard rows (CSV-split), so the
        // shared-race highlight sets must be strings to match table cells.
        const sharedIds = new Set(
          (res.sharedRacePairs || []).map((pair) => String(pair.raceId)),
        );
        const sharedQualIds = new Set(
          (res.sharedQualRacePairs || []).map((pair) => String(pair.raceId)),
        );
        setCompareInfo({
          boatA,
          boatB,
          totalA: res.totalA ?? totalA,
          totalB: res.totalB ?? totalB,
          tied: res.tied,
          tieBreak: res.tied
            ? {
                steps: res.steps || [],
                winner,
                rule: res.route?.rule || 'SHRS 5.7',
                detail: res.route?.note || '',
              }
            : null,
          routeStep: res.route || null,
          raceGrid: res.raceGrid || [],
          sharedRacePairs: res.sharedRacePairs || [],
          sharedQualRacePairs: res.sharedQualRacePairs || [],
          sharedIds,
          sharedQualIds,
          otherTiedCount,
          tiedGroupEntries,
        });
      } catch (error) {
        if (!cancelled) {
          reportError('Could not compute tie-break comparison.', error);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    selectedBoatIds,
    finalSeriesStarted,
    eventLeaderboard,
    leaderboard,
    eventId,
  ]);

  // ─── Data fetching ───────────────────────────────────────────────────────────

  const checkFinalSeriesStarted = useCallback(async () => {
    try {
      const heats = await heatRaceDB.readAllHeats(eventId);
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [qualifying, final] = await Promise.all([
          heatRaceDB.getMaxHeatSize(eventId, 'Qualifying'),
          heatRaceDB.getMaxHeatSize(eventId, 'Final'),
        ]);
        if (!cancelled) {
          setMaxHeatSizes({ qualifying: qualifying || 0, final: final || 0 });
        }
      } catch (_) {
        // Keep fallback heat sizes; penalty position falls back to entry count.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, finalSeriesStarted]);

  const fetchLeaderboard = useCallback(async () => {
    try {
      // Recompute the event leaderboard in the DB so that place values
      // reflect correct exclusions and SHRS 5.7 tie-breaking.
      try {
        await heatRaceDB.updateEventLeaderboard(eventId);
      } catch (_) {
        // Recompute may fail; continue with existing DB values
      }

      // Recompute the final leaderboard so FinalLeaderboard is always current
      // before reading (matches the pattern used for the qualifying leaderboard).
      if (finalSeriesStarted) {
        try {
          await heatRaceDB.updateFinalLeaderboard(eventId);
        } catch (_) {
          // Recompute may fail; continue with existing DB values
        }
      }

      const resultsTuple = await Promise.all([
        heatRaceDB.readFinalLeaderboard(eventId),
        heatRaceDB.readLeaderboard(eventId),
        finalSeriesStarted
          ? heatRaceDB.readOverallLeaderboard(eventId)
          : Promise.resolve([]),
      ]);
      const [finalResults, eventResults, overallResults] = resultsTuple || [
        [],
        [],
        [],
      ];

      const events = await eventDB.readAllEvents();
      const currentEvent = Array.isArray(events)
        ? events.find((event) => String(event.event_id) === String(eventId))
        : null;

      const nextProfiles = {
        qualifying: currentEvent?.shrs_discard_profile_qualifying || 'standard',
        final: currentEvent?.shrs_discard_profile_final || 'standard',
      };
      setDiscardProfiles(nextProfiles);

      const eventLeaderboardWithRaces = eventResults
        .map((entry) => processLeaderboardEntry(entry, nextProfiles.qualifying))
        .sort((a, b) => (a.place ?? Infinity) - (b.place ?? Infinity));
      setEventLeaderboard(eventLeaderboardWithRaces);

      const results = finalSeriesStarted ? finalResults : eventResults;
      const leaderboardWithRaces = results.map((entry) =>
        processLeaderboardEntry(
          entry,
          finalSeriesStarted ? nextProfiles.final : nextProfiles.qualifying,
        ),
      );

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

  const hasUnsavedChanges = useMemo(() => {
    if (!editMode) return false;
    const source = finalSeriesStarted ? leaderboard : eventLeaderboard;
    if (!Array.isArray(source) || source.length === 0) return false;
    return JSON.stringify(editableLeaderboard) !== JSON.stringify(source);
  }, [
    editMode,
    editableLeaderboard,
    leaderboard,
    eventLeaderboard,
    finalSeriesStarted,
  ]);

  useEffect(() => {
    const onBeforeUnload = (event) => {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasUnsavedChanges]);

  // ─── Edit mode ───────────────────────────────────────────────────────────────

  const toggleEditMode = async () => {
    if (editMode && hasUnsavedChanges) {
      const shouldDiscard = await confirmAction(
        'You have unsaved leaderboard changes. Cancel editing and discard them?',
        'Discard changes',
      );
      if (!shouldDiscard) return;
    }

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
    // RRS A9(a)/(b): average of the boat's points in all races in the
    // series (or the selected group) except the race in question.
    // Penalty scores are her points and are included in the average.
    const candidates = races
      .map((r, i) => ({
        val: parseFloat(String(r).replace(/[()]/g, '')),
        idx: i,
      }))
      .filter(({ idx, val }) => {
        if (idx === excludeIdx) return false;
        if (selectedIndices !== null && !selectedIndices.has(idx)) return false;
        return !Number.isNaN(val);
      });
    if (candidates.length === 0) return penaltyPos;
    const sum = candidates.reduce((s, { val }) => s + val, 0);
    return roundToNearestTenthHalfUp(sum / candidates.length);
  };

  // Position-keeping penalties (ZFP/SCP/T1) display their finishing place, but
  // score more points (RRS 44.3c/T1). The race cells store the place, so the
  // edit-mode preview total must convert those cells to their penalty points —
  // matching getScoringPenaltyPoints in the main process — before summing.
  // Other statuses already store their points as the cell value.
  const toScoreValuesForTotal = (rawRaces, statuses, penaltyPosition) => {
    const maxBoats = penaltyPosition - 1;
    return rawRaces.map((race, i) => {
      const status = statuses[i] || 'FINISHED';
      if (!scoringPenaltyStatuses.has(status)) return race;
      const place = parseFloat(String(race).replace(/[()]/g, ''));
      if (Number.isNaN(place)) return race;
      const rate = status === 'T1' ? 0.3 : 0.2;
      const penaltyPlaces = Math.floor(maxBoats * rate + 0.5 + Number.EPSILON);
      return Math.min(place + penaltyPlaces, maxBoats + 1);
    });
  };

  const handleRaceChange = (
    boatId,
    raceIndex,
    newRaceValue,
    newStatus = 'FINISHED',
  ) => {
    const cloned = JSON.parse(JSON.stringify(editableLeaderboard));
    const targetEntry = cloned.find((e) => e.boat_id === boatId);
    if (!targetEntry) return;

    const isRdgType = RDG_TYPES.includes(newStatus);
    const isPenalty = PENALTY_CODES.includes(newStatus);
    const fallbackInput =
      newRaceValue == null
        ? parseRaceNum(targetEntry.races[raceIndex])
        : parseFloat(newRaceValue);

    if (newStatus === 'RDG2') return;

    if (!isPenalty && (Number.isNaN(fallbackInput) || fallbackInput < 0)) {
      return;
    }
    if (
      newStatus === 'RDG3' &&
      newRaceValue !== null &&
      Number.isNaN(fallbackInput)
    )
      return;
    const penaltyPosition = getPenaltyPosition(cloned.length);

    let newPosition;
    if (newStatus === 'RDG1') {
      newPosition = computeRdgAverage(
        targetEntry.races,
        targetEntry.race_statuses,
        raceIndex,
        penaltyPosition,
      );
      setRdgMeta((prev) => ({
        ...prev,
        [`${boatId}-${raceIndex}`]: { type: 'RDG1' },
      }));
    } else if (newStatus === 'RDG3') {
      if (newRaceValue === null) {
        const raw = parseFloat(
          String(targetEntry.races[raceIndex]).replace(/[()]/g, ''),
        );
        newPosition = Number.isNaN(raw) ? 0 : raw;
      } else {
        newPosition = fallbackInput;
      }
      setRdgMeta((prev) => ({
        ...prev,
        [`${boatId}-${raceIndex}`]: { type: 'RDG3' },
      }));
    } else if (isRdgType) {
      newPosition = penaltyPosition;
    } else if (isPenalty) {
      newPosition = scoringPenaltyStatuses.has(newStatus)
        ? fallbackInput
        : penaltyPosition;
    } else {
      newPosition = fallbackInput;
    }

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
      const scoreValues = toScoreValuesForTotal(
        rawRaces,
        newStatuses,
        penaltyPosition,
      );
      const { markedRaces, total } = applyExclusions(
        rawRaces,
        newStatuses,
        scoreValues,
        activeDiscardProfile,
      );
      return {
        ...entry,
        races: markedRaces,
        // Store the scored points (not the raw place) so the Gross column and
        // any race_points consumer match the backend's read-mode semantics.
        race_points: scoreValues.map((value) => String(value)),
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

    const penaltyPosition = getPenaltyPosition(cloned.length);

    // RRS A9(b): average of her points in the selected group of races.
    // Penalty scores are her points and are included.
    const finalValues = [...(selectedIndices || new Set())]
      .filter((i) => i !== raceIndex)
      .map((i) => parseFloat(String(entry.races[i]).replace(/[()]/g, '')))
      .filter((v) => !Number.isNaN(v));

    const qualEntry = eventLeaderboard?.find((e) => e.boat_id === boatId);
    const qualValues = [...(selectedQualIndices || new Set())]
      .map((i) =>
        parseFloat(String(qualEntry?.races?.[i] ?? '').replace(/[()]/g, '')),
      )
      .filter((v) => !Number.isNaN(v));

    const allValues = [...qualValues, ...finalValues];
    const avg =
      allValues.length > 0
        ? roundToNearestTenthHalfUp(
            allValues.reduce((s, v) => s + v, 0) / allValues.length,
          )
        : penaltyPosition;

    const entryStatuses = [
      ...(entry.race_statuses || entry.races.map(() => 'FINISHED')),
    ];
    const rawRaces = entry.races.map((r) => String(r).replace(/[()]/g, ''));
    rawRaces[raceIndex] = String(avg);
    entryStatuses[raceIndex] = 'RDG2';

    const scoreValues = toScoreValuesForTotal(
      rawRaces,
      entryStatuses,
      penaltyPosition,
    );
    const { markedRaces, total } = applyExclusions(
      rawRaces,
      entryStatuses,
      scoreValues,
      activeDiscardProfile,
    );
    const updatedEntry = {
      ...entry,
      races: markedRaces,
      race_points: scoreValues.map((value) => String(value)),
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
    let originalSourceSnapshot = [];
    try {
      if (!editableLeaderboard || !leaderboard) {
        throw new Error('Leaderboard data is not initialized');
      }

      const penaltyPosition = getPenaltyPosition(editableLeaderboard.length);
      const updatedLeaderboard = editableLeaderboard.map((entry) => {
        const rawRaces = entry.races.map((r) => String(r).replace(/[()]/g, ''));
        const statuses =
          entry.race_statuses || entry.races.map(() => 'FINISHED');
        const scoreValues = toScoreValuesForTotal(
          rawRaces,
          statuses,
          penaltyPosition,
        );
        const { total } = applyExclusions(
          rawRaces,
          statuses,
          scoreValues,
          activeDiscardProfile,
        );
        return {
          ...entry,
          race_points: scoreValues.map((value) => String(value)),
          total_points_event: total,
          total_points_final: total,
          computed_total: total,
        };
      });

      const originalSource =
        activeTab === 'event' ? eventLeaderboard : leaderboard;
      originalSourceSnapshot = JSON.parse(JSON.stringify(originalSource || []));

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

      await heatRaceDB.saveLeaderboardRaceResultsAtomic(
        eventId,
        updateOperations,
        shiftPositions,
        finalSeriesStarted && activeTab !== 'event',
      );

      await fetchLeaderboard();
      setEditMode(false);
    } catch (error) {
      setEditableLeaderboard(originalSourceSnapshot);
      setRdgMeta({});
      setRdg2Picker(null);
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
        const grossTotal = (e.race_points ?? e.races ?? []).reduce(
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
        const qualRacePoints = qualEntry?.race_points ?? qualRaces;
        const finalRacePoints = entry.race_points ?? finalRaces;

        const qualGross = qualRacePoints.reduce((s, r) => s + parseScore(r), 0);
        const finalGross = finalRacePoints.reduce(
          (s, r) => s + parseScore(r),
          0,
        );
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
    const escapeHtml = (value) =>
      String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const thCells = header.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
    let tableBody = '';
    sections.forEach(({ title, rows }) => {
      if (title) {
        tableBody += `<tr><td colspan="${header.length}" class="group-header">${escapeHtml(title)}</td></tr>`;
      }
      rows.forEach((r) => {
        tableBody += `<tr>${r.map((v) => `<td>${escapeHtml(v)}</td>`).join('')}</tr>`;
      });
    });
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
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
    // Prefix with UTF-8 BOM so Windows apps consistently decode diacritics.
    const blob = new Blob(['\uFEFF', html], {
      type: 'text/html;charset=utf-8;',
    });
    saveAs(
      blob,
      `${safeEventName}_${seriesLabel}_${raceNumber}_leaderboard.html`,
    );
  };

  // ─── PDF export ──────────────────────────────────────────────────────────────

  const exportToPDF = async () => {
    const { header, sections } = buildExportData();
    const { safeEventName, raceNumber, seriesLabel } = await getExportMeta();
    const doc = new JsPDF({ orientation: 'landscape' });
    await registerPdfUnicodeFont(doc);
    doc.setFontSize(14);
    doc.setFont('DejaVuSans', 'bold');
    doc.text('Leaderboard', 14, 16);
    doc.setFont('DejaVuSans', 'normal');

    let startY = 22;
    sections.forEach(({ title, rows }) => {
      if (title) {
        doc.setFontSize(11);
        doc.setFont('DejaVuSans', 'bold');
        doc.text(title, 14, startY + 4);
        doc.setFont('DejaVuSans', 'normal');
        startY += 8;
      }
      autoTable(doc, {
        head: [header.map((cell) => toPdfText(cell))],
        body: rows.map((r) => r.map((v) => toPdfText(v))),
        startY,
        styles: { fontSize: 7, cellPadding: 2, font: 'DejaVuSans' },
        headStyles: {
          fillColor: [27, 39, 64],
          font: 'DejaVuSans',
          fontStyle: 'bold',
        },
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
    hasUnsavedChanges,
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
