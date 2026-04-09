import React, { useRef, useState } from 'react';
import PropTypes from 'prop-types';
import Papa from 'papaparse';

const TEMPLATE_CSV =
  'name,surname,birthday,sail_number,country,model,club_name,category_name\nJohn,Doe,2000-06-15,12345,CRO,Laser,YC Zagreb,SENIOR\nJane,Smith,2005-03-22,67890,SVN,Optimist,JK Piran,KADET';

function SailorImport({ eventId, onImportComplete }) {
  const REQUIRED_COLUMNS = [
    'name',
    'surname',
    'birthday',
    'sail_number',
    'country',
    'model',
    'club_name',
    'category_name',
  ];

  const fileInputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sailors_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setBusy(true);
    setResult(null);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase(),
      complete: async ({ data, errors: parseErrors }) => {
        if (parseErrors.length > 0) {
          setResult({
            imported: 0,
            skipped: 0,
            errors: parseErrors.map((err) => err.message),
          });
          setBusy(false);
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
          setBusy(false);
          return;
        }
        const res = await window.electron.sqlite.sailorDB.importSailors(
          data.map((r) => ({ ...r, eventId })),
        );
        setResult(res);
        setBusy(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
        if (res.imported > 0 && onImportComplete) onImportComplete();
      },
    });
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
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          flexWrap: 'wrap',
        }}
      >
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
          className="btn-ghost"
          style={{ fontSize: '.88rem', padding: '6px 12px' }}
          onClick={downloadTemplate}
          aria-label="Download CSV template"
        >
          <i className="fa fa-download" aria-hidden="true" /> template
        </button>
      </div>

      {/* Column format hint */}
      <p
        style={{
          fontSize: '.88rem',
          color: 'var(--text-muted)',
          margin: '8px 0 0',
        }}
      >
        Columns:{' '}
        <code>
          name, surname, birthday (YYYY-MM-DD), sail_number, country (IOC code),
          model, club_name, category_name
        </code>
      </p>

      {/* Result */}
      {result && (
        <div className="info-banner" style={{ marginTop: '10px' }}>
          {result.errors?.length > 0 && (
            <ul style={{ margin: '0 0 6px', paddingLeft: '18px' }}>
              {result.errors.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          )}
          <span>
            <i
              className="fa fa-check-circle"
              style={{ color: 'var(--teal)', marginRight: 6 }}
            />
            {result.created > 0 && (
              <>
                <strong>{result.created}</strong> new boat
                {result.created !== 1 ? 's' : ''} created &nbsp;&bull;&nbsp;{' '}
              </>
            )}
            {result.associated > 0 && (
              <>
                <strong>{result.associated}</strong> existing boat
                {result.associated !== 1 ? 's' : ''} added to event
                &nbsp;&bull;&nbsp;{' '}
              </>
            )}
            {result.alreadyInEvent > 0 && (
              <>
                <strong>{result.alreadyInEvent}</strong> already in event
                &nbsp;&bull;&nbsp;{' '}
              </>
            )}
            {result.invalid > 0 && (
              <>
                <strong>{result.invalid}</strong> invalid row
                {result.invalid !== 1 ? 's' : ''} skipped
              </>
            )}
            {result.created === 0 &&
              result.associated === 0 &&
              result.invalid === 0 &&
              result.alreadyInEvent > 0 &&
              ' — all boats were already registered'}
          </span>
        </div>
      )}
    </div>
  );
}

SailorImport.propTypes = {
  eventId: PropTypes.number.isRequired,
  onImportComplete: PropTypes.func,
};

SailorImport.defaultProps = {
  onImportComplete: null,
};

export default SailorImport;
