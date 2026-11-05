import { useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queries, useReportQueryError } from '../api/queries';
import { hasFinalHeats } from '../utils/heatView';
import {
  buildStandings,
  type BuiltStandings,
} from '../utils/leaderboardStandings';
import type { LeaderboardEntry, OverallLeaderboardEntry } from '../types';

interface Standings extends BuiltStandings {
  overallLeaderboard: OverallLeaderboardEntry[];
  /** The series the rows are of. */
  finalSeriesStarted: boolean;
}

/** The first of several reads' failures, as one (reported once). */
const firstFailure = (
  ...results: { error: unknown; errorUpdatedAt: number }[]
) => ({
  error: results.find((result) => result.error)?.error ?? null,
  errorUpdatedAt: Math.max(...results.map((result) => result.errorUpdatedAt)),
});

/**
 * The standings, read through the query cache: whether the Final Series has
 * started (from the heats), the largest heat of each series, and the
 * qualifying / final / overall rows. Every read rebuilds the standings from
 * the event's log in the main process (AGENTS.md section 4), so loading is
 * reads only; any write to the event reads them again (api/writes.ts).
 *
 * The rows change only once every read they are built from has come back,
 * so a refresh never shows final fleets next to the qualifying rows of
 * before (the reads ran together, as one Promise.all, before the cache).
 */
export default function useLeaderboardStandings(eventId: number) {
  const heats = useQuery(queries.heats(eventId));
  useReportQueryError(heats, 'Could not check final series status.');
  // LB-16 / RULE-m4: there is no separate `activeTab` state. The series being
  // viewed/edited is fully determined by `finalSeriesStarted` — the
  // leaderboard page only makes the *active* series' cells editable, so the
  // discard profile and largest heat used for an edit always match that
  // cell's series (SHRS 5.1/5.4/5.2). It can go back to false: going back in
  // the history can undo the start.
  const finalSeriesStarted = useMemo(
    () => hasFinalHeats(heats.data ?? []),
    [heats.data],
  );

  // Largest heat per series, for SHRS 5.2 (boats in the largest heat + 1).
  const maxQualifying = useQuery(queries.maxHeatSize(eventId, 'Qualifying'));
  const maxFinal = useQuery(queries.maxHeatSize(eventId, 'Final'));
  // The edit screen then scores DNF & co. from the entry count, which can
  // differ from what Save writes; say so instead of guessing quietly.
  useReportQueryError(
    firstFailure(maxQualifying, maxFinal),
    'Could not read the heat sizes. While editing, codes such as DNF may show a different score until you reload the page; Save always uses the right one.',
  );

  // The final standings are only read once the Final Series has started.
  const qualifying = useQuery(queries.qualifyingStandings(eventId));
  const final = useQuery({
    ...queries.finalStandings(eventId),
    enabled: finalSeriesStarted,
  });
  const overall = useQuery({
    ...queries.overallStandings(eventId),
    enabled: finalSeriesStarted,
  });
  useReportQueryError(
    firstFailure(qualifying, final, overall),
    'Could not load leaderboard data.',
  );

  const built = useMemo<Standings | null>(() => {
    if (!qualifying.data) return null;
    if (finalSeriesStarted && (!final.data || !overall.data)) return null;
    return {
      ...buildStandings({
        eventResults: qualifying.data,
        finalResults: finalSeriesStarted ? (final.data ?? []) : [],
        overallResults: finalSeriesStarted ? (overall.data ?? []) : [],
        finalSeriesStarted,
      }),
      overallLeaderboard: finalSeriesStarted ? (overall.data ?? []) : [],
      finalSeriesStarted,
    };
  }, [qualifying.data, final.data, overall.data, finalSeriesStarted]);

  // Keep the last complete set while any read it depends on is on its way.
  const settled =
    !heats.isFetching &&
    !qualifying.isFetching &&
    !(finalSeriesStarted && (final.isFetching || overall.isFetching));
  const shownRef = useRef<Standings | null>(null);
  if (settled && built) shownRef.current = built;
  const shown = shownRef.current;

  const failed =
    qualifying.isError ||
    (finalSeriesStarted && (final.isError || overall.isError));
  // Until the series is known and its rows are in (or could not be read).
  const loading = heats.isPending || (!shown && !failed);

  const standings: Standings = shown ?? {
    eventRows: [],
    leaderboard: [],
    overallLeaderboard: [],
    finalSeriesStarted,
  };
  return {
    leaderboard: standings.leaderboard as LeaderboardEntry[],
    eventLeaderboard: standings.eventRows,
    overallLeaderboard: standings.overallLeaderboard,
    loading,
    // The series of the rows shown (a refresh that changes it shows both
    // together).
    finalSeriesStarted: standings.finalSeriesStarted,
    maxHeatSizes: {
      qualifying: maxQualifying.data ?? 0,
      final: maxFinal.data ?? 0,
    },
  };
}
