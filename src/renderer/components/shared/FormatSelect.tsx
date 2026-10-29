import React, { useId } from 'react';

export type ExportFormat = 'excel' | 'pdf' | 'html';

interface FormatSelectProps {
  /** What the file is, for screen readers: "Starting list format". */
  ariaLabel: string;
  value: ExportFormat;
  onChange: (format: ExportFormat) => void;
}

/**
 * The file format choice next to a Print / export button. The visible
 * "Format" label says what the dropdown is (a bare "Excel" did not), and the
 * aria-label says what the format is OF.
 */
export default function FormatSelect({
  ariaLabel,
  value,
  onChange,
}: FormatSelectProps) {
  const id = useId();
  return (
    <label className="format-select" htmlFor={id}>
      <span>Format</span>
      <select
        id={id}
        className="compact-select"
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value as ExportFormat)}
      >
        <option value="excel">Excel</option>
        <option value="pdf">PDF</option>
        <option value="html">HTML</option>
      </select>
    </label>
  );
}
