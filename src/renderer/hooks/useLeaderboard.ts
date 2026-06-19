/* eslint-disable camelcase */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
import {
  confirmAction,
  confirmChoice,
  reportError,
} from '../utils/userFeedback';
import escapeHtml from '../utils/escapeHtml';
import {
  getScoringPenaltyPoints,
  scoringPenaltyStatuses,
} from '../../shared/scoringPenalty';
import { eventDB, heatRaceDB } from '../api/db';
import type {
  CompareInfo,
  LeaderboardEntry,
  OverallLeaderboardEntry,
  RdgMetaEntry,
  Rdg2PickerState,
} from '../types';

type ActiveTab = 'event' | 'final';

interface DiscardProfiles {
  qualifying: string;
  final: string;
}

interface MaxHeatSizes {
  qualifying: number;
  final: number;
}

type ExportCell = string | number;

interface ExportSection {
  title: string | null;
  rows: ExportCell[][];
}

interface ExportData {
  header: string[];
  sections: ExportSection[];
}

/** A single race-result change queued by handleSave for the atomic write. */
interface SaveRaceOperation {
  raceId?: string;
  boatId: number;
  raceIndex?: number;
  newPosition?: number;
  entryStatus?: string;
  missingRaceId?: boolean;
}

/** Position + scored points + status for one boat in one race column. */
interface RaceCellState {
  position: number;
  points: number;
  status: string;
}

/**
 * Renderer mirror of HeatRaceHandler.applyRaceTieScoring for a single race
 * column, so the edit-mode preview shows exactly what the backend persists on
 * save. Finishers — and position-keeping penalties (ZFP/SCP/T1), which occupy a
 * place slot — are walked in position order and given contiguous places; tied
 * positions share averaged points (RRS A7). Hard penalties (DNS/DSQ/…) and RDG
 * cells are not finishers, so they keep the position/points already assigned to
 * them and do not consume a finishing slot.
 */
function rerankRaceColumn(cells: RaceCellState[]): RaceCellState[] {
  const next = cells.map((cell) => ({ ...cell }));
  const participants = next
    .map((cell, idx) => ({ idx, position: cell.position, status: cell.status }))
    .filter(
      (cell) =>
        cell.status === 'FINISHED' || scoringPenaltyStatuses.has(cell.status),
    )
    .sort((a, b) => a.position - b.position || a.idx - b.idx);

  let cursor = 1;
  let i = 0;
  while (i < participants.length) {
    const tieValue = participants[i].position;
    const group: { idx: number }[] = [];
    while (i < participants.length && participants[i].position === tieValue) {
      group.push({ idx: participants[i].idx });
      i += 1;
    }
    const startPlace = cursor;
    const endPlace = cursor + group.length - 1;
    const tiePoints = (startPlace + endPlace) / 2;
    group.forEach(({ idx }) => {
      // Only finishers are (re)scored; penalty boats keep their own place +
      // points but still consume the slot above.
      if (next[idx].status === 'FINISHED') {
        next[idx].position = startPlace;
        next[idx].points = tiePoints;
      }
    });
    cursor += group.length;
  }
  return next;
}

export default function useLeaderboard(eventId: number) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [eventLeaderboard, setEventLeaderboard] = useState<LeaderboardEntry[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [finalSeriesStarted, setFinalSeriesStarted] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('event');
  const [editMode, setEditMode] = useState(false);
  const [editableLeaderboard, setEditableLeaderboard] = useState<
    LeaderboardEntry[]
  >([]);
  // Cells the user explicitly edited this session, keyed `${boatId}-${raceIndex}`
  // → the RAW position + status the user chose (before column re-ranking). The
  // preview re-ranks for display, but the save sends only these raw edits and
  // lets the backend re-rank — saving the cascaded preview values would not
  // converge under the backend's per-operation re-rank.
  const userEditsRef = useRef<
    Map<
      string,
      {
        boatId: number;
        raceIndex: number;
        rawPosition: number;
        status: string;
      }
    >
  >(new Map());
  const [overallLeaderboard, setOverallLeaderboard] = useState<
    OverallLeaderboardEntry[]
  >([]);
  const [shiftPositions, setShiftPositions] = useState(false);
  const [discardProfiles, setDiscardProfiles] = useState<DiscardProfiles>({
    qualifying: 'standard',
    final: 'standard',
  });
  const [compareMode, setCompareMode] = useState(false);
  const [selectedBoatIds, setSelectedBoatIds] = useState<number[]>([]);
  // rdgMeta stores per-cell info: { type, selectedRaceLabels? }
  // key is `${boatId}-${raceIndex}`
  const [rdgMeta, setRdgMeta] = useState<Record<string, RdgMetaEntry>>({});
  // rdg2Picker: the open multi-race selector state for one specific cell
  const [rdg2Picker, setRdg2Picker] = useState<Rdg2PickerState | null>(null);
  // Largest-heat size per series, used for SHRS 5.2 penalty scoring
  // (penalty points = largest heat size + 1). Sourced from the main process.
  const [maxHeatSizes, setMaxHeatSizes] = useState<MaxHeatSizes>({
    qualifying: 0,
    final: 0,
  });

  // Deep-clone leaderboard rows while preserving their type (JSON round-trip
  // returns `any`, so this keeps callers strongly typed).
  const cloneEntries = (rows: LeaderboardEntry[]): LeaderboardEntry[] =>
    JSON.parse(JSON.stringify(rows));

  const roundToNearestTenthHalfUp = (value: number): number =>
    Math.round((value + Number.EPSILON) * 10) / 10;
  const activeDiscardProfile = finalSeriesStarted
    ? discardProfiles.final
    : discardProfiles.qualifying;

  // SHRS 5.2: a non-position-keeping penalty scores largest-heat-size + 1.
  // Falls back to the entry count only if heat sizes are not yet loaded.
  const getPenaltyPosition = (entryCount: number): number => {
    const isFinalEdit = finalSeriesStarted && activeTab !== 'event';
    const size = isFinalEdit ? maxHeatSizes.final : maxHeatSizes.qualifying;
    return (size || entryCount) + 1;
  };

  const sanitizeFilenamePart = (value: unknown, fallback = 'event'): string => {
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

  const toPdfText = (value: unknown): string => {
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

  const handleCompareRowClick = (
    boat_id: number,
    placementGroup: string | null = null,
  ) => {
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
  const [compareInfo, setCompareInfo] = useState<CompareInfo | null>(null);

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

    const getTotal = (e: LeaderboardEntry): number =>
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
            : (entry.computed_total ?? 0) +
              (eventEntry ? (eventEntry.computed_total ?? 0) : 0);
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
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
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
    setEditableLeaderboard(cloneEntries(source));
    setRdgMeta({});
    setRdg2Picker(null);
    userEditsRef.current.clear();
    setEditMode(!editMode);
  };

  const computeRdgAverage = (
    races: string[],
    statuses: string[],
    excludeIdx: number,
    penaltyPos: number,
    selectedIndices: Set<number> | null = null,
  ): number => {
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
  const toScoreValuesForTotal = (
    rawRaces: string[],
    statuses: string[],
    penaltyPosition: number,
  ): Array<string | number> => {
    const maxBoats = penaltyPosition - 1;
    return rawRaces.map((race, i) => {
      const status = statuses[i] || 'FINISHED';
      if (!scoringPenaltyStatuses.has(status)) return race;
      const place = parseFloat(String(race).replace(/[()]/g, ''));
      if (Number.isNaN(place)) return race;
      return getScoringPenaltyPoints(place, maxBoats, status);
    });
  };

  // Normalise an entry into the inputs every recompute path needs: race cells
  // with discard parens stripped, and a per-race status list defaulting to
  // FINISHED. Both arrays are freshly built, so callers may mutate them in
  // place (e.g. to set the edited cell) without touching the source entry.
  const getEntryScoreInputs = (
    entry: LeaderboardEntry,
  ): { rawRaces: string[]; statuses: string[] } => ({
    rawRaces: entry.races.map((r) => String(r).replace(/[()]/g, '')),
    statuses: entry.race_statuses
      ? [...entry.race_statuses]
      : entry.races.map(() => 'FINISHED'),
  });

  // Recompute the score-derived fields shared by every edit path: convert the
  // place cells to penalty points, run discards, and expose both the discard-
  // marked races and the score fields. Callers spread in the totals and pick
  // whether to adopt `markedRaces` (save keeps the original `races`).
  const recomputeEntryScores = (
    rawRaces: string[],
    statuses: string[],
    penaltyPosition: number,
  ) => {
    const scoreValues = toScoreValuesForTotal(
      rawRaces,
      statuses,
      penaltyPosition,
    );
    const { markedRaces, total } = applyExclusions(
      rawRaces,
      statuses,
      scoreValues,
      activeDiscardProfile,
    );
    return {
      markedRaces,
      scoreFields: {
        // Store the scored points (not the raw place) so the Gross column and
        // any race_points consumer match the backend's read-mode semantics.
        race_points: scoreValues.map(String),
        total_points_event: total,
        total_points_final: total,
        computed_total: total,
      },
    };
  };

  const handleRaceChange = (
    boatId: number,
    raceIndex: number,
    newRaceValue: string | number | null,
    newStatus = 'FINISHED',
  ) => {
    const cloned = cloneEntries(editableLeaderboard);
    const targetEntry = cloned.find((e) => e.boat_id === boatId);
    if (!targetEntry) return;

    const isRdgType = RDG_TYPES.includes(newStatus);
    const isPenalty = PENALTY_CODES.includes(newStatus);
    const fallbackInput =
      newRaceValue == null
        ? parseRaceNum(targetEntry.races[raceIndex])
        : parseFloat(String(newRaceValue));

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
    const maxBoats = penaltyPosition - 1;

    // Resolve the edited cell's position + scored points before column re-rank.
    let newPosition: number;
    let newPoints: number;
    if (newStatus === 'RDG1') {
      newPosition = computeRdgAverage(
        targetEntry.races,
        targetEntry.race_statuses,
        raceIndex,
        penaltyPosition,
      );
      newPoints = newPosition;
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
      newPoints = newPosition;
      setRdgMeta((prev) => ({
        ...prev,
        [`${boatId}-${raceIndex}`]: { type: 'RDG3' },
      }));
    } else if (isRdgType) {
      newPosition = penaltyPosition;
      newPoints = penaltyPosition;
    } else if (isPenalty) {
      if (scoringPenaltyStatuses.has(newStatus)) {
        // Position-keeping penalty: keeps its finishing place, scores RRS 44.3c/
        // T1 points.
        newPosition = fallbackInput;
        newPoints = getScoringPenaltyPoints(fallbackInput, maxBoats, newStatus);
      } else {
        // Hard penalty (DNS/DSQ/…): largest heat size + 1 per SHRS 5.2.
        newPosition = penaltyPosition;
        newPoints = penaltyPosition;
      }
    } else {
      newPosition = fallbackInput;
      newPoints = fallbackInput;
    }

    const oldPosition = parseRaceNum(targetEntry.races[raceIndex]);

    // Group the boats that share THIS physical race (same race_id at this
    // column). Those are the only boats whose finishing places interact: a
    // final fleet's boats share their final race; a qualifying heat's boats
    // share their heat race. Grouping by race_id is exact for both series and
    // stops an edit in one fleet/heat from cascading into another.
    const targetRaceId = targetEntry.race_ids?.[raceIndex];
    const groupIdx: number[] = [];
    cloned.forEach((entry, idx) => {
      const sameRace =
        targetRaceId != null &&
        entry.race_ids?.[raceIndex] != null &&
        String(entry.race_ids[raceIndex]) === String(targetRaceId);
      if (sameRace || (targetRaceId == null && entry.boat_id === boatId)) {
        groupIdx.push(idx);
      }
    });

    // A finishing place cannot exceed the number of boats in the race (SHRS).
    // Penalty/RDG cells keep their computed value.
    const heatSize = groupIdx.length || 1;
    if (!isPenalty && !isRdgType && newStatus !== 'RDG3') {
      newPosition = Math.min(Math.max(Math.round(newPosition), 1), heatSize);
      newPoints = newPosition;
    }

    // Remember the raw user edit for the save payload (backend applies it).
    userEditsRef.current.set(`${boatId}-${raceIndex}`, {
      boatId,
      raceIndex,
      rawPosition: newPosition,
      status: newStatus,
    });

    // Rebuild one entry's race arrays + score-derived totals after changing its
    // cell at `raceIndex`. Other entries are returned untouched by the caller.
    const recomputeEntry = (
      entry: LeaderboardEntry,
      cellPosition: number,
      cellPoints: number,
      cellStatus: string,
    ): LeaderboardEntry => {
      const positions = entry.races.map((r) => String(r).replace(/[()]/g, ''));
      const points =
        entry.race_points && entry.race_points.length === entry.races.length
          ? entry.race_points.map((p) => String(p).replace(/[()]/g, ''))
          : [...positions];
      const statuses = entry.race_statuses
        ? [...entry.race_statuses]
        : entry.races.map(() => 'FINISHED');

      positions[raceIndex] = String(cellPosition);
      points[raceIndex] = String(cellPoints);
      statuses[raceIndex] = cellStatus;

      const { markedRaces, total } = applyExclusions(
        positions,
        statuses,
        points,
        activeDiscardProfile,
      );
      return {
        ...entry,
        races: markedRaces,
        race_points: points,
        race_statuses: statuses,
        total_points_event: total,
        total_points_final: total,
        computed_total: total,
        // Keep the Overall column (SHRS 5.4 combined total) in sync with the
        // live edit. Without this only Gross + F-Tot move while editing; Overall
        // stays stale until save. qualifying_points is fixed during the final
        // series, so combined = qualifying + the new final total.
        ...(finalSeriesStarted
          ? {
              total_points_combined:
                (Number(entry.qualifying_points) || 0) + total,
            }
          : {}),
      };
    };

    let updated: LeaderboardEntry[];

    if (shiftPositions) {
      // Shift ON: mirror the backend — insert the edited boat at its new place
      // and ripple the surrounding finishers, then re-rank the race to
      // contiguous places (ties share averaged points, RRS A7).
      const column: RaceCellState[] = groupIdx.map((idx) => {
        const entry = cloned[idx];
        if (entry.boat_id === boatId) {
          return {
            position: newPosition,
            points: newPoints,
            status: newStatus,
          };
        }
        const pos = parseRaceNum(entry.races[raceIndex]);
        const rawPts = parseFloat(
          String(
            entry.race_points?.[raceIndex] ?? entry.races[raceIndex],
          ).replace(/[()]/g, ''),
        );
        return {
          position: pos,
          points: Number.isNaN(rawPts) ? pos : rawPts,
          status: entry.race_statuses?.[raceIndex] || 'FINISHED',
        };
      });

      if (!isPenalty) {
        column.forEach((cell, i) => {
          if (cloned[groupIdx[i]].boat_id === boatId) return;
          if (PENALTY_CODES.includes(cell.status)) return;
          const otherPos = cell.position;
          if (
            oldPosition > newPosition &&
            otherPos >= newPosition &&
            otherPos < oldPosition
          ) {
            cell.position += 1;
            cell.points = cell.position;
          } else if (
            oldPosition < newPosition &&
            otherPos <= newPosition &&
            otherPos > oldPosition
          ) {
            cell.position -= 1;
            cell.points = cell.position;
          }
        });
      }

      const ranked = rerankRaceColumn(column);
      const rankedByIdx = new Map<number, RaceCellState>();
      groupIdx.forEach((idx, i) => rankedByIdx.set(idx, ranked[i]));

      updated = cloned.map((entry, idx) => {
        const rankedCell = rankedByIdx.get(idx);
        // Boats in other races are never touched by an edit in this race.
        if (!rankedCell) return entry;
        return recomputeEntry(
          entry,
          rankedCell.position,
          rankedCell.points,
          rankedCell.status,
        );
      });
    } else {
      // Shift OFF: change ONLY the edited boat. Every other boat keeps its
      // place and points exactly as they are — no cascade. This can leave a
      // tie or a gap in the race until the user resolves it manually, which is
      // the intended manual-override behaviour.
      updated = cloned.map((entry) =>
        entry.boat_id === boatId
          ? recomputeEntry(entry, newPosition, newPoints, newStatus)
          : entry,
      );
    }

    setEditableLeaderboard(updated);
  };

  const confirmRdg2 = () => {
    if (!rdg2Picker) return;
    const { boatId, raceIndex, selectedIndices, selectedQualIndices } =
      rdg2Picker;
    const cloned = cloneEntries(editableLeaderboard);
    const entry = cloned.find((e) => e.boat_id === boatId);
    if (!entry) {
      setRdg2Picker(null);
      return;
    }

    const penaltyPosition = getPenaltyPosition(cloned.length);

    // RRS A9(b): average of her points in the selected group of races.
    // Penalty scores are her points and are included.
    const finalValues = [...(selectedIndices || new Set<number>())]
      .filter((i) => i !== raceIndex)
      .map((i) => parseFloat(String(entry.races[i]).replace(/[()]/g, '')))
      .filter((v) => !Number.isNaN(v));

    const qualEntry = eventLeaderboard?.find((e) => e.boat_id === boatId);
    const qualValues = [...(selectedQualIndices || new Set<number>())]
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

    const { rawRaces, statuses } = getEntryScoreInputs(entry);
    rawRaces[raceIndex] = String(avg);
    statuses[raceIndex] = 'RDG2';

    // Record the raw edit so handleSave persists this RDG2 cell.
    userEditsRef.current.set(`${boatId}-${raceIndex}`, {
      boatId,
      raceIndex,
      rawPosition: avg,
      status: 'RDG2',
    });

    const { markedRaces, scoreFields } = recomputeEntryScores(
      rawRaces,
      statuses,
      penaltyPosition,
    );
    const updatedEntry = {
      ...entry,
      races: markedRaces,
      ...scoreFields,
      race_statuses: statuses,
      // Mirror handleRaceChange: keep the Overall combined total live so the
      // RDG2 edit updates the Overall column, not just Gross + F-Tot.
      ...(finalSeriesStarted
        ? {
            total_points_combined:
              (Number(entry.qualifying_points) || 0) +
              scoreFields.computed_total,
          }
        : {}),
    };

    const qualLabels = [...(selectedQualIndices || new Set<number>())]
      .sort((a, b) => a - b)
      .map((i) => `Q${i + 1}`);
    const finalLabels = [...(selectedIndices || new Set<number>())]
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

  // A finishing-place collision the user introduced this edit session: within
  // one race two FINISHED boats now hold the same place. Each colliding place
  // is one PlaceConflict; the boats carry their own column index so handleSave
  // can swap places when the user asks for it.
  interface ConflictBoat {
    entry: LeaderboardEntry;
    raceIndex: number;
  }
  interface PlaceConflict {
    label: string;
    raceId: string;
    place: number;
    boats: ConflictBoat[];
  }

  const findPlaceConflicts = (rows: LeaderboardEntry[]): PlaceConflict[] => {
    // Only inspect races the user actually touched this session, so a pre-
    // existing tie loaded from the DB never blocks an unrelated save.
    const editedRaceIds = new Set<string>();
    userEditsRef.current.forEach(({ boatId, raceIndex }) => {
      const entry = rows.find((e) => e.boat_id === boatId);
      const raceId = entry?.race_ids?.[raceIndex];
      if (raceId != null) editedRaceIds.add(String(raceId));
    });
    if (editedRaceIds.size === 0) return [];

    // Group every FINISHED boat's place by the physical race it sailed. Penalty
    // and RDG cells don't occupy a unique finishing slot, so they're skipped.
    interface Slot {
      label: string;
      place: number;
      entry: LeaderboardEntry;
      raceIndex: number;
    }
    const byRace = new Map<string, Slot[]>();
    rows.forEach((entry) => {
      entry.race_ids?.forEach((raceId, idx) => {
        const raceIdStr = String(raceId);
        if (!editedRaceIds.has(raceIdStr)) return;
        const status = entry.race_statuses?.[idx] || 'FINISHED';
        if (status !== 'FINISHED') return;
        const place = parseRaceNum(entry.races[idx]);
        if (!Number.isFinite(place) || place <= 0) return;
        const label = finalSeriesStarted ? `F${idx + 1}` : `R${idx + 1}`;
        const slots = byRace.get(raceIdStr) ?? [];
        slots.push({ label, place, entry, raceIndex: idx });
        byRace.set(raceIdStr, slots);
      });
    });

    const conflicts: PlaceConflict[] = [];
    byRace.forEach((slots, raceId) => {
      const byPlace = new Map<number, Slot[]>();
      slots.forEach((slot) => {
        const group = byPlace.get(slot.place) ?? [];
        group.push(slot);
        byPlace.set(slot.place, group);
      });
      byPlace.forEach((group, place) => {
        if (group.length >= 2) {
          conflicts.push({
            label: group[0].label,
            raceId,
            place,
            boats: group.map((g) => ({
              entry: g.entry,
              raceIndex: g.raceIndex,
            })),
          });
        }
      });
    });
    return conflicts;
  };

  const describeBoat = (entry: LeaderboardEntry): string => {
    const name = `${entry.name ?? ''} ${entry.surname ?? ''}`.trim();
    const tag = [entry.country, entry.boat_number].filter(Boolean).join(' ');
    return tag ? `${name} (${tag})` : name;
  };

  // Build the Save-time warning body listing each colliding place, the boats
  // sharing it, and the three resolutions the dialog offers.
  const buildConflictMessage = (conflicts: PlaceConflict[]): string => {
    const blocks = conflicts.map((conflict) => {
      const boats = conflict.boats
        .map((boat) => `   • ${describeBoat(boat.entry)}`)
        .join('\n');
      return `${conflict.label} — place ${conflict.place}:\n${boats}`;
    });
    const sample = conflicts[0];
    const split = (sample.place + (sample.place + 1)) / 2;
    return (
      'These boats now share the same finishing place — normally every ' +
      'place is unique:\n\n' +
      `${blocks.join('\n\n')}\n\n` +
      'Choose how to resolve it:\n' +
      '   • Switch places — the boat already on that place takes the place ' +
      'you moved the other boat from (every place stays unique).\n' +
      `   • Save anyway — keep the boats tied; per RRS A7 they split the ` +
      `points equally (e.g. places ${sample.place}+${sample.place + 1} → ` +
      `${split} each).\n` +
      '   • Cancel — go back and fix it yourself.'
    );
  };

  // For each conflict, work out the swap: the boat already sitting on the place
  // moves to wherever the user just moved the editing boat from. Returns extra
  // raw edits (one per displaced boat) to add to the save payload.
  const computeSwapEdits = (
    conflicts: PlaceConflict[],
    originalSource: LeaderboardEntry[],
  ): Array<{
    boatId: number;
    raceIndex: number;
    rawPosition: number;
    status: string;
  }> => {
    const swaps: Array<{
      boatId: number;
      raceIndex: number;
      rawPosition: number;
      status: string;
    }> = [];
    conflicts.forEach((conflict) => {
      // The boat(s) the user moved onto this place this session.
      const movedHere = conflict.boats.filter((boat) => {
        const edit = userEditsRef.current.get(
          `${boat.entry.boat_id}-${boat.raceIndex}`,
        );
        return edit != null && edit.rawPosition === conflict.place;
      });
      if (movedHere.length === 0) return;

      // The place that boat came from is now free — send the others there.
      const mover = movedHere[0];
      const originalEntry = originalSource.find(
        (e) => e.boat_id === mover.entry.boat_id,
      );
      const vacatedPlace = originalEntry
        ? parseRaceNum(originalEntry.races[mover.raceIndex])
        : NaN;
      if (!Number.isFinite(vacatedPlace) || vacatedPlace <= 0) return;

      conflict.boats
        .filter((boat) => boat.entry.boat_id !== mover.entry.boat_id)
        .forEach((boat) => {
          swaps.push({
            boatId: boat.entry.boat_id,
            raceIndex: boat.raceIndex,
            rawPosition: vacatedPlace,
            status: 'FINISHED',
          });
        });
    });
    return swaps;
  };

  const handleSave = async () => {
    let originalSourceSnapshot: LeaderboardEntry[] = [];
    try {
      if (!editableLeaderboard || !leaderboard) {
        throw new Error('Leaderboard data is not initialized');
      }

      const originalSource =
        activeTab === 'event' ? eventLeaderboard : leaderboard;
      originalSourceSnapshot = cloneEntries(originalSource);

      // Start from the user's raw edits; a "Switch places" choice appends more.
      const effectiveEdits = [...userEditsRef.current.values()];

      // If an edit left two boats sharing a finishing place, ask before writing.
      // Switch places → keep every place unique (the displaced boat takes the
      // place the other boat was moved from); Save anyway → keep the tie (RRS A7
      // splits the points); Cancel → write nothing and stay in edit mode.
      const placeConflicts = findPlaceConflicts(editableLeaderboard);
      if (placeConflicts.length > 0) {
        const choice = await confirmChoice(
          buildConflictMessage(placeConflicts),
          'Duplicate finishing place',
          {
            confirmLabel: 'Switch places',
            extraLabel: 'Save anyway',
            cancelLabel: 'Cancel',
            confirmClassName: 'btn-success',
            extraClassName: 'btn-danger',
          },
        );
        if (choice === 'cancel') return;
        if (choice === 'confirm') {
          effectiveEdits.push(
            ...computeSwapEdits(placeConflicts, originalSource),
          );
        }
        // 'extra' (Save anyway) keeps the tie: leave effectiveEdits unchanged.
      }

      // Send only the cells that actually changed, with the RAW position chosen;
      // the backend re-ranks each race after the write. Sending the re-ranked
      // preview values instead would not converge (see rerankRaceColumn).
      const updateOperations: SaveRaceOperation[] = [];
      effectiveEdits.forEach(({ boatId, raceIndex, rawPosition, status }) => {
        const entry = editableLeaderboard.find((e) => e.boat_id === boatId);
        if (!entry) return;
        const originalEntry = originalSource.find((e) => e.boat_id === boatId);
        const origStatus =
          originalEntry?.race_statuses?.[raceIndex] || 'FINISHED';
        const origPosition = originalEntry
          ? parseRaceNum(originalEntry.races[raceIndex])
          : NaN;
        // eslint-disable-next-line eqeqeq
        if (origPosition == rawPosition && origStatus === status) return;

        const raceId = entry.race_ids?.[raceIndex];
        if (!raceId) {
          updateOperations.push({ missingRaceId: true, boatId, raceIndex });
          return;
        }
        updateOperations.push({
          raceId,
          boatId,
          newPosition: rawPosition,
          entryStatus: status,
        });
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
      userEditsRef.current.clear();
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
  const formatCell = (race: string, status: string | undefined): string =>
    getRaceCellDisplay(race, status || 'FINISHED').displayText;

  const buildExportData = (): ExportData => {
    const parseScore = (v: unknown): number => {
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

    const grpMap = (editableLeaderboard ?? []).reduce(
      (acc, entry) => {
        const g = entry.placement_group || 'General';
        if (!acc[g]) acc[g] = [];
        acc[g].push(entry);
        return acc;
      },
      {} as Record<string, LeaderboardEntry[]>,
    );
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
    const escape = (v: unknown): string => {
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
    const pad = (v: unknown, w: number): string => String(v ?? '').padEnd(w);
    const divider = colWidths.map((w) => '-'.repeat(w)).join('-+-');
    const fmtRow = (r: ExportCell[]): string =>
      r.map((v, i) => pad(v, colWidths[i])).join(' | ');

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
    const pad = (v: unknown, w: number): string => String(v ?? '').padEnd(w);
    const fmtRow = (r: ExportCell[]): string =>
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
          if (data.cursor) {
            startY = data.cursor.y + 6;
          }
        },
      });
      // jspdf-autotable attaches `lastAutoTable` to the jsPDF instance; it is
      // always set immediately after an autoTable() call.
      const docWithTable = doc as JsPDF & {
        lastAutoTable?: { finalY: number };
      };
      startY = (docWithTable.lastAutoTable?.finalY ?? startY) + 10;
    });
    doc.save(`${safeEventName}_${seriesLabel}_${raceNumber}_leaderboard.pdf`);
  };

  // ─── Unified export dispatcher ───────────────────────────────────────────────

  const exportAs = async (format: string) => {
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
      editableLeaderboard?.reduce(
        (acc, entry) => {
          const group = entry.placement_group || 'General';
          if (!acc[group]) acc[group] = [];
          acc[group].push(entry);
          return acc;
        },
        {} as Record<string, LeaderboardEntry[]>,
      ) || {},
    [editableLeaderboard],
  );

  const sortedGroups = useMemo(() => {
    const rank = (g: string): number => {
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
