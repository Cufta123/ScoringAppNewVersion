import { useCallback } from 'react';
import useExclusiveAction from './useExclusiveAction';
import {
  runExport,
  runPrint,
  type ExportFormat,
  type ExportJob,
} from '../exports/exportActions';

/**
 * The export and print buttons of a dialog: one runs at a time (a second click
 * while the first is saving does nothing), and each reports how it ended.
 *
 * `createJob` is called when a button is pressed, not before, so the document
 * carries the moment of the click ("Results as of ...") and the options as
 * they are then.
 */
export default function useExportRunner(
  what: string,
  createJob: () => ExportJob,
) {
  const { busy, runExclusive } = useExclusiveAction();

  const exportAs = useCallback(
    (format: ExportFormat) =>
      runExclusive(() => runExport(what, format, createJob)),
    [runExclusive, what, createJob],
  );

  const print = useCallback(
    () => runExclusive(() => runPrint(what, createJob)),
    [runExclusive, what, createJob],
  );

  return { busy, exportAs, print };
}
