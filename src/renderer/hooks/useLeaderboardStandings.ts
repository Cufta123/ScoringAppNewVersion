import { useState, useEffect, useCallback } from 'react';
import { eventDB, heatRaceDB } from '../api/db';
import { reportError } from '../utils/userFeedback';
import { hasFinalHeats } from '../utils/heatView';
import {
  buildStandings,
  type DiscardProfiles,
} from '../utils/leaderboardStandings';
import type { LeaderboardEntry, OverallLeaderboardEntry } from '../types';

interface MaxHeatSizes {
  qualifying: number;
  final: number;
}

/**
 * What the edit session must do around a (re)load. Both callbacks must be
 * stable (they are dependencies of the loader).
 */
interface LoadCallbacks {
  /** Called before the first await: a reload makes queued edits stale. */
  onReload: () => void;
  /** Called with the freshly built rows, in the same step as the standings. */
  onLoaded: (rows: LeaderboardEntry[]) => void;
}

/**
 * Loading the standings: whether the Final Series has started, the largest heat
 * of each series, and the qualifying / final / overall rows. Every read rebuilds
 * the standings from the scores in the main process (AGENTS.md section 4), so
 * loading is reads only.
 */
export default function useLeaderboardStandings(
  eventId: number,
  { onReload, onLoaded }: LoadCallbacks,
) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [eventLeaderboard, setEventLeaderboard] = useState<LeaderboardEntry[]>(
    [],
  );
  const [overallLeaderboard, setOverallLeaderboard] = useState<
    OverallLeaderboardEntry[]
  >([]);
  const [loading, setLoading] = useState(true);
  // LB-16 / RULE-m4: there is no separate `activeTab` state. The series being
  // viewed/edited is fully determined by `finalSeriesStarted` — the leaderboard
  // page only makes the *active* series' cells editable (qualifying cells only
  // before finals start; final cells only after), so the discard profile and
  // largest-heat used for an edit always match that cell's series (SHRS
  // 5.1/5.4/5.2). The old `activeTab` was always kept in lockstep with
  // `finalSeriesStarted` and consumed by nothing, so it was removed.
  const [finalSeriesStarted, setFinalSeriesStarted] = useState(false);
  const [discardProfiles, setDiscardProfiles] = useState<DiscardProfiles>({
    qualifying: 'standard',
    final: 'standard',
  });
  // Largest-heat size per series, used for SHRS 5.2 penalty scoring
  // (penalty points = largest heat size + 1). Sourced from the main process.
  const [maxHeatSizes, setMaxHeatSizes] = useState<MaxHeatSizes>({
    qualifying: 0,
    final: 0,
  });

  // LB-1: `isActive` gives the mount effect a cancellation handle so a slow
  // `readAllHeats` that resolves after unmount never calls setState, and the
  // status flip can't be applied twice.
  const checkFinalSeriesStarted = useCallback(
    async (isActive: () => boolean = () => true) => {
      try {
        const heats = await heatRaceDB.readAllHeats(eventId);
        if (!isActive()) return;
        // Can go back to false: going back in the history can undo the start.
        setFinalSeriesStarted(hasFinalHeats(heats));
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
      } catch (error) {
        // The edit screen then scores DNF & co. from the entry count, which
        // can differ from what Save writes; say so instead of guessing quietly.
        if (!cancelled) {
          reportError(
            'Could not read the heat sizes. While editing, codes such as DNF may show a different score until you reload the page; Save always uses the right one.',
            error,
          );
        }
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
      onReload();
      try {
        // Every read below rebuilds the standings from the scores in the main
        // process first (AGENTS.md section 4), so no separate recompute call is
        // needed here. The final standings are only used once the Final Series
        // has started.
        const [finalResults, eventResults, overallResults] = await Promise.all([
          finalSeriesStarted
            ? heatRaceDB.readFinalLeaderboard(eventId)
            : Promise.resolve([]),
          heatRaceDB.readLeaderboard(eventId),
          finalSeriesStarted
            ? heatRaceDB.readOverallLeaderboard(eventId)
            : Promise.resolve([]),
        ]);

        const events = await eventDB.readAllEvents();
        const currentEvent = Array.isArray(events)
          ? events.find((event) => String(event.event_id) === String(eventId))
          : null;

        // LB-1: if a newer fetch superseded this one while it awaited, bail out
        // before applying any state so a late qualifying-mode result can't
        // overwrite the correct final-series data.
        if (isActive && !isActive()) return;

        const profiles = {
          qualifying:
            currentEvent?.shrs_discard_profile_qualifying || 'standard',
          final: currentEvent?.shrs_discard_profile_final || 'standard',
        };
        setDiscardProfiles(profiles);

        const { eventRows, leaderboard: rows } = buildStandings({
          eventResults,
          finalResults,
          overallResults,
          finalSeriesStarted,
          profiles,
        });
        setEventLeaderboard(eventRows);
        if (finalSeriesStarted) {
          setOverallLeaderboard(overallResults);
        }
        setLeaderboard(rows);
        onLoaded(rows);
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
    [eventId, finalSeriesStarted, onReload, onLoaded],
  );

  useEffect(() => {
    let cancelled = false;
    fetchLeaderboard(() => !cancelled);
    return () => {
      cancelled = true;
    };
  }, [fetchLeaderboard]);

  return {
    leaderboard,
    eventLeaderboard,
    overallLeaderboard,
    loading,
    finalSeriesStarted,
    discardProfiles,
    maxHeatSizes,
    fetchLeaderboard,
    checkFinalSeriesStarted,
  };
}
