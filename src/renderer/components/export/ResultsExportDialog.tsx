import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ExportDialog from './ExportDialog';
import CommonOptionsFields from './CommonOptionsFields';
import { CheckField, OptionSection, SelectField } from './OptionFields';
import useExportOptions from '../../hooks/useExportOptions';
import useDocumentPreview from '../../hooks/useDocumentPreview';
import useEventLogo from '../../hooks/useEventLogo';
import useExportRunner from '../../hooks/useExportRunner';
import { eventDB } from '../../api/db';
import { reportError } from '../../utils/userFeedback';
import {
  DEFAULT_COMMON_SETTINGS,
  eventInfoOf,
  toCommonOptions,
  type CommonSettings,
} from '../../exports/commonSettings';
import flagImages from '../../exports/flags';
import {
  DEFAULT_RESULTS_OPTIONS,
  buildResultsModel,
  finalFleetNames,
  type ResultsInput,
  type ResultsOptions,
  type ResultsSeries,
} from '../../exports/resultsModel';
import { buildResultsDocument } from '../../exports/resultsDocument';
import {
  buildResultsCsv,
  buildResultsMarkdown,
  buildResultsText,
} from '../../exports/resultsText';
import buildResultsWorkbook from '../../exports/resultsExcel';
import { defaultResultsTitle } from '../../exports/resultsCopy';
import type { ExportFormat, ExportJob } from '../../exports/exportActions';
import type { DocumentContext, HtmlTarget } from '../../exports/types';
import type { EventRow, LeaderboardEntry } from '../../types';

const FORMATS: ExportFormat[] = ['pdf', 'xlsx', 'html', 'csv', 'txt', 'md'];

interface ResultsSettings {
  common: CommonSettings;
  doc: ResultsOptions;
}

const DEFAULT_SETTINGS: ResultsSettings = {
  common: DEFAULT_COMMON_SETTINGS,
  doc: DEFAULT_RESULTS_OPTIONS,
};

const SERIES_CHOICES: ReadonlyArray<{ value: ResultsSeries; label: string }> = [
  { value: 'both', label: 'Overall (qualifying and final)' },
  { value: 'qualifying', label: 'Qualifying series only' },
  { value: 'final', label: 'Final series only' },
];

interface ResultsExportDialogProps {
  open: boolean;
  onClose: () => void;
  event: Pick<
    EventRow,
    'event_id' | 'event_name' | 'event_location' | 'start_date' | 'end_date'
  >;
  finalSeriesStarted: boolean;
  /**
   * The SAVED standings, never the edit draft: an export made while results
   * are being edited must not carry unsaved values.
   */
  leaderboard: LeaderboardEntry[];
  eventLeaderboard: LeaderboardEntry[];
  discardProfiles: { qualifying: string; final: string };
  /** Unsaved edits exist; the exports do not include them. */
  hasUnsavedEdits?: boolean;
}

/** The export dialog of the leaderboard / results page. */
export default function ResultsExportDialog({
  open,
  onClose,
  event,
  finalSeriesStarted,
  leaderboard,
  eventLeaderboard,
  discardProfiles,
  hasUnsavedEdits = false,
}: ResultsExportDialogProps) {
  const eventId = event.event_id;
  const [settings, setSettings] = useExportOptions<ResultsSettings>(
    eventId,
    'results',
    DEFAULT_SETTINGS,
  );
  const { common, doc } = settings;
  const logo = useEventLogo(eventId, open);

  // The Club column needs the club of each boat, which the standings rows do
  // not carry: read it from the entry list when the dialog opens.
  const [clubs, setClubs] = useState<Record<number, string>>({});
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const boats = await eventDB.readBoatsByEvent(eventId);
        if (cancelled) return;
        const byBoat: Record<number, string> = {};
        boats.forEach((boat) => {
          const club = (boat.club_name ?? '').trim();
          if (club) byBoat[boat.boat_id] = club;
        });
        setClubs(byBoat);
      } catch (error) {
        if (!cancelled)
          reportError('Could not read the clubs of the boats.', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, open]);
  const hasClubs = Object.keys(clubs).length > 0;

  const input = useMemo<ResultsInput>(
    () => ({
      finalSeriesStarted,
      leaderboard,
      eventLeaderboard,
      discardProfiles,
      clubs,
    }),
    [finalSeriesStarted, leaderboard, eventLeaderboard, discardProfiles, clubs],
  );
  const fleets = useMemo(() => finalFleetNames(input), [input]);
  const flags = useMemo(
    () =>
      flagImages(
        [...eventLeaderboard, ...leaderboard].map((row) => row.country ?? ''),
      ),
    [eventLeaderboard, leaderboard],
  );

  // Chosen fleets that no longer exist are dropped; none chosen = all.
  const chosenFleets = doc.fleets
    ? fleets.filter((fleet) => doc.fleets?.includes(fleet))
    : fleets;
  const effective = useMemo<ResultsOptions>(
    () => ({
      ...doc,
      fleets: doc.fleets ? chosenFleets : null,
      columns: { ...doc.columns, club: doc.columns.club && hasClubs },
    }),
    [doc, chosenFleets, hasClubs],
  );
  const series: ResultsSeries = finalSeriesStarted ? doc.series : 'qualifying';
  const defaultTitle = defaultResultsTitle(series, common.language);

  const commonOptions = useMemo(() => toCommonOptions(common, true), [common]);

  /** One document, built from the options as they are right now. */
  const buildFor = useCallback(
    (target: HtmlTarget, generatedAt: Date) => {
      const model = buildResultsModel(input, effective);
      const context: DocumentContext = {
        event: eventInfoOf(event, logo.logo),
        generatedAt,
        flags,
        target,
      };
      return { model, context };
    },
    [input, effective, event, logo.logo, flags],
  );

  const preview = useDocumentPreview(
    open,
    useCallback(() => {
      const { model, context } = buildFor('screen', new Date());
      return buildResultsDocument(
        model,
        commonOptions,
        context,
        common.orientation,
      );
    }, [buildFor, commonOptions, common.orientation]),
  );

  const createJob = useCallback((): ExportJob => {
    const generatedAt = new Date();
    const { orientation, language } = common;
    return {
      buildDocument: (target) => {
        const { model, context } = buildFor(target, generatedAt);
        return buildResultsDocument(model, commonOptions, context, orientation);
      },
      buildWorkbook: () => {
        const { model, context } = buildFor('screen', generatedAt);
        return buildResultsWorkbook(model, commonOptions, context, orientation);
      },
      buildText: (format) => {
        const { model, context } = buildFor('screen', generatedAt);
        if (format === 'csv') return buildResultsCsv(model, language);
        if (format === 'md') {
          return buildResultsMarkdown(model, commonOptions, context);
        }
        return buildResultsText(model, commonOptions, context);
      },
    };
  }, [buildFor, commonOptions, common]);

  const { busy, exportAs, print } = useExportRunner('results', createJob);

  const setDoc = (update: (current: ResultsOptions) => ResultsOptions) =>
    setSettings((current) => ({ ...current, doc: update(current.doc) }));
  const setColumn = (key: keyof ResultsOptions['columns'], on: boolean) =>
    setDoc((current) => ({
      ...current,
      columns: { ...current.columns, [key]: on },
    }));
  const toggleFleet = (fleet: string, on: boolean) =>
    setDoc((current) => {
      const now = new Set(current.fleets ?? fleets);
      if (on) now.add(fleet);
      else now.delete(fleet);
      const next = fleets.filter((name) => now.has(name));
      return {
        ...current,
        fleets: next.length === fleets.length ? null : next,
      };
    });

  const showFleets =
    finalSeriesStarted && series !== 'qualifying' && fleets.length > 1;

  const orientation =
    preview?.orientation ??
    (common.orientation === 'portrait' ? 'portrait' : 'landscape');

  return (
    <ExportDialog
      open={open}
      title="Export results"
      onClose={onClose}
      previewHtml={preview?.html ?? ''}
      orientation={orientation}
      formats={FORMATS}
      busy={busy}
      onExport={exportAs}
      onPrint={print}
      notice={
        hasUnsavedEdits
          ? 'Unsaved edits are not included: the documents show the saved results.'
          : null
      }
    >
      <CommonOptionsFields
        settings={common}
        onChange={(update) =>
          setSettings((current) => ({
            ...current,
            common: update(current.common),
          }))
        }
        defaultTitle={defaultTitle}
        statuses={['provisional', 'official', 'final']}
        logo={logo}
      />

      <OptionSection title="Results">
        {finalSeriesStarted && (
          <SelectField<ResultsSeries>
            label="Series"
            value={doc.series}
            options={SERIES_CHOICES}
            onChange={(value) => setDoc((c) => ({ ...c, series: value }))}
          />
        )}
        {showFleets && (
          <div className="export-group" role="group" aria-label="Fleets">
            {fleets.map((fleet) => (
              <CheckField
                key={fleet}
                label={`${fleet} fleet`}
                checked={chosenFleets.includes(fleet)}
                onChange={(on) => toggleFleet(fleet, on)}
              />
            ))}
          </div>
        )}
      </OptionSection>

      <OptionSection title="Columns">
        <CheckField
          label="Country"
          checked={doc.columns.country}
          onChange={(on) => setColumn('country', on)}
        />
        {hasClubs && (
          <CheckField
            label="Club"
            checked={doc.columns.club}
            onChange={(on) => setColumn('club', on)}
          />
        )}
        <CheckField
          label="Total"
          checked={doc.columns.total}
          onChange={(on) => setColumn('total', on)}
        />
        <CheckField
          label="Net"
          checked={doc.columns.net}
          onChange={(on) => setColumn('net', on)}
        />
        <CheckField
          label="Race columns"
          checked={doc.columns.races}
          onChange={(on) => setColumn('races', on)}
        />
      </OptionSection>

      <OptionSection title="Details">
        <CheckField
          label="Show penalty points (ZFP 5.2)"
          checked={doc.showPenaltyPoints}
          onChange={(on) => setDoc((c) => ({ ...c, showPenaltyPoints: on }))}
        />
        <CheckField
          label="Show discards in brackets"
          checked={doc.showDiscards}
          onChange={(on) => setDoc((c) => ({ ...c, showDiscards: on }))}
        />
        <CheckField
          label="Legend of the codes used"
          checked={doc.legend}
          onChange={(on) => setDoc((c) => ({ ...c, legend: on }))}
        />
        <CheckField
          label="Races sailed and discards line"
          checked={doc.raceSummary}
          onChange={(on) => setDoc((c) => ({ ...c, raceSummary: on }))}
        />
        {showFleets && (
          <CheckField
            label="Start each fleet on a new page"
            checked={doc.fleetPerPage}
            onChange={(on) => setDoc((c) => ({ ...c, fleetPerPage: on }))}
          />
        )}
      </OptionSection>
    </ExportDialog>
  );
}
