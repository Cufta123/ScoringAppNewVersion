import { useMemo } from 'react';
import useDebouncedValue from './useDebouncedValue';
import type { BuiltDocument } from '../exports/types';

/** How long the options must stay unchanged before the preview is rebuilt. */
const PREVIEW_DELAY_MS = 200;

/**
 * The document the export dialog previews. `build` must change identity
 * whenever an option or the data changes (wrap it in useCallback); the
 * document is rebuilt once the changes pause, not once per click, so the
 * dialog stays quick with 80 boats and 16 races on a slow laptop. Nothing is
 * built while the dialog is closed.
 */
export default function useDocumentPreview(
  open: boolean,
  build: () => BuiltDocument,
): BuiltDocument | null {
  // Boxed, because React would call a function given to useState.
  const pending = useMemo(() => ({ build }), [build]);
  const settled = useDebouncedValue(pending, PREVIEW_DELAY_MS);
  return useMemo(() => (open ? settled.build() : null), [open, settled]);
}
