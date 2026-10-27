import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  PENALTY_CODES,
  RDG_TYPES,
  compareFleetGroups,
  parseRaceNum,
  applyExclusions,
  processLeaderboardEntry,
  getFlagCode,
  averageRacePoints,
} from '../utils/leaderboardUtils';
import {
  getOtherTiedCount,
  getNextCompareSelection,
} from '../utils/compareUtils';
import {
  confirmAction,
  confirmChoice,
  reportError,
  reportInfo,
  reportWarning,
} from '../utils/userFeedback';
import { exportLeaderboard } from '../utils/leaderboardExport';
import {
  getScoringPenaltyPoints,
  scoringPenaltyStatuses,
} from '../../shared/scoringPenalty';
import applyRaceColumnEdit from '../../shared/raceColumnEdit';
import {
  buildConflictMessage,
  computeSwapEdits,
  findPlaceConflicts,
} from '../utils/placeConflicts';
import type { UserRaceEdit } from '../utils/placeConflicts';
import { eventDB, heatRaceDB } from '../api/db';
import type {
  CompareInfo,
  LeaderboardEntry,
  OverallLeaderboardEntry,
  RawLeaderboardEntry,
  RdgMetaEntry,
  Rdg2PickerState,
} from '../types';

interface DiscardProfiles {
  qualifying: string;
  final: string;
}

interface MaxHeatSizes {
  qualifying: number;
  final: number;
}

/** A single race-result change queued by handleSave for the atomic write. */
interface SaveRaceOperation {
  raceId?: string;
  boatId: number;
  raceIndex?: number;
  newPosition?: number;
  entryStatus?: string;
  /** Shift-other-boats state when THIS edit was made (matches the preview). */
  shiftPositions?: boolean;
  /** RDG2: the races whose average was granted, so it stays live. */
  rdgRaceIds?: number[];
  missingRaceId?: boolean;
}

/** Position + scored points + status for one boat in one race column. */
interface RaceCellState {
  position: number;
  points: number;
  status: string;
}

export default function useLeaderboard(eventId: number) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [eventLeaderboard, setEventLeaderboard] = useState<LeaderboardEntry[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  // LB-16 / RULE-m4: there is no separate `activeTab` state. The series being
  // viewed/edited is fully determined by `finalSeriesStarted` — the leaderboard
  // page only makes the *active* series' cells editable (qualifying cells only
  // before finals start; final cells only after), so the discard profile and
  // largest-heat used for an edit always match that cell's series (SHRS
  // 5.1/5.4/5.2). The old `activeTab` was always kept in lockstep with
  // `finalSeriesStarted` and consumed by nothing, so it was removed.
  const [finalSeriesStarted, setFinalSeriesStarted] = useState(false);
  const [editMode, setEditMode] = useState(false);
  // True while a save (atomic write + leaderboard refetch/recompute) is running,
  // so the toolbar can disable the button and show progress instead of looking
  // frozen during the recompute.
  const [saving, setSaving] = useState(false);
  const [editableLeaderboard, setEditableLeaderboard] = useState<
    LeaderboardEntry[]
  >([]);
  // Cells the user explicitly edited this session, keyed `${boatId}-${raceIndex}`
  // → the RAW position + status the user chose (before column re-ranking). The
  // preview re-ranks for display, but the save sends only these raw edits and
  // lets the backend re-rank — saving the cascaded preview values would not
  // converge under the backend's per-operation re-rank.
  // `shift` is the "Shift other boats" toggle state AT EDIT TIME: the preview
  // applied that state, so the save must replay it per edit — applying the
  // save-time toggle to every queued edit would diverge from the preview.
  // `rdgSelection` keeps the RDG2 race choice so the average can be refreshed
  // when later edits change the boat's points in the selected races.
  const userEditsRef = useRef<Map<string, UserRaceEdit>>(new Map());
  // LB-2: synchronous re-entrancy guard for handleSave. `saving` state is
  // batched and only set AFTER the confirmChoice dialog, so two rapid clicks
  // both pass `if (saving) return`; a ref set before any await closes that.
  const savingRef = useRef(false);
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

  const activeDiscardProfile = finalSeriesStarted
    ? discardProfiles.final
    : discardProfiles.qualifying;

  // SHRS 5.4 (MEGA M-NEW-1): series-wide completed-race count for the series
  // being edited, used so edit-mode discard previews match the backend's
  // series-wide count. Column count is stable across a single cell edit, so
  // reading it from editableLeaderboard here is safe.
  const editSeriesRaceCount = Math.max(
    0,
    ...editableLeaderboard.map((e) => e.races?.length || 0),
  );

  // SHRS 5.1: the Final Series is scored per fleet, and fleets may sail
  // different numbers of races (SHRS 4.5). A final edit's discard count must
  // therefore be the largest race count in the edited boat's OWN fleet — not the
  // max across all fleets, which would over-discard boats in shorter-race
  // fleets and disagree with the fleet-wide totals the backend persists.
  const fleetEditRaceCounts = finalSeriesStarted
    ? editableLeaderboard.reduce((acc, e) => {
        const fleet = String(e.placement_group ?? 'General');
        const count = e.races?.length || 0;
        acc.set(fleet, Math.max(acc.get(fleet) ?? 0, count));
        return acc;
      }, new Map<string, number>())
    : null;

  // Discard race count for the entry currently being (re)scored: fleet-wide in
  // the Final Series, series-wide while qualifying-only.
  const getEditSeriesRaceCount = (entry: LeaderboardEntry): number =>
    finalSeriesStarted
      ? (fleetEditRaceCounts?.get(String(entry.placement_group ?? 'General')) ??
        0)
      : editSeriesRaceCount;

  // SHRS 5.2: a non-position-keeping penalty scores largest-heat-size + 1.
  // Falls back to the entry count only if heat sizes are not yet loaded.
  const getPenaltyPosition = (entryCount: number): number => {
    // RULE-m4 / SHRS 5.2: use the largest-heat size of the series whose cells are
    // editable — final once finals have started, qualifying otherwise.
    const size = finalSeriesStarted
      ? maxHeatSizes.final
      : maxHeatSizes.qualifying;
    return (size || entryCount) + 1;
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

  // LB-1: `isActive` gives the mount effect a cancellation handle so a slow
  // `readAllHeats` that resolves after unmount never calls setState, and the
  // status flip can't be applied twice.
  const checkFinalSeriesStarted = useCallback(
    async (isActive: () => boolean = () => true) => {
      try {
        const heats = await heatRaceDB.readAllHeats(eventId);
        if (!isActive()) return;
        const finalHeats = heats.filter((heat) => heat.heat_type === 'Final');
        if (finalHeats.length > 0) {
          setFinalSeriesStarted(true);
        }
      } catch (error) {
        if (isActive()) {
          reportError('Could not check final series status.', error);
        }
      }
    },
    [eventId],
  );

  useEffect(() => {
    let cancelled = false;
    checkFinalSeriesStarted(() => !cancelled);
    return () => {
      cancelled = true;
    };
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

  const fetchLeaderboard = useCallback(
    async (isActive?: () => boolean) => {
      // LB-1 / LB-5: a (re)fetch replaces the source of truth, so any queued
      // session edits are now stale. Clear them and leave edit mode BEFORE any
      // await — a late-arriving qualifying fetch must never overwrite final-series
      // data, and a fetch that throws after a successful save must not leave
      // stale edits that a retry would re-apply on top of already-persisted data.
      userEditsRef.current.clear();
      setRdgMeta({});
      setRdg2Picker(null);
      setEditMode(false);
      try {
        // If a recompute fails we still fall back to the existing DB values, but
        // the reader must be told the standings may not reflect the latest edits
        // — otherwise a real backend failure is indistinguishable from a normal
        // load and stale numbers are shown as if authoritative.
        let recomputeFailed = false;

        // Recompute the event leaderboard in the DB so that place values
        // reflect correct exclusions and SHRS 5.7 tie-breaking.
        try {
          await heatRaceDB.updateEventLeaderboard(eventId);
        } catch (error) {
          recomputeFailed = true;
          // eslint-disable-next-line no-console
          console.error('updateEventLeaderboard failed', error);
        }

        // Recompute the final leaderboard so FinalLeaderboard is always current
        // before reading (matches the pattern used for the qualifying leaderboard).
        if (finalSeriesStarted) {
          try {
            await heatRaceDB.updateFinalLeaderboard(eventId);
          } catch (error) {
            recomputeFailed = true;
            // eslint-disable-next-line no-console
            console.error('updateFinalLeaderboard failed', error);
          }
        }

        if (recomputeFailed) {
          reportWarning(
            'The leaderboard could not be fully recomputed, so the standings ' +
              'shown may not reflect the most recent scores or edits. Try ' +
              'reloading; if this keeps happening, re-check the latest race results.',
            'Standings may be out of date',
          );
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

        // LB-1: if a newer fetch superseded this one while it awaited, bail out
        // before applying any state so a late qualifying-mode result can't
        // overwrite the correct final-series data.
        if (isActive && !isActive()) return;

        const nextProfiles = {
          qualifying:
            currentEvent?.shrs_discard_profile_qualifying || 'standard',
          final: currentEvent?.shrs_discard_profile_final || 'standard',
        };
        setDiscardProfiles(nextProfiles);

        // SHRS 5.4 (MEGA M-NEW-1): the discard count keys off the races
        // completed in the series, not each boat's own race count. Qualifying is
        // series-wide (the max race count across all entered boats). The Final
        // Series is scored per fleet (SHRS 5.1; calculateFinalBoatScores uses
        // fleetRaceCounts), and fleets may sail different numbers of races
        // (SHRS 4.5) — so the final discard count is the largest race count
        // within EACH fleet, not one max across all fleets.
        const raceCountOfRow = (r: RawLeaderboardEntry): number =>
          typeof r.race_positions === 'string' && r.race_positions
            ? r.race_positions.split(',').length
            : 0;

        const seriesRaceCountOf = (rows: RawLeaderboardEntry[]): number =>
          Math.max(0, ...rows.map(raceCountOfRow));

        const fleetRaceCountsOf = (
          rows: RawLeaderboardEntry[],
        ): Map<string, number> => {
          const counts = new Map<string, number>();
          rows.forEach((r) => {
            const fleet = String(r.placement_group ?? 'General');
            counts.set(
              fleet,
              Math.max(counts.get(fleet) ?? 0, raceCountOfRow(r)),
            );
          });
          return counts;
        };

        const eventSeriesRaceCount = seriesRaceCountOf(eventResults);
        const eventLeaderboardWithRaces = eventResults
          .map((entry) =>
            processLeaderboardEntry(
              entry,
              nextProfiles.qualifying,
              eventSeriesRaceCount,
            ),
          )
          .sort((a, b) => (a.place ?? Infinity) - (b.place ?? Infinity));
        setEventLeaderboard(eventLeaderboardWithRaces);

        const results = finalSeriesStarted ? finalResults : eventResults;
        const finalFleetRaceCounts = finalSeriesStarted
          ? fleetRaceCountsOf(finalResults)
          : null;
        const leaderboardWithRaces = results.map((entry) =>
          processLeaderboardEntry(
            entry,
            finalSeriesStarted ? nextProfiles.final : nextProfiles.qualifying,
            finalSeriesStarted
              ? (finalFleetRaceCounts?.get(
                  String(entry.placement_group ?? 'General'),
                ) ?? 0)
              : eventSeriesRaceCount,
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
        // LB-1: a superseded fetch should not surface its failure — the newer
        // fetch owns the outcome.
        if (isActive && !isActive()) return;
        reportError('Could not load leaderboard data.', error);
      } finally {
        // LB-1: only the latest fetch may clear `loading`; a cancelled fetch that
        // finished early would otherwise flip it off while a newer fetch runs.
        if (!isActive || isActive()) setLoading(false);
      }
    },
    [eventId, finalSeriesStarted],
  );

  useEffect(() => {
    let cancelled = false;
    fetchLeaderboard(() => !cancelled);
    return () => {
      cancelled = true;
    };
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
        { confirmLabel: 'Discard', confirmClassName: 'btn-danger' },
      );
      if (!shouldDiscard) return;
    }

    const source = finalSeriesStarted ? leaderboard : eventLeaderboard;
    setEditableLeaderboard(cloneEntries(source));
    setRdgMeta({});
    setRdg2Picker(null);
    userEditsRef.current.clear();
    // Start every edit session with "Shift other boats" off (its default).
    // It's a powerful cascade toggle; if it silently stayed on from a previous
    // session a single place edit could reshuffle a whole heat unexpectedly.
    setShiftPositions(false);
    // Editing and comparing don't mix: row clicks (bubbling up from the edit
    // inputs) would toggle compare selection, and the compare panel reads
    // saved backend data that contradicts the on-screen draft.
    if (!editMode) {
      setCompareMode(false);
      setSelectedBoatIds([]);
    }
    setEditMode(!editMode);
  };

  // RRS A9: redress averages use the boat's POINTS in the other races. Race
  // cells hold finishing places, which differ from points for position-keeping
  // penalties (ZFP/SCP/T1), so averages must read race_points instead — with
  // the cells as fallback when the points array is absent or misaligned.
  const getPointsCellsForAverage = (entry: LeaderboardEntry): string[] =>
    entry.race_points && entry.race_points.length === entry.races.length
      ? entry.race_points.map(String)
      : entry.races.map(String);

  // RULE-M10 / SHRS 5.6: "averages shall be calculated separately for each of
  // the Qualifying and Final Series." An RDG2 average therefore only ever
  // covers races in the SAME series as the redressed cell — the boat's races on
  // the leaderboard currently being edited. Pooling qualifying and final race
  // points into one average (the previous behaviour) grants the wrong redress
  // whenever the two series have different points profiles.
  const averageSelectedRacePoints = (
    entry: LeaderboardEntry,
    seriesIndices: number[],
    excludeIdx: number,
    penaltyPos: number,
  ): number =>
    averageRacePoints(
      getPointsCellsForAverage(entry),
      new Set(seriesIndices),
      excludeIdx,
      penaltyPos,
      entry.race_statuses || [],
    );

  const computeRdgAverage = (
    races: string[],
    statuses: string[],
    excludeIdx: number,
    penaltyPos: number,
    selectedIndices: Set<number> | null = null,
  ): number =>
    // RRS A9(a)/(b): average of the boat's points in all races in the
    // series (or the selected group) except the race in question. Penalty
    // scores are her points and are included in the average.
    averageRacePoints(races, selectedIndices, excludeIdx, penaltyPos, statuses);

  // Position-keeping penalties (ZFP/SCP/T1) display their finishing place, but
  // score more points (RRS 44.3c/T1). The race cells store the place, so the
  // edit-mode preview total must convert those cells to their penalty points
  // via the shared getScoringPenaltyPoints before summing.
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
    entry: LeaderboardEntry,
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
      getEditSeriesRaceCount(entry),
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

  // RRS A9: a redress average must reflect the boat's ACTUAL points, so RDG1/
  // RDG2 cells granted THIS session are recomputed whenever an edit changes any
  // race points they average over (the boat's own races, including shift-mode
  // ripples caused by edits to other boats). The refreshed average replaces
  // both the visible cell and the queued raw edit, so the save persists the
  // up-to-date value. RDG cells loaded from the DB are left untouched — they
  // were granted against an earlier state and are not this session's to alter.
  const refreshSessionRdgAverages = (
    rows: LeaderboardEntry[],
  ): LeaderboardEntry[] => {
    // All averages are computed from the SAME snapshot (the rows as passed in,
    // i.e. right after the triggering edit). RDG cells can reference each
    // other's points; cascading each refresh into the next would make the
    // result depend on edit-map iteration order.
    const snapshot = rows;
    let next = rows;
    userEditsRef.current.forEach((edit, key) => {
      if (edit.status !== 'RDG1' && edit.status !== 'RDG2') return;
      const snapEntry = snapshot.find((e) => e.boat_id === edit.boatId);
      const entryIdx = next.findIndex((e) => e.boat_id === edit.boatId);
      if (!snapEntry || entryIdx === -1) return;
      const entry = next[entryIdx];
      const penaltyPosition = getPenaltyPosition(next.length);

      let avg: number;
      if (edit.status === 'RDG1') {
        avg = computeRdgAverage(
          getPointsCellsForAverage(snapEntry),
          snapEntry.race_statuses,
          edit.raceIndex,
          penaltyPosition,
        );
      } else {
        const selection = edit.rdgSelection;
        if (!selection) return;
        // SHRS 5.6: same-series races only — see confirmRdg2.
        avg = averageSelectedRacePoints(
          snapEntry,
          selection.seriesIndices,
          edit.raceIndex,
          penaltyPosition,
        );
      }

      if (avg === edit.rawPosition) return;
      userEditsRef.current.set(key, { ...edit, rawPosition: avg });

      const { rawRaces, statuses } = getEntryScoreInputs(entry);
      rawRaces[edit.raceIndex] = String(avg);
      statuses[edit.raceIndex] = edit.status;
      const { markedRaces, scoreFields } = recomputeEntryScores(
        entry,
        rawRaces,
        statuses,
        penaltyPosition,
      );
      const refreshedEntry = {
        ...entry,
        races: markedRaces,
        ...scoreFields,
        race_statuses: statuses,
        ...(finalSeriesStarted
          ? {
              total_points_combined:
                (Number(entry.qualifying_points) || 0) +
                scoreFields.computed_total,
            }
          : {}),
      };
      next = next.map((e, i) => (i === entryIdx ? refreshedEntry : e));
    });
    return next;
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

    // LB-3: choosing any status other than RDG2 for a cell closes its open RDG2
    // picker. Without this, the picker stays open after e.g. DNS/FINISHED and
    // `confirmRdg2` (Apply) would silently revert the user back to RDG2.
    if (
      rdg2Picker &&
      rdg2Picker.boatId === boatId &&
      rdg2Picker.raceIndex === raceIndex &&
      newStatus !== 'RDG2'
    ) {
      setRdg2Picker(null);
    }

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
      (newStatus === 'RDG3' || newStatus === 'DPI') &&
      newRaceValue !== null &&
      Number.isNaN(fallbackInput)
    )
      return;
    // Position-keeping penalties (ZFP/SCP/T1) take a typed finishing place, so
    // reject unusable input the same way a plain finish does.
    if (
      scoringPenaltyStatuses.has(newStatus) &&
      newRaceValue !== null &&
      (Number.isNaN(fallbackInput) || fallbackInput < 0)
    ) {
      return;
    }
    const penaltyPosition = getPenaltyPosition(cloned.length);
    const maxBoats = penaltyPosition - 1;

    // Resolve the edited cell's position + scored points before column re-rank.
    let newPosition: number;
    let newPoints: number;
    if (newStatus === 'RDG1') {
      newPosition = computeRdgAverage(
        getPointsCellsForAverage(targetEntry),
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
    } else if (newStatus === 'DPI') {
      // RRS A10: DPI (discretionary penalty imposed) points are set by the
      // protest committee. The typed value IS the race score (like RDG3), never
      // auto-derived from the heat size. A null value (status just selected)
      // seeds from the existing cell so the user can then type the PC's number.
      if (newRaceValue === null) {
        const raw = parseFloat(
          String(targetEntry.races[raceIndex]).replace(/[()]/g, ''),
        );
        newPosition = Number.isNaN(raw) ? 0 : raw;
      } else {
        newPosition = fallbackInput;
      }
      newPoints = newPosition;
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

    // RULE-M16 / RRS A6.1 and the manual ripple are both decided inside
    // shared/raceColumnEdit; the hook only supplies the before/after facts.
    const previousCellStatus =
      targetEntry.race_statuses?.[raceIndex] || 'FINISHED';

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
    // Plain finishes AND position-keeping penalties hold a real finishing
    // place, so both are clamped; hard-penalty/RDG cells keep their computed
    // value.
    const heatSize = groupIdx.length || 1;
    const keepsFinishingPlace = scoringPenaltyStatuses.has(newStatus);
    if (newStatus === 'FINISHED' || keepsFinishingPlace) {
      newPosition = Math.min(Math.max(Math.round(newPosition), 1), heatSize);
      newPoints = keepsFinishingPlace
        ? getScoringPenaltyPoints(newPosition, maxBoats, newStatus)
        : newPosition;
    }

    // Remember the raw user edit for the save payload (backend applies it).
    userEditsRef.current.set(`${boatId}-${raceIndex}`, {
      boatId,
      raceIndex,
      rawPosition: newPosition,
      status: newStatus,
      shift: shiftPositions,
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
        getEditSeriesRaceCount(entry),
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

    // The RRS A6.1 promotion, the manual ripple and the RRS A7 re-average all
    // live in shared/raceColumnEdit, which the main process runs too — so this
    // preview cannot show something other than what Save persists.
    const editedPosition = groupIdx.indexOf(
      cloned.findIndex((entry) => entry.boat_id === boatId),
    );
    const column: RaceCellState[] = groupIdx.map((idx) => {
      const entry = cloned[idx];
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

    const ranked = applyRaceColumnEdit(column, {
      index: editedPosition,
      previousPosition: oldPosition,
      previousStatus: previousCellStatus,
      newPosition,
      newPoints,
      newStatus,
      shiftPositions,
      maxBoats,
    });

    const rankedByIdx = new Map<number, RaceCellState>();
    groupIdx.forEach((idx, i) => rankedByIdx.set(idx, ranked[i]));

    const updated = cloned.map((entry, idx) => {
      const cell = rankedByIdx.get(idx);
      // Boats in other races are never touched by an edit in this race.
      if (!cell) return entry;
      return recomputeEntry(entry, cell.position, cell.points, cell.status);
    });

    setEditableLeaderboard(refreshSessionRdgAverages(updated));
  };

  const confirmRdg2 = () => {
    if (!rdg2Picker) return;
    const { boatId, raceIndex, selectedIndices } = rdg2Picker;
    const cloned = cloneEntries(editableLeaderboard);
    const entry = cloned.find((e) => e.boat_id === boatId);
    if (!entry) {
      setRdg2Picker(null);
      return;
    }

    // LB-3: only apply RDG2 while the picker is still this cell's intent. The
    // picker is closed the moment a non-RDG2 status is applied to the cell
    // (handleRaceChange + ScoreCell), so the `if (!rdg2Picker) return` above is
    // the guard: a live picker here means the status has not been overridden
    // since it opened, and applying RDG2 is safe.

    const penaltyPosition = getPenaltyPosition(cloned.length);

    // RRS A9(b): average of her points in the selected group of races.
    // Penalty scores are her points and are included.
    // SHRS 5.6 (RULE-M10): the group is confined to the series the redressed
    // cell belongs to. `entry` is the row on the leaderboard being edited, so
    // its races are exactly that series' races.
    const seriesIndices = [...(selectedIndices || new Set<number>())];
    const avg = averageSelectedRacePoints(
      entry,
      seriesIndices,
      raceIndex,
      penaltyPosition,
    );

    const { rawRaces, statuses } = getEntryScoreInputs(entry);
    rawRaces[raceIndex] = String(avg);
    statuses[raceIndex] = 'RDG2';

    // Record the raw edit so handleSave persists this RDG2 cell. Saved with
    // shift OFF: the preview replaces only this cell (no column re-rank), so
    // the backend must do the same. The selection is kept so the average can
    // be refreshed if later edits change the selected races' points.
    userEditsRef.current.set(`${boatId}-${raceIndex}`, {
      boatId,
      raceIndex,
      rawPosition: avg,
      status: 'RDG2',
      shift: false,
      rdgSelection: { seriesIndices },
    });

    const { markedRaces, scoreFields } = recomputeEntryScores(
      entry,
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

    // The selected races are always in the edited cell's own series (SHRS 5.6),
    // so one prefix covers them all: F… once the final series started, Q… while
    // the event is still qualifying-only.
    const currentSeriesPrefix = finalSeriesStarted ? 'F' : 'Q';
    const selectedRaceLabels = [...seriesIndices]
      .sort((a, b) => a - b)
      .map((i) => `${currentSeriesPrefix}${i + 1}`);
    setRdgMeta((prev) => ({
      ...prev,
      [`${boatId}-${raceIndex}`]: { type: 'RDG2', selectedRaceLabels },
    }));
    // This RDG2 changes the boat's points in this race, which can feed other
    // session-granted RDG averages on the same boat — refresh them too.
    setEditableLeaderboard(
      refreshSessionRdgAverages(
        cloned.map((e) => (e.boat_id === boatId ? updatedEntry : e)),
      ),
    );
    setRdg2Picker(null);
  };

  const handleSave = async () => {
    // LB-2: synchronous re-entrancy guard (see savingRef declaration). `saving`
    // state is set only after the confirm dialog, so it cannot block a second
    // click that arrives while that dialog is open.
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      if (!editableLeaderboard || !leaderboard) {
        throw new Error('Leaderboard data is not initialized');
      }

      const originalSource = finalSeriesStarted
        ? leaderboard
        : eventLeaderboard;

      // Start from the user's raw edits; a "Switch places" choice merges more.
      // Keyed by `${boatId}-${raceIndex}` so a swap edit overrides (rather than
      // duplicates) an existing edit for the same cell.
      const effectiveEditMap = new Map(userEditsRef.current);

      // If an edit left two boats sharing a finishing place, ask before writing.
      // Switch places → keep every place unique (the displaced boat takes the
      // place the other boat was moved from); Save anyway → keep the tie (RRS A7
      // splits the points); Cancel → write nothing and stay in edit mode.
      const placeConflicts = findPlaceConflicts(
        editableLeaderboard,
        userEditsRef.current,
        finalSeriesStarted,
      );
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
          computeSwapEdits(
            placeConflicts,
            editableLeaderboard,
            userEditsRef.current,
          ).forEach((swap) => {
            effectiveEditMap.set(`${swap.boatId}-${swap.raceIndex}`, swap);
          });
        }
        // 'extra' (Save anyway) keeps the tie: leave effectiveEdits unchanged.
      }

      // Send only the cells that actually changed, with the RAW position chosen;
      // the backend re-ranks each race after the write. Sending the re-ranked
      // preview values instead would not converge (see rerankRaceColumn).
      // Each operation carries the shift-toggle state from when the edit was
      // made, so the backend replays exactly what the preview showed even if
      // the toggle was flipped between edits.
      const updateOperations: SaveRaceOperation[] = [];
      effectiveEditMap.forEach(
        ({ boatId, raceIndex, rawPosition, status, shift, rdgSelection }) => {
          const entry = editableLeaderboard.find((e) => e.boat_id === boatId);
          if (!entry) return;
          const originalEntry = originalSource.find(
            (e) => e.boat_id === boatId,
          );
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
            shiftPositions: shift,
            ...(status === 'RDG2' && rdgSelection
              ? {
                  rdgRaceIds: rdgSelection.seriesIndices
                    .map((i) => Number(entry.race_ids?.[i]))
                    .filter((id) => Number.isFinite(id)),
                }
              : {}),
          });
        },
      );

      const missingRaceIdOperation = updateOperations.find(
        (operation) => operation.missingRaceId,
      );
      if (missingRaceIdOperation) {
        throw new Error(
          `Cannot save race updates: missing race ID for boat ${missingRaceIdOperation.boatId}.`,
        );
      }

      setSaving(true);
      try {
        await heatRaceDB.saveLeaderboardRaceResultsAtomic(
          eventId,
          updateOperations,
          shiftPositions,
          finalSeriesStarted,
        );

        // LB-5: clear the queued edits and leave edit mode BEFORE refetching.
        // If the refetch throws, the save has still persisted — leaving these
        // here (in the old ordering) meant a retry re-sent stale pre-save edits
        // on top of the already-persisted data.
        userEditsRef.current.clear();
        setRdgMeta({});
        setRdg2Picker(null);
        setEditMode(false);

        await fetchLeaderboard();
        reportInfo(
          'Your leaderboard changes have been saved.',
          'Leaderboard saved',
        );
      } finally {
        setSaving(false);
      }
    } catch (error) {
      // Keep the draft, the queued edits, and edit mode intact so the user can
      // fix the problem and retry. Resetting only the visible state here would
      // leave the queued edits invisible but still pending — a later save
      // would silently resend work the user could no longer see.
      reportError('Could not save leaderboard changes.', error);
    } finally {
      savingRef.current = false;
    }
  };

  // ─── Export ──────────────────────────────────────────────────────────────────

  // Exporting reads finished data only, so it lives in utils/leaderboardExport
  // as plain functions; the hook just hands it the current view.
  const exportAs = (format: string) =>
    exportLeaderboard(format, {
      eventId,
      finalSeriesStarted,
      leaderboard,
      eventLeaderboard,
    });

  // ─── Derived values ──────────────────────────────────────────────────────────

  const hasEventData = eventLeaderboard.length > 0;
  // "Final data" means at least one final race has been scored — not merely
  // that fleets exist. Fleet rows now persist from the moment the final series
  // starts (so unraced fleets stay visible once ANY fleet has raced), but with
  // zero races everywhere the page must still show the qualifying standings
  // (SHRS 1.5) behind the "final series ready" notice.
  const hasFinalData = leaderboard.some(
    (entry) => (entry.races?.length ?? 0) > 0,
  );

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

  // SHRS 5.5 fleet precedence, shared with the export grouping and the main
  // process so every fleet — including the 5th and later — has a real rank.
  const sortedGroups = useMemo(
    () => Object.keys(groupedLeaderboard).sort(compareFleetGroups),
    [groupedLeaderboard],
  );

  return {
    // State
    leaderboard,
    eventLeaderboard,
    loading,
    finalSeriesStarted,
    editMode,
    saving,
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
    exportAs,
    getFlagCode,
  };
}
