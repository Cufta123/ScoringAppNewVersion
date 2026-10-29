import React, { useCallback, useMemo } from 'react';
import ExportDialog from './ExportDialog';
import CommonOptionsFields from './CommonOptionsFields';
import { CheckField, OptionSection, SelectField } from './OptionFields';
import useExportOptions from '../../hooks/useExportOptions';
import useDocumentPreview from '../../hooks/useDocumentPreview';
import useEventLogo from '../../hooks/useEventLogo';
import useExportRunner from '../../hooks/useExportRunner';
import {
  DEFAULT_COMMON_SETTINGS,
  eventInfoOf,
  toCommonOptions,
  type CommonSettings,
} from '../../exports/commonSettings';
import flagImages from '../../exports/flags';
import {
  DEFAULT_HEATS_OPTIONS,
  buildHeatsDocument,
  buildHeatsModel,
  buildHeatsWorkbook,
  heatsTitle,
  latestRoundKey,
  listHeatRounds,
  roundLabel,
  type HeatForExport,
  type HeatsOptions,
} from '../../exports/heats';
import type { ExportFormat, ExportJob } from '../../exports/exportActions';
import type { DocumentContext, HtmlTarget } from '../../exports/types';
import type { EventRow } from '../../types';

const FORMATS: ExportFormat[] = ['pdf', 'xlsx', 'html'];

interface Settings {
  common: CommonSettings;
  doc: HeatsOptions;
}

const DEFAULT_SETTINGS: Settings = {
  common: DEFAULT_COMMON_SETTINGS,
  doc: DEFAULT_HEATS_OPTIONS,
};

interface HeatsExportDialogProps {
  open: boolean;
  onClose: () => void;
  event: Pick<
    EventRow,
    'event_id' | 'event_name' | 'event_location' | 'start_date' | 'end_date'
  >;
  /** Every heat of the event, with its boats. */
  heats: HeatForExport[];
}

/** The export dialog of the heats: heat lists and scoring sheets. */
export default function HeatsExportDialog({
  open,
  onClose,
  event,
  heats,
}: HeatsExportDialogProps) {
  const eventId = event.event_id;
  const [settings, setSettings] = useExportOptions<Settings>(
    eventId,
    'heats',
    DEFAULT_SETTINGS,
  );
  const { common } = settings;
  const logo = useEventLogo(eventId, open);

  const rounds = useMemo(() => listHeatRounds(heats), [heats]);
  // The round last chosen if it still exists, else the latest one.
  const roundKey = rounds.some((round) => round.key === settings.doc.round)
    ? settings.doc.round
    : latestRoundKey(heats);
  // Scoring sheets are always one heat per page.
  const doc = useMemo<HeatsOptions>(
    () => ({
      ...settings.doc,
      round: roundKey,
      onePerPage: settings.doc.onePerPage || settings.doc.scoringSheets,
    }),
    [settings.doc, roundKey],
  );

  const flags = useMemo(
    () =>
      flagImages(
        heats.flatMap((heat) => heat.boats.map((b) => b.country ?? '')),
      ),
    [heats],
  );
  const commonOptions = useMemo(() => toCommonOptions(common, false), [common]);
  const defaultTitle = heatsTitle(buildHeatsModel(heats, doc), {
    ...commonOptions,
    title: '',
  });

  const buildFor = useCallback(
    (target: HtmlTarget, generatedAt: Date) => {
      const model = buildHeatsModel(heats, doc);
      const context: DocumentContext = {
        event: eventInfoOf(event, logo.logo),
        generatedAt,
        flags,
        target,
      };
      return { model, context };
    },
    [heats, doc, event, logo.logo, flags],
  );

  const preview = useDocumentPreview(
    open,
    useCallback(() => {
      const { model, context } = buildFor('screen', new Date());
      return buildHeatsDocument(
        model,
        commonOptions,
        context,
        common.orientation,
      );
    }, [buildFor, commonOptions, common.orientation]),
  );

  const createJob = useCallback((): ExportJob => {
    const generatedAt = new Date();
    const { orientation } = common;
    return {
      buildDocument: (target) => {
        const { model, context } = buildFor(target, generatedAt);
        return buildHeatsDocument(model, commonOptions, context, orientation);
      },
      buildWorkbook: () => {
        const { model, context } = buildFor('screen', generatedAt);
        return buildHeatsWorkbook(model, commonOptions, context, orientation);
      },
    };
  }, [buildFor, commonOptions, common]);

  const { busy, exportAs, print } = useExportRunner(
    doc.scoringSheets ? 'scoring sheets' : 'heat lists',
    createJob,
  );

  const setDoc = (update: (current: HeatsOptions) => HeatsOptions) =>
    setSettings((current) => ({ ...current, doc: update(current.doc) }));

  return (
    <ExportDialog
      open={open}
      title="Export heats"
      onClose={onClose}
      previewHtml={preview?.html ?? ''}
      orientation={preview?.orientation ?? 'portrait'}
      formats={FORMATS}
      busy={busy}
      onExport={exportAs}
      onPrint={print}
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
        statuses={null}
        logo={logo}
      />

      <OptionSection title="Heats">
        {rounds.length > 0 ? (
          <SelectField<string>
            label="Round"
            value={roundKey}
            options={rounds.map((round) => ({
              value: round.key,
              label: `${roundLabel(round, 'en')} (${round.heatCount} ${
                round.heatCount === 1 ? 'heat' : 'heats'
              })`,
            }))}
            onChange={(round) => setDoc((c) => ({ ...c, round }))}
          />
        ) : (
          <p className="export-hint">There are no heats to export yet.</p>
        )}
        <CheckField
          label="One heat per page"
          checked={doc.onePerPage}
          disabled={doc.scoringSheets}
          hint={
            doc.scoringSheets
              ? 'Scoring sheets always have one heat per page.'
              : undefined
          }
          onChange={(on) => setDoc((c) => ({ ...c, onePerPage: on }))}
        />
        <CheckField
          label="Scoring sheets (blank Place/Notes columns)"
          checked={doc.scoringSheets}
          onChange={(on) => setDoc((c) => ({ ...c, scoringSheets: on }))}
        />
      </OptionSection>
    </ExportDialog>
  );
}
