import React, { useRef, useState } from 'react';
import useDialogFocus from '../hooks/useDialogFocus';
import { problemReportDB } from '../api/db';
import { confirmAction, describeError } from '../utils/userFeedback';
import { localDateTimeValue } from '../utils/problemReport';
import {
  APP_AREAS,
  FIELD_MAX_CHARS,
  PROBLEM_KINDS,
  SHORT_FIELD_MAX_CHARS,
  areaForRoute,
  validateProblemReportForm,
  type ProblemReportErrors,
  type ProblemReportForm,
  type ProblemReportIncludes,
  type ProblemReportResult,
} from '../../shared/problemReport';

interface ProblemReportDialogProps {
  /** The event on screen when the form was opened, if any. */
  eventId: number | null;
  /** The window as it was before the form opened (JPEG data URL), or null. */
  screenshot: string | null;
  /** The page's route when the form was opened ("#/event/Cup"). */
  route: string;
  onClose: () => void;
}

const FIELD_ORDER: (keyof ProblemReportForm)[] = [
  'kind',
  'area',
  'happenedAt',
  'problem',
  'doing',
  'expected',
  'reporterName',
  'reporterContact',
];

const TEXT_FIELDS: (keyof ProblemReportForm)[] = [
  'problem',
  'doing',
  'expected',
  'reporterName',
  'reporterContact',
];

function FieldError({
  id,
  message = undefined,
}: {
  id: string;
  message?: string;
}) {
  if (!message) return null;
  return (
    <span className="sailor-edit-error" id={`${id}-error`} role="alert">
      {message}
    </span>
  );
}

interface ReportFieldProps {
  field: keyof ProblemReportForm;
  label: string;
  error?: string;
  optional?: boolean;
  className?: string;
  children: React.ReactNode;
}

/** A label, its control (the child, id `pr-<field>`) and its problem. */
function ReportField({
  field,
  label,
  error = undefined,
  optional = false,
  className = '',
  children,
}: ReportFieldProps) {
  return (
    <div className={`sailor-form-field ${className}`.trim()}>
      {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- tied by htmlFor to the child control */}
      <label htmlFor={`pr-${field}`}>
        {label}
        {optional && <span className="sailor-edit-optional"> (optional)</span>}
      </label>
      {children}
      <FieldError id={`pr-${field}`} message={error} />
    </div>
  );
}

interface IncludeOptionProps {
  id: keyof ProblemReportIncludes;
  checked: boolean;
  disabled?: boolean;
  title: string;
  detail: string;
  onChange: (checked: boolean) => void;
}

function IncludeOption({
  id,
  checked,
  disabled = false,
  title,
  detail,
  onChange,
}: IncludeOptionProps) {
  return (
    <label className="problem-report-include" htmlFor={`pr-include-${id}`}>
      <input
        id={`pr-include-${id}`}
        type="checkbox"
        checked={checked && !disabled}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
    </label>
  );
}

/**
 * Help > Report a problem: what happened, where and when, in the user's
 * words, sent to the developer with the event's data, its history, the error
 * log and a screenshot (each can be left out). Without internet the report
 * is kept and sent later; the user is told which.
 */
export default function ProblemReportDialog({
  eventId,
  screenshot,
  route,
  onClose,
}: ProblemReportDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLSelectElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const [form, setForm] = useState<ProblemReportForm>(() => ({
    kind: '',
    area: areaForRoute(route),
    happenedAt: localDateTimeValue(),
    problem: '',
    doing: '',
    expected: '',
    reporterName: '',
    reporterContact: '',
  }));
  const [includes, setIncludes] = useState<ProblemReportIncludes>({
    snapshot: eventId != null,
    history: eventId != null,
    errorLog: true,
    screenshot: screenshot != null,
  });
  const [errors, setErrors] = useState<ProblemReportErrors>({});
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [result, setResult] = useState<ProblemReportResult | null>(null);

  const typed = TEXT_FIELDS.some((field) => form[field].trim() !== '');

  const requestClose = async () => {
    if (sending) return;
    if (
      !result &&
      typed &&
      !(await confirmAction(
        'You have written a report that was not sent. Discard it?',
        'Discard the report',
        {
          confirmLabel: 'Discard report',
          cancelLabel: 'Keep writing',
          confirmClassName: 'btn-danger',
        },
      ))
    ) {
      return;
    }
    onClose();
  };

  useDialogFocus(dialogRef, true, requestClose, firstFieldRef);

  const set =
    (field: keyof ProblemReportForm) =>
    (
      event: React.ChangeEvent<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >,
    ): void => {
      const { value } = event.target;
      setForm((current) => ({ ...current, [field]: value }));
      setErrors((current) =>
        current[field] ? { ...current, [field]: undefined } : current,
      );
    };

  const include = (key: keyof ProblemReportIncludes) => (checked: boolean) =>
    setIncludes((current) => ({ ...current, [key]: checked }));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sending) return;
    const found = validateProblemReportForm(form);
    const firstBad = FIELD_ORDER.find((field) => found[field]);
    if (firstBad) {
      setErrors(found);
      dialogRef.current
        ?.querySelector<HTMLElement>(`[name="${firstBad}"]`)
        ?.focus();
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      const answer = await problemReportDB.sendProblemReport({
        form,
        includes: {
          ...includes,
          snapshot: includes.snapshot && eventId != null,
          history: includes.history && eventId != null,
          screenshot: includes.screenshot && screenshot != null,
        },
        context: {
          route,
          eventId,
          windowSize: `${window.innerWidth}x${window.innerHeight}`,
        },
        screenshot: includes.screenshot ? screenshot : null,
      });
      setResult(answer);
      setSending(false);
      // The form is gone; put focus on the one button left.
      setTimeout(() => doneRef.current?.focus(), 0);
    } catch (error) {
      setSending(false);
      setSendError(describeError(error, 'sending a problem report'));
    }
  };

  const invalid = (field: keyof ProblemReportForm) =>
    errors[field] ? true : undefined;
  const describedBy = (field: keyof ProblemReportForm) =>
    errors[field] ? `pr-${field}-error` : undefined;

  const noEvent = eventId == null;

  return (
    <div
      className="feedback-modal-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        ref={dialogRef}
        className="feedback-modal sailor-edit-dialog problem-report-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pr-title"
        tabIndex={-1}
      >
        <header className="sailor-edit-head">
          <div>
            <h3 id="pr-title" className="feedback-modal-title">
              <i className="fa fa-bug" aria-hidden="true" /> Report a problem
            </h3>
            <p className="sailor-edit-sub">
              Goes straight to the app&apos;s developer. No e-mail needed.
            </p>
          </div>
          <button
            type="button"
            className="icon-action-btn"
            aria-label="Close"
            title="Close"
            onClick={requestClose}
            disabled={sending}
          >
            <i className="fa fa-xmark" aria-hidden="true" />
          </button>
        </header>

        {result ? (
          <div className="problem-report-done" role="status">
            {result.status === 'sent' ? (
              <>
                <p className="problem-report-done-title">
                  <i className="fa fa-circle-check" aria-hidden="true" /> Report
                  sent. Thank you.
                </p>
                <p>
                  The developer has it with everything needed to look into it.
                </p>
              </>
            ) : (
              <>
                <p className="problem-report-done-title">
                  <i className="fa fa-floppy-disk" aria-hidden="true" /> Report
                  saved, it will be sent later.
                </p>
                <p>
                  {result.reason} The report is kept on this computer and goes
                  out by itself once the app can reach the internet. You do not
                  need to do anything else.
                </p>
              </>
            )}
            <p>
              Reference: <strong>{result.reportId}</strong> (quote it if you
              talk to the developer about this problem).
            </p>
            <div className="feedback-modal-actions">
              <button
                ref={doneRef}
                type="button"
                className="btn-success"
                onClick={onClose}
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <fieldset className="sailor-edit-section" disabled={sending}>
              <legend>
                <i className="fa fa-circle-exclamation" aria-hidden="true" />{' '}
                The problem
              </legend>
              <div className="sailor-edit-grid">
                <ReportField
                  field="kind"
                  label="What kind of problem?"
                  error={errors.kind}
                >
                  <select
                    ref={firstFieldRef}
                    id="pr-kind"
                    name="kind"
                    value={form.kind}
                    onChange={set('kind')}
                    aria-invalid={invalid('kind')}
                    aria-describedby={describedBy('kind')}
                  >
                    <option value="" disabled>
                      Choose…
                    </option>
                    {PROBLEM_KINDS.map((kind) => (
                      <option key={kind.value} value={kind.value}>
                        {kind.label}
                      </option>
                    ))}
                  </select>
                </ReportField>
                <ReportField
                  field="area"
                  label="Where in the app?"
                  error={errors.area}
                >
                  <select
                    id="pr-area"
                    name="area"
                    value={form.area}
                    onChange={set('area')}
                    aria-invalid={invalid('area')}
                    aria-describedby={describedBy('area')}
                  >
                    {APP_AREAS.map((area) => (
                      <option key={area.value} value={area.value}>
                        {area.label}
                      </option>
                    ))}
                  </select>
                </ReportField>
                <ReportField
                  field="happenedAt"
                  label="When did it happen?"
                  error={errors.happenedAt}
                >
                  <input
                    type="datetime-local"
                    id="pr-happenedAt"
                    name="happenedAt"
                    value={form.happenedAt}
                    onChange={set('happenedAt')}
                    aria-invalid={invalid('happenedAt')}
                    aria-describedby={describedBy('happenedAt')}
                  />
                </ReportField>
              </div>
              <ReportField
                field="problem"
                label="What went wrong?"
                error={errors.problem}
                className="problem-report-text"
              >
                <textarea
                  id="pr-problem"
                  name="problem"
                  value={form.problem}
                  onChange={set('problem')}
                  aria-invalid={invalid('problem')}
                  aria-describedby={describedBy('problem')}
                  rows={4}
                  maxLength={FIELD_MAX_CHARS}
                  placeholder="For example: after I saved a DSQ for CRO 12 in Q3, the boats behind her did not move up."
                />
              </ReportField>
              <ReportField
                field="doing"
                label="What were you doing just before?"
                optional
                error={errors.doing}
                className="problem-report-text"
              >
                <textarea
                  id="pr-doing"
                  name="doing"
                  value={form.doing}
                  onChange={set('doing')}
                  aria-invalid={invalid('doing')}
                  aria-describedby={describedBy('doing')}
                  rows={3}
                  maxLength={FIELD_MAX_CHARS}
                  placeholder="The steps, in order: which screen, which buttons, which boats."
                />
              </ReportField>
              <ReportField
                field="expected"
                label="What did you expect instead?"
                optional
                error={errors.expected}
                className="problem-report-text"
              >
                <textarea
                  id="pr-expected"
                  name="expected"
                  value={form.expected}
                  onChange={set('expected')}
                  aria-invalid={invalid('expected')}
                  aria-describedby={describedBy('expected')}
                  rows={2}
                  maxLength={FIELD_MAX_CHARS}
                />
              </ReportField>
            </fieldset>

            <fieldset className="sailor-edit-section" disabled={sending}>
              <legend>
                <i className="fa fa-user" aria-hidden="true" /> Who to reply to
                <span className="sailor-edit-optional"> (optional)</span>
              </legend>
              <div className="sailor-edit-grid">
                <ReportField
                  field="reporterName"
                  label="Your name"
                  error={errors.reporterName}
                >
                  <input
                    type="text"
                    autoComplete="name"
                    id="pr-reporterName"
                    name="reporterName"
                    value={form.reporterName}
                    onChange={set('reporterName')}
                    aria-invalid={invalid('reporterName')}
                    aria-describedby={describedBy('reporterName')}
                    maxLength={SHORT_FIELD_MAX_CHARS}
                  />
                </ReportField>
                <ReportField
                  field="reporterContact"
                  label="Phone or e-mail"
                  error={errors.reporterContact}
                >
                  <input
                    type="text"
                    autoComplete="email"
                    id="pr-reporterContact"
                    name="reporterContact"
                    value={form.reporterContact}
                    onChange={set('reporterContact')}
                    aria-invalid={invalid('reporterContact')}
                    aria-describedby={describedBy('reporterContact')}
                    maxLength={SHORT_FIELD_MAX_CHARS}
                  />
                </ReportField>
              </div>
            </fieldset>

            <fieldset className="sailor-edit-section" disabled={sending}>
              <legend>
                <i className="fa fa-paperclip" aria-hidden="true" /> Sent with
                the report
              </legend>
              <div className="problem-report-includes">
                <IncludeOption
                  id="snapshot"
                  checked={includes.snapshot}
                  disabled={noEvent}
                  title="This event's data"
                  detail={
                    noEvent
                      ? 'Open the event first to include it.'
                      : 'Entries (sailor names, clubs, sail numbers), heats, races, scores and standings.'
                  }
                  onChange={include('snapshot')}
                />
                <IncludeOption
                  id="history"
                  checked={includes.history}
                  disabled={noEvent}
                  title="This event's history"
                  detail={
                    noEvent
                      ? 'Open the event first to include it.'
                      : 'Every change made to the event, in order, as in the History window.'
                  }
                  onChange={include('history')}
                />
                <IncludeOption
                  id="errorLog"
                  checked={includes.errorLog}
                  title="The error log"
                  detail="The technical details behind any error message the app showed."
                  onChange={include('errorLog')}
                />
                <IncludeOption
                  id="screenshot"
                  checked={includes.screenshot}
                  disabled={screenshot == null}
                  title="A picture of the screen and this computer's details"
                  detail={
                    screenshot == null
                      ? 'No picture of the screen could be taken.'
                      : 'The window as it was when you opened this form, the app version, the operating system and the screen size.'
                  }
                  onChange={include('screenshot')}
                />
                {screenshot && includes.screenshot && (
                  <img
                    className="problem-report-shot"
                    src={screenshot}
                    alt="The screen that will be sent"
                  />
                )}
              </div>
            </fieldset>

            {sendError && (
              <p className="problem-report-send-error" role="alert">
                {sendError}
              </p>
            )}

            <div className="feedback-modal-actions sailor-edit-actions">
              <span className="sailor-edit-hint">
                Without internet the report is kept and sent later.
              </span>
              <button
                type="button"
                className="btn-outline"
                onClick={requestClose}
                disabled={sending}
              >
                Cancel
              </button>
              <button type="submit" className="btn-success" disabled={sending}>
                {sending ? (
                  <>
                    <i className="fa fa-spinner fa-spin" aria-hidden="true" />{' '}
                    Sending…
                  </>
                ) : (
                  <>
                    <i className="fa fa-paper-plane" aria-hidden="true" /> Send
                    report
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
