import React, { useRef, useState } from 'react';
import Papa from 'papaparse';
import { sailorDB, type ImportSailorsResult } from '../api/db';
import type { ImportOwnerConflict } from '../../shared/importSailors';
import { describeError } from '../utils/userFeedback';

const TEMPLATE_CSV =
  'name,surname,birthday,sail_number,country,model,club_name,category_name\nJohn,Doe,,12345,CRO,Laser,YC Zagreb,M\nJane,Smith,,67890,SVN,Optimist,JK Piran,U16';

interface SailorImportProps {
  eventId: number;
  onImportComplete?: (() => void) | null;
}

function SailorImport({ eventId, onImportComplete = null }: SailorImportProps) {
  // Only name, surname, sail number and country are required — matching the
  // single-entry form. birthday, model, club and subgroup are optional.
  const REQUIRED_COLUMNS = ['name', 'surname', 'sail_number', 'country'];

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportSailorsResult | null>(null);
  // Parsed-but-not-yet-imported rows, held for a preview/confirm step so a
  // wrong file (e.g. last year's roster) isn't committed with one click.
  const [pending, setPending] = useState<{
    rows: Record<string, string>[];
    fileName: string;
    /** Rows whose boat is registered to someone else (asked about). */
    conflicts: ImportOwnerConflict[];
  } | null>(null);

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sailors_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setResult(null);
    setPending(null);

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase(),
      complete: ({ data, errors: parseErrors }) => {
        setBusy(false);
        if (parseErrors.length > 0) {
          setResult({
            imported: 0,
            skipped: 0,
            errors: parseErrors.map((err) =>
              typeof err.row === 'number'
                ? `Line ${err.row + 2} of the file: ${err.message}`
                : `The file could not be read: ${err.message}`,
            ),
          });
          return;
        }
        const cols = Object.keys(data[0] || {});
        const missing = REQUIRED_COLUMNS.filter((c) => !cols.includes(c));
        if (missing.length > 0) {
          setResult({
            imported: 0,
            skipped: 0,
            errors: [`Missing columns: ${missing.join(', ')}`],
          });
          return;
        }
        // Stage for the confirm step instead of importing straight away,
        // with the rows whose boat is someone else's, to ask about them.
        const stage = (conflicts: ImportOwnerConflict[]) =>
          setPending({ rows: data, fileName: file.name, conflicts });
        sailorDB
          .previewSailorImport(data)
          .then((preview) => stage(preview?.conflicts ?? []))
          .catch(() => stage([]));
      },
    });
  };

  const confirmImport = async (
    ownerConflicts: 'skip' | 'use-registered' = 'skip',
  ) => {
    if (!pending) return;
    setBusy(true);
    try {
      const res = await sailorDB.importSailors(
        pending.rows.map((r) => ({ ...r, eventId })),
        { ownerConflicts },
      );
      setResult(res);
      if ((res.imported ?? 0) > 0 && onImportComplete) onImportComplete();
    } catch (error) {
      setResult({
        imported: 0,
        skipped: 0,
        errors: [describeError(error, 'importing sailors')],
      });
    } finally {
      setBusy(false);
      setPending(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const cancelImport = () => {
    setPending(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        aria-label="Choose sailors CSV file"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* Action row */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setResult(null);
            fileInputRef.current?.click();
          }}
          disabled={busy}
          aria-label="Choose CSV file for sailor import"
        >
          <i className="fa fa-upload" aria-hidden="true" />
          {busy ? ' Importing…' : ' Choose CSV File'}
        </button>

        {/* Small inline template link */}
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={downloadTemplate}
          aria-label="Download CSV template"
        >
          <i className="fa fa-download" aria-hidden="true" /> Download CSV
          template
        </button>
      </div>

      {/* Column format hint */}
      <p className="muted-note">
        Required: <code>name, surname, sail_number, country (IOC code)</code>.
        Optional:{' '}
        <code>birthday (YYYY-MM-DD), model, club_name, category_name</code> —
        category accepts a subgroup code (M, GM, L, U25, U16) or a full name.
      </p>

      {/* Preview / confirm — commit only after the user reviews the file */}
      {pending && (
        <div className="info-banner" style={{ marginTop: '10px' }}>
          <p style={{ margin: '0 0 8px' }}>
            <strong>{pending.rows.length}</strong> row
            {pending.rows.length !== 1 ? 's' : ''} found in{' '}
            <strong>{pending.fileName}</strong>. Check this is the right file,
            then confirm.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Surname</th>
                  <th scope="col">Sail №</th>
                  <th scope="col">Country</th>
                </tr>
              </thead>
              <tbody>
                {pending.rows.slice(0, 5).map((r, i) => (
                  // Static preview slice that never reorders — index key is fine.
                  // eslint-disable-next-line react/no-array-index-key
                  <tr key={`preview-${i}`}>
                    <td>{r.name}</td>
                    <td>{r.surname}</td>
                    <td>{r.sail_number}</td>
                    <td>{r.country}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pending.rows.length > 5 && (
            <p className="muted-note" style={{ margin: '6px 0 0' }}>
              …and {pending.rows.length - 5} more row
              {pending.rows.length - 5 !== 1 ? 's' : ''}.
            </p>
          )}
          {pending.conflicts.length > 0 && (
            <div className="import-owner-conflicts" role="alert">
              <p>
                <i className="fa fa-triangle-exclamation" aria-hidden="true" />{' '}
                <strong>
                  {pending.conflicts.length} sail number
                  {pending.conflicts.length !== 1 ? 's are' : ' is'} already
                  registered to another sailor.
                </strong>{' '}
                Entered anyway, the boat races under the registered sailor, not
                the name in the file.
              </p>
              <ul>
                {pending.conflicts.slice(0, 8).map((conflict) => (
                  <li key={`${conflict.line}-${conflict.sail}`}>
                    Line {conflict.line}: {conflict.sail} — the file says{' '}
                    <strong>{conflict.fileName}</strong>, registered to{' '}
                    <strong>{conflict.ownerName}</strong>
                  </li>
                ))}
              </ul>
              {pending.conflicts.length > 8 && (
                <p>…and {pending.conflicts.length - 8} more.</p>
              )}
            </div>
          )}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '10px',
              marginTop: '12px',
            }}
          >
            <button
              type="button"
              className="btn-success"
              onClick={() => confirmImport('skip')}
              disabled={busy}
            >
              <i className="fa fa-check" aria-hidden="true" />{' '}
              {(() => {
                if (busy) return 'Importing…';
                const count = pending.rows.length - pending.conflicts.length;
                const what = `${count} sailor${count !== 1 ? 's' : ''}`;
                return pending.conflicts.length > 0
                  ? `Import ${what}, leave those out`
                  : `Import ${what}`;
              })()}
            </button>
            {pending.conflicts.length > 0 && (
              <button
                type="button"
                className="btn-outline"
                onClick={() => confirmImport('use-registered')}
                disabled={busy}
              >
                Import all, use the registered sailors
              </button>
            )}
            <button
              type="button"
              className="btn-secondary"
              onClick={cancelImport}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div
          className="info-banner"
          style={{ marginTop: '10px' }}
          role="status"
        >
          {(result.errors?.length ?? 0) > 0 && (
            <ul style={{ margin: '0 0 6px', paddingLeft: '18px' }}>
              {result.errors?.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          )}
          {/* Only show the import summary for an actual import result (the parse
              and missing-column failures above carry no counts). */}
          {typeof result.created === 'number' && (
            <span>
              <i
                className={`fa ${
                  result.created > 0 || (result.associated ?? 0) > 0
                    ? 'fa-check-circle'
                    : 'fa-info-circle'
                }`}
                style={{ color: 'var(--teal)', marginRight: 6 }}
              />
              {result.created > 0 && (
                <>
                  <strong>{result.created}</strong> new boat
                  {result.created !== 1 ? 's' : ''} created
                  &nbsp;&bull;&nbsp;{' '}
                </>
              )}
              {(result.associated ?? 0) > 0 && (
                <>
                  <strong>{result.associated}</strong> existing boat
                  {result.associated !== 1 ? 's' : ''} added to event
                  &nbsp;&bull;&nbsp;{' '}
                </>
              )}
              {(result.alreadyInEvent ?? 0) > 0 && (
                <>
                  <strong>{result.alreadyInEvent}</strong> already in event
                  &nbsp;&bull;&nbsp;{' '}
                </>
              )}
              {(result.invalid ?? 0) > 0 && (
                <>
                  <strong>{result.invalid}</strong> invalid row
                  {result.invalid !== 1 ? 's' : ''} skipped
                  &nbsp;&bull;&nbsp;{' '}
                </>
              )}
              {(result.ownerConflicts ?? 0) > 0 && (
                <>
                  <strong>{result.ownerConflicts}</strong> left out (boat
                  registered to another sailor)
                </>
              )}
              {result.created === 0 &&
                (result.associated ?? 0) === 0 &&
                (result.invalid ?? 0) === 0 &&
                (result.alreadyInEvent ?? 0) > 0 &&
                ' — all boats were already registered'}
              {result.created === 0 &&
                (result.associated ?? 0) === 0 &&
                (result.invalid ?? 0) === 0 &&
                !result.alreadyInEvent &&
                'No rows were imported.'}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default SailorImport;
