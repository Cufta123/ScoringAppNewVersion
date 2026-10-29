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
  DEFAULT_STARTING_LIST_OPTIONS,
  buildStartingListDocument,
  buildStartingListModel,
  buildStartingListWorkbook,
  startingListTitle,
  type StartingListBoat,
  type StartingListOptions,
  type StartingListSort,
} from '../../exports/startingList';
import type { ExportFormat, ExportJob } from '../../exports/exportActions';
import type { DocumentContext, HtmlTarget } from '../../exports/types';
import type { EventRow } from '../../types';

const FORMATS: ExportFormat[] = ['pdf', 'xlsx', 'html'];

const SORTS: ReadonlyArray<{ value: StartingListSort; label: string }> = [
  { value: 'sail', label: 'Sail number' },
  { value: 'country', label: 'Country' },
  { value: 'surname', label: 'Surname' },
];

interface Settings {
  common: CommonSettings;
  doc: StartingListOptions;
}

const DEFAULT_SETTINGS: Settings = {
  common: DEFAULT_COMMON_SETTINGS,
  doc: DEFAULT_STARTING_LIST_OPTIONS,
};

interface StartingListExportDialogProps {
  open: boolean;
  onClose: () => void;
  event: Pick<
    EventRow,
    'event_id' | 'event_name' | 'event_location' | 'start_date' | 'end_date'
  >;
}

/** The export dialog of the event page's entry list. */
export default function StartingListExportDialog({
  open,
  onClose,
  event,
}: StartingListExportDialogProps) {
  const eventId = event.event_id;
  const [settings, setSettings] = useExportOptions<Settings>(
    eventId,
    'startingList',
    DEFAULT_SETTINGS,
  );
  const { common, doc } = settings;
  const logo = useEventLogo(eventId, open);

  // Always the entries as saved now, read when the dialog opens.
  const [boats, setBoats] = useState<StartingListBoat[]>([]);
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const rows = await eventDB.readBoatsByEvent(eventId);
        if (!cancelled) setBoats(Array.isArray(rows) ? rows : []);
      } catch (error) {
        if (!cancelled) reportError('Could not read the entries.', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, open]);

  const flags = useMemo(
    () =>
      flagImages(boats.map((boat) => boat.country ?? boat.boat_country ?? '')),
    [boats],
  );
  // The starting list has no "Final" status: it is Provisional or Official.
  const commonOptions = useMemo(
    () =>
      toCommonOptions(
        {
          ...common,
          status: common.status === 'final' ? 'official' : common.status,
        },
        true,
      ),
    [common],
  );
  const defaultTitle = startingListTitle({ ...commonOptions, title: '' });

  const buildFor = useCallback(
    (target: HtmlTarget, generatedAt: Date) => {
      const model = buildStartingListModel(boats, doc);
      const context: DocumentContext = {
        event: eventInfoOf(event, logo.logo),
        generatedAt,
        flags,
        target,
      };
      return { model, context };
    },
    [boats, doc, event, logo.logo, flags],
  );

  const preview = useDocumentPreview(
    open,
    useCallback(() => {
      const { model, context } = buildFor('screen', new Date());
      return buildStartingListDocument(
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
        return buildStartingListDocument(
          model,
          commonOptions,
          context,
          orientation,
        );
      },
      buildWorkbook: () => {
        const { model, context } = buildFor('screen', generatedAt);
        return buildStartingListWorkbook(
          model,
          commonOptions,
          context,
          orientation,
        );
      },
    };
  }, [buildFor, commonOptions, common]);

  const { busy, exportAs, print } = useExportRunner('starting list', createJob);

  const setDoc = (
    update: (current: StartingListOptions) => StartingListOptions,
  ) => setSettings((current) => ({ ...current, doc: update(current.doc) }));
  const setColumn = (key: keyof StartingListOptions['columns'], on: boolean) =>
    setDoc((current) => ({
      ...current,
      columns: { ...current.columns, [key]: on },
    }));

  return (
    <ExportDialog
      open={open}
      title="Export starting list"
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
        statuses={['provisional', 'official']}
        logo={logo}
      />

      <OptionSection title="Starting list">
        <SelectField<StartingListSort>
          label="Sort by"
          value={doc.sort}
          options={SORTS}
          onChange={(sort) => setDoc((c) => ({ ...c, sort }))}
        />
        <CheckField
          label="Group by country, with entry counts"
          checked={doc.groupByCountry}
          onChange={(on) => setDoc((c) => ({ ...c, groupByCountry: on }))}
        />
        <CheckField
          label="Total entries line"
          checked={doc.totalEntries}
          onChange={(on) => setDoc((c) => ({ ...c, totalEntries: on }))}
        />
      </OptionSection>

      <OptionSection title="Columns">
        <CheckField
          label="Club"
          checked={doc.columns.club}
          onChange={(on) => setColumn('club', on)}
        />
        <CheckField
          label="Subgroup"
          checked={doc.columns.subgroup}
          onChange={(on) => setColumn('subgroup', on)}
        />
        <CheckField
          label="Boat model"
          checked={doc.columns.boatModel}
          onChange={(on) => setColumn('boatModel', on)}
        />
      </OptionSection>
    </ExportDialog>
  );
}
