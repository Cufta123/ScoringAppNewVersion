import React, { useRef } from 'react';
import useDialogFocus from '../../hooks/useDialogFocus';
import PreviewFrame from './PreviewFrame';
import { FORMAT_LABELS, type ExportFormat } from '../../exports/exportActions';
import type { Orientation } from '../../exports/types';
import './ExportDialog.css';

interface ExportDialogProps {
  open: boolean;
  /** "Export results": names the dialog for screen readers and sighted users. */
  title: string;
  onClose: () => void;
  /** The option controls (left pane). */
  children: React.ReactNode;
  /** The exact HTML document the formats are made from. */
  previewHtml: string;
  orientation: Orientation;
  formats: ExportFormat[];
  /** An export or print is running: every button waits. */
  busy: boolean;
  onExport: (format: ExportFormat) => void;
  onPrint: () => void;
  /** One line above the buttons (for example a warning about unsaved edits). */
  notice?: string | null;
}

/**
 * The frame of every export dialog: options on the left, the live preview of
 * the document on the right, and the format buttons, Print and Close along the
 * bottom. What the options are, and how the document is built, is the caller's.
 */
export default function ExportDialog({
  open,
  title,
  onClose,
  children,
  previewHtml,
  orientation,
  formats,
  busy,
  onExport,
  onPrint,
  notice = null,
}: ExportDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  // Focus in, Tab trapped, Escape closes, focus handed back on close.
  useDialogFocus(dialogRef, open, onClose);

  if (!open) return null;

  return (
    <div
      className="feedback-modal-overlay"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="export-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <h3 className="export-dialog-title">{title}</h3>

        <div className="export-dialog-options">{children}</div>

        <div className="export-dialog-preview">
          <PreviewFrame html={previewHtml} orientation={orientation} />
        </div>

        <div className="export-dialog-bar">
          {notice && (
            <p className="export-dialog-notice" role="status">
              {notice}
            </p>
          )}
          <div className="export-dialog-buttons">
            <span className="export-dialog-save-label">Save as</span>
            {formats.map((format) => (
              <button
                key={format}
                type="button"
                className={format === 'pdf' ? 'btn-success' : 'btn-outline'}
                disabled={busy}
                aria-label={`Save as ${FORMAT_LABELS[format]}`}
                onClick={() => onExport(format)}
              >
                {FORMAT_LABELS[format]}
              </button>
            ))}
            <button
              type="button"
              className="btn-outline"
              disabled={busy}
              onClick={onPrint}
            >
              <i className="fa fa-print" aria-hidden="true" /> Print…
            </button>
            <span className="export-dialog-spacer" />
            {busy && (
              <span className="export-dialog-busy" role="status">
                <i className="fa fa-spinner fa-spin" aria-hidden="true" />{' '}
                Working…
              </span>
            )}
            <button type="button" className="btn-success" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
